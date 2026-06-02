const router = require('express').Router();
const ctrl = require('../controllers/authController');
const { auth: authLimiter } = require('../middleware/rateLimiter');

router.post('/send-otp',        authLimiter, ctrl.sendOtpHandler);
router.post('/register',        authLimiter, ctrl.register);
router.post('/login',           authLimiter, ctrl.login);
router.post('/refresh',                      ctrl.refresh);
router.post('/logout',                       ctrl.logout);
router.post('/forgot-password', authLimiter, ctrl.forgotPassword);
router.post('/reset-password',  authLimiter, ctrl.resetPassword);

module.exports = router;
