const router = require('express').Router();
const { getOnlineCollectors } = require('../controllers/profileController');
const { authenticate } = require('../middleware/auth');

router.get('/online', authenticate, getOnlineCollectors);

module.exports = router;
