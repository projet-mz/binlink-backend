const router = require('express').Router();
const ctrl = require('../controllers/profileController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/',           authenticate, ctrl.getProfile);
router.put('/',           authenticate, ctrl.updateProfile);
router.put('/fcm-token',  authenticate, ctrl.updateFcmToken);
router.put('/online',     authenticate, requireRole('COLLECTOR'), ctrl.toggleOnline);
router.put('/location',   authenticate, requireRole('COLLECTOR'), ctrl.updateLocation);
router.delete('/',        authenticate, ctrl.deleteAccount);

module.exports = router;
