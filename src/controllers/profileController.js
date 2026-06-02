const prisma = require('../config/database');

// GET /api/profile
async function getProfile(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, phone: true, fullName: true, role: true, status: true,
        address: true, isVerified: true, isOnline: true,
        vehicleType: true, vehiclePlate: true,
        rating: true, totalPickups: true,
        lastLat: true, lastLng: true, createdAt: true,
      },
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

// PUT /api/profile
async function updateProfile(req, res, next) {
  try {
    const { fullName, address, vehicleType, vehiclePlate } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { fullName, address, vehicleType, vehiclePlate },
      select: {
        id: true, phone: true, fullName: true, role: true, status: true,
        address: true, vehicleType: true, vehiclePlate: true,
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// PUT /api/profile/fcm-token
async function updateFcmToken(req, res, next) {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ success: false, error: 'fcmToken required' });
    await prisma.user.update({ where: { id: req.user.id }, data: { fcmToken } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// PUT /api/profile/online  (collector only)
async function toggleOnline(req, res, next) {
  try {
    const { isOnline } = req.body;
    if (req.user.status === 'PENDING') {
      return res.status(403).json({ success: false, error: 'Account pending verification' });
    }
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { isOnline, lastSeenAt: new Date() },
      select: { id: true, isOnline: true },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// PUT /api/profile/location  (collector only)
async function updateLocation(req, res, next) {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res.status(400).json({ success: false, error: 'lat and lng required' });
    }
    await prisma.user.update({
      where: { id: req.user.id },
      data: { lastLat: lat, lastLng: lng, lastSeenAt: new Date() },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/profile
async function deleteAccount(req, res, next) {
  try {
    await prisma.user.delete({ where: { id: req.user.id } });
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    next(err);
  }
}

// GET /api/collectors/online  (household-facing)
async function getOnlineCollectors(req, res, next) {
  try {
    const collectors = await prisma.user.findMany({
      where: {
        role: 'COLLECTOR',
        isOnline: true,
        status: 'ACTIVE',
        lastLat: { not: null },
        lastLng: { not: null },
      },
      select: {
        id: true, fullName: true, rating: true, totalPickups: true,
        vehicleType: true, lastLat: true, lastLng: true, lastSeenAt: true,
      },
    });
    res.json({ success: true, data: collectors });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProfile, updateProfile, updateFcmToken,
  toggleOnline, updateLocation, deleteAccount,
  getOnlineCollectors,
};
