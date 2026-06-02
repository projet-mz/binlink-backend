const router = require('express').Router();
const ctrl = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

router.post('/initiate',          authenticate, ctrl.initiatePayment);
router.post('/webhook',                         ctrl.paystackWebhook);  // No auth — Paystack calls this
router.get('/:bookingId',         authenticate, ctrl.getPaymentStatus);

module.exports = router;
