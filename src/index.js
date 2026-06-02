require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { general: generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const { initSocket } = require('./socket');

const authRoutes       = require('./routes/auth');
const profileRoutes    = require('./routes/profiles');
const bookingRoutes    = require('./routes/bookings');
const paymentRoutes    = require('./routes/payments');
const collectorRoutes  = require('./routes/collectors');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

// Make io accessible in controllers
app.set('io', io);

// ── Security & Parsing ────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Preserve raw body for Paystack webhook signature verification
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  req.rawBody = req.body;
  req.body = JSON.parse(req.body.toString());
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────
app.use('/api', generalLimiter);

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── API Routes ────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/profile',     profileRoutes);
app.use('/api/bookings',    bookingRoutes);
app.use('/api/payments',    paymentRoutes);
app.use('/api/collectors',  collectorRoutes);

// ── 404 handler ───────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

// ── Global error handler ──────────────────────────────────────────
app.use(errorHandler);

// ── Socket.io ─────────────────────────────────────────────────────
initSocket(io);

// ── Firebase ──────────────────────────────────────────────────────
require('./config/firebase').getFirebaseApp();

// ── Start server ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`[BinLink] Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
