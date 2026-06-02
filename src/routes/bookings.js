const router = require('express').Router();
const ctrl = require('../controllers/bookingController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/',              authenticate, requireRole('HOUSEHOLD'), ctrl.createBooking);
router.get('/',               authenticate, ctrl.listBookings);
router.get('/:id',            authenticate, ctrl.getBooking);

router.put('/:id/accept',     authenticate, requireRole('COLLECTOR'), ctrl.acceptBooking);

// Status transitions — attach action to req
function withAction(action) {
  return (req, _res, next) => { req.action = action; next(); };
}
router.put('/:id/en-route',  authenticate, requireRole('COLLECTOR'), withAction('en-route'),  ctrl.updateStatus);
router.put('/:id/arrived',   authenticate, requireRole('COLLECTOR'), withAction('arrived'),   ctrl.updateStatus);
router.put('/:id/complete',  authenticate, requireRole('COLLECTOR'), withAction('complete'),  ctrl.updateStatus);
router.put('/:id/cancel',    authenticate, ctrl.cancelBooking);

module.exports = router;
