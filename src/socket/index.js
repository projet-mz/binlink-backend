const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

function initSocket(io) {
  // Auth middleware — verify JWT on socket connection
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket;
    console.log(`[Socket] Connected: ${user.role} ${user.id}`);

    // Collectors join the 'collectors' room when online
    if (user.role === 'COLLECTOR') {
      socket.join('collectors');
    }

    // Household joins their booking room
    socket.on('booking:join', async ({ bookingId }) => {
      const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
      if (!booking) return;

      const isParty =
        booking.householdId === user.id ||
        booking.collectorId === user.id ||
        user.role === 'ADMIN';

      if (isParty) {
        socket.join(`booking:${bookingId}`);
        console.log(`[Socket] ${user.id} joined room booking:${bookingId}`);
      }
    });

    // Collector broadcasts GPS position every ~3 seconds while en_route
    socket.on('collector:location', async ({ bookingId, lat, lng }) => {
      if (user.role !== 'COLLECTOR') return;

      // Update DB
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLat: lat, lastLng: lng, lastSeenAt: new Date() },
      });

      // Broadcast to household in booking room
      socket.to(`booking:${bookingId}`).emit('collector:location', {
        collectorId: user.id,
        lat,
        lng,
        timestamp: Date.now(),
      });
    });

    // Collector going online/offline
    socket.on('collector:go-online', async () => {
      if (user.role !== 'COLLECTOR') return;
      if (user.status === 'PENDING') {
        socket.emit('error', { message: 'Account pending verification' });
        return;
      }
      await prisma.user.update({ where: { id: user.id }, data: { isOnline: true, lastSeenAt: new Date() } });
      socket.join('collectors');
      socket.emit('collector:status', { isOnline: true });
    });

    socket.on('collector:go-offline', async () => {
      if (user.role !== 'COLLECTOR') return;
      await prisma.user.update({ where: { id: user.id }, data: { isOnline: false } });
      socket.leave('collectors');
      socket.emit('collector:status', { isOnline: false });
    });

    socket.on('disconnect', async () => {
      if (user.role === 'COLLECTOR') {
        await prisma.user.update({ where: { id: user.id }, data: { isOnline: false } }).catch(() => {});
      }
      console.log(`[Socket] Disconnected: ${user.id}`);
    });
  });
}

module.exports = { initSocket };
