const prisma = require('../config/database');
const { sendOtp, generateOtp } = require('../services/smsService');
const {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
} = require('../services/authService');

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// POST /api/auth/send-otp
async function sendOtpHandler(req, res, next) {
  try {
    const { phone, purpose = 'REGISTRATION' } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone is required' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    // Invalidate any existing unused OTPs for this phone+purpose
    await prisma.otpRecord.updateMany({
      where: { phone, purpose, used: false },
      data: { used: true },
    });

    await prisma.otpRecord.create({ data: { phone, otp, purpose, expiresAt } });
    await sendOtp(phone, otp);

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const { phone, otp, password, fullName, role = 'HOUSEHOLD' } = req.body;

    if (!phone || !otp || !password || !fullName) {
      return res.status(400).json({ success: false, error: 'All fields required' });
    }
    if (!['HOUSEHOLD', 'COLLECTOR'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    // Verify OTP
    const record = await prisma.otpRecord.findFirst({
      where: { phone, purpose: 'REGISTRATION', used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.otp !== otp) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    // Check if phone already exists
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Phone number already registered' });
    }

    const passwordHash = await hashPassword(password);
    const status = role === 'COLLECTOR' ? 'PENDING' : 'ACTIVE';

    const user = await prisma.user.create({
      data: { phone, passwordHash, fullName, role, status, isVerified: true },
      select: { id: true, phone: true, fullName: true, role: true, status: true },
    });

    // Mark OTP used
    await prisma.otpRecord.update({ where: { id: record.id }, data: { used: true } });

    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);

    res.status(201).json({ success: true, data: { user, accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Phone and password required' });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'Account suspended. Contact support.' });
    }

    const accessToken = generateAccessToken(user.id, user.role);
    const refreshToken = generateRefreshToken(user.id);
    await saveRefreshToken(user.id, refreshToken);

    const { passwordHash: _, ...safeUser } = user;
    res.json({ success: true, data: { user: safeUser, accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/refresh
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ success: false, error: 'Refresh token required' });
    }
    const result = await rotateRefreshToken(refreshToken);
    const { passwordHash: _, ...safeUser } = result.user;
    res.json({
      success: true,
      data: { user: safeUser, accessToken: result.accessToken, refreshToken: result.refreshToken },
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await revokeRefreshToken(refreshToken);
    res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/forgot-password
async function forgotPassword(req, res, next) {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });

    const user = await prisma.user.findUnique({ where: { phone } });
    // Always respond OK to prevent phone enumeration
    if (!user) return res.json({ success: true, message: 'OTP sent if account exists' });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await prisma.otpRecord.updateMany({
      where: { phone, purpose: 'PASSWORD_RESET', used: false },
      data: { used: true },
    });
    await prisma.otpRecord.create({ data: { phone, otp, purpose: 'PASSWORD_RESET', expiresAt, userId: user.id } });
    await sendOtp(phone, otp);

    res.json({ success: true, message: 'OTP sent if account exists' });
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/reset-password
async function resetPassword(req, res, next) {
  try {
    const { phone, otp, newPassword } = req.body;
    if (!phone || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'All fields required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const record = await prisma.otpRecord.findFirst({
      where: { phone, purpose: 'PASSWORD_RESET', used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.otp !== otp) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { phone }, data: { passwordHash } });
    await prisma.otpRecord.update({ where: { id: record.id }, data: { used: true } });

    // Revoke all refresh tokens for security
    await prisma.refreshToken.deleteMany({ where: { user: { phone } } });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { sendOtpHandler, register, login, refresh, logout, forgotPassword, resetPassword };
