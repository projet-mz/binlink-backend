const prisma = require('../config/database');
const { sendPush, sendToMultiple } = require('../services/notificationService');

// Pricing (GHS)
const PRICES = { SMALL: 30, MEDIUM: 40, LARGE: 50, EXTRA_BAG: 6 };

// POST /api/bookings
async function createBooking(req, res, next) {
  try {
    const {
      binSize, extraBags = 0, pickupAddress, pickupLat, pickupLng,
      paymentMethod, scheduledDate,
    } = req.body;

    if (!binSize || !pickupAddress || !pickupLat || !pickupLng || !paymentMethod) {
      return res.status(400).json({ success: false, error: 'Missing required booking fields' });
    }

    const baseAmount = PRICES[binSize] ?? 0;
    const extraBagsAmount = extraBags * PRICES.EXTRA_BAG;
    const totalAmount = baseAmount + extraBagsAmount;

    const booking = await prisma.booking.create({
      data: {
        householdId: req.user.id,
        binSize,
        extraBags,
        baseAmount,
        extraBagsAmount,
        totalAmount,
        pickupAddress,
        pickupLat,
        pickupLng,
        paymentMethod,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
      },
      include: { household: { select: { fullName: true, phone: true, address: true } } },
    });

    // Notify online collectors via FCM
    const collectors = await prisma.user.findMany({
      where: { role: 'COLLECTOR', isOnline: true, status: 'ACTIVE', fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    const tokens = collectors.map((c) => c.fcmToken).filter(Boolean);
    await sendToMultiple(tokens, {
      title: 'New Pickup Request',
      body: `${binSize} bin at ${pickupAddress}`,
      data: { bookingId: booking.id, type: 'booking:new' },
    });

    // Emit via socket (handled in socket/index.js via res.locals.io)
    if (req.app.get('io')) {
      req.app.get('io').to('collectors').emit('booking:new', booking);
    }

    res.status(201).json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings
async function listBookings(req, res, next) {
  try {
    const { role, id } = req.user;
    const where = role === 'HOUSEHOLD' ? { householdId: id } : { collectorId: id };

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        household: { select: { fullName: true, phone: true, address: true } },
        collector: { select: { fullName: true, phone: true, rating: true, vehicleType: true } },
      },
    });
    res.json({ success: true, data: bookings });
  } catch (err) {
    next(err);
  }
}

// GET /api/bookings/:id
async function getBooking(req, res, next) {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: {
        household: { select: { fullName: true, phone: true, address: true } },
        collector: { select: { fullName: true, phone: true, rating: true, vehicleType: true, lastLat: true, lastLng: true } },
      },
    });
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const isOwner = booking.householdId === req.user.id || booking.collectorId === req.user.id;
    if (!isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
}

// PUT /api/bookings/:id/accept  — ATOMIC: only one collector wins
async function acceptBooking(req, res, next) {
  try {
    const result = await prisma.booking.updateMany({
      where: { id: req.params.id, status: 'PENDING', collectorId: null },
      data: { status: 'ACCEPTED', collectorId: req.user.id, acceptedAt: new Date() },
    });

    if (result.count === 0) {
      return res.status(409).json({ success: false, error: 'Booking already accepted or not found' });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: req.params.id },
      include: { household: { select: { fullName: true, phone: true, fcmToken: true } } },
    });

    // Notify household
    if (booking.household.fcmToken) {
      await sendPush({
        token: booking.household.fcmToken,
        title: 'Collector on the way!',
        body: `${req.user.fullName} accepted your pickup request`,
        data: { bookingId: booking.id, type: 'booking:accepted' },
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`booking:${booking.id}`).emit('booking:accepted', {
        bookingId: booking.id,
        collector: { id: req.user.id, fullName: req.user.fullName, phone: req.user.phone },
      });
      io.to('collectors').emit('booking:taken', { bookingId: booking.id });
    }

    res.json({ success: true, data: booking });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { action } = req; // set by route

    const statusMap = {
      'en-route': { status: 'EN_ROUTE', field: 'enRouteAt' },
      arrived:    { status: 'ARRIVED',  field: 'arrivedAt' },
      complete:   { status: 'COMPLETED', field: 'completedAt' },
    };

    const { status, field } = statusMap[action] || {};
    if (!status) return res.status(400).json({ success: false, error: 'Invalid action' });

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });
    if (booking.collectorId !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Not your booking' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status, [field]: new Date() },
      include: { household: { select: { fcmToken: true, fullName: true } } },
    });

    // Increment collector total pickups on complete
    if (status === 'COMPLETED') {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { totalPickups: { increment: 1 } },
      });
    }

    // Notify household
    const notifMap = {
      EN_ROUTE: { title: 'Collector en route', body: 'Your collector is on the way!' },
      ARRIVED:  { title: 'Collector arrived', body: 'Your collector has arrived at your location.' },
      COMPLETED: { title: 'Pickup complete!', body: 'Your waste has been collected. Thank you!' },
    };
    if (updated.household.fcmToken && notifMap[status]) {
      await sendPush({
        token: updated.household.fcmToken,
        ...notifMap[status],
        data: { bookingId: id, type: `booking:${status.toLowerCase()}` },
      });
    }

    const io = req.app.get('io');
    if (io) io.to(`booking:${id}`).emit('booking:status', { bookingId: id, status });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// PUT /api/bookings/:id/cancel
async function cancelBooking(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const isOwner = booking.householdId === req.user.id || booking.collectorId === req.user.id;
    if (!isOwner && req.user.role !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
      return res.status(400).json({ success: false, error: 'Cannot cancel a completed or already cancelled booking' });
    }

    const updated = await prisma.booking.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason || null },
    });

    const io = req.app.get('io');
    if (io) io.to(`booking:${id}`).emit('booking:status', { bookingId: id, status: 'CANCELLED' });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = { createBooking, listBookings, getBooking, acceptBooking, updateStatus, cancelBooking };
