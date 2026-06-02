const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../config/database');

const ACCESS_EXPIRY = '15m';
const REFRESH_EXPIRY = '30d';
const REFRESH_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function generateAccessToken(userId, role) {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
}

function generateRefreshToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY });
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

async function saveRefreshToken(userId, token) {
  await prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_MS),
    },
  });
}

async function rotateRefreshToken(oldToken) {
  const record = await prisma.refreshToken.findUnique({ where: { token: oldToken } });
  if (!record || record.expiresAt < new Date()) {
    throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
  }

  let payload;
  try {
    payload = jwt.verify(oldToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 401 });

  // Delete old, issue new
  await prisma.refreshToken.delete({ where: { token: oldToken } });
  const newRefresh = generateRefreshToken(user.id);
  await saveRefreshToken(user.id, newRefresh);
  const newAccess = generateAccessToken(user.id, user.role);

  return { accessToken: newAccess, refreshToken: newRefresh, user };
}

async function revokeRefreshToken(token) {
  await prisma.refreshToken.deleteMany({ where: { token } }).catch(() => {});
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
  comparePassword,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
};
