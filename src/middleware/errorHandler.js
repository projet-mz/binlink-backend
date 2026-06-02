function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message, err.stack);

  // Prisma errors
  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, error: 'Record already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, error: 'Record not found' });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  res.status(status).json({ success: false, error: message });
}

module.exports = errorHandler;
