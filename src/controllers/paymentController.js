const prisma = require('../config/database');
const { initiateCharge, verifyTransaction, verifyWebhookSignature } = require('../services/paymentService');
const { sendPush } = require('../services/notificationService');

// POST /api/payments/initiate
async function initiatePayment(req, res, next) {
  try {
    const { bookingId, momoPhone } = req.body;
    if (!bookingId) return res.status(400).json({ success: false, error: 'bookingId required' });

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { household: { select: { id: true, phone: true } } },
    });
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
    if (booking.householdId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    if (booking.paymentStatus === 'PAID') {
      return res.status(400).json({ success: false, error: 'Already paid' });
    }

    if (booking.paymentMethod === 'CASH') {
      return res.json({ success: true, data: { cash: true, message: 'Pay collector in cash on pickup' } });
    }

    const result = await initiateCharge({
      amount: Number(booking.totalAmount),
      phone: momoPhone || booking.household.phone,
      paymentMethod: booking.paymentMethod,
      bookingId: booking.id,
    });

    if (result.reference) {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { paystackRef: result.reference, paymentStatus: 'PENDING' },
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/webhook  — called by Paystack
async function paystackWebhook(req, res, next) {
  try {
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody; // populated via express middleware

    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }

    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const booking = await prisma.booking.findUnique({ where: { paystackRef: reference } });

      if (booking && booking.paymentStatus !== 'PAID') {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { paymentStatus: 'PAID' },
        });

        // Notify both parties
        const household = await prisma.user.findUnique({
          where: { id: booking.householdId },
          select: { fcmToken: true },
        });
        if (household?.fcmToken) {
          await sendPush({
            token: household.fcmToken,
            title: 'Payment confirmed',
            body: `GHS ${booking.totalAmount} received successfully`,
            data: { bookingId: booking.id, type: 'payment:confirmed' },
          });
        }

        // Socket emit
        // io is not directly accessible here; handled via app-level event
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/payments/:bookingId
async function getPaymentStatus(req, res, next) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.bookingId },
      select: { id: true, paymentStatus: true, paymentMethod: true, totalAmount: true, paystackRef: true, householdId: true },
    });
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
    if (booking.householdId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // If pending, check with Paystack
    if (booking.paymentStatus === 'PENDING' && booking.paystackRef) {
      const verification = await verifyTransaction(booking.paystackRef);
      if (verification.success) {
        await prisma.booking.update({ where: { id: booking.id }, data: { paymentStatus: 'PAID' } });
        booking.paymentStatus = 'PAID';
      }
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
}

module.exports = { initiatePayment, paystackWebhook, getPaymentStatus };
