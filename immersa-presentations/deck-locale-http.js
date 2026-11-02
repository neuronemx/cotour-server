function requireLocaleWriteOrigin(req, res, next) {
  try {
    const origin = new URL(req.headers.origin);
    const host = String(req.get('host') || '').toLowerCase();
    if (!['http:', 'https:'].includes(origin.protocol)
      || origin.host !== host || req.headers['sec-fetch-site'] === 'cross-site') {
      throw new Error('ORIGIN_DENIED');
    }
    return next();
  } catch (_) {
    return res.status(403).json({ code: 'ORIGIN_DENIED', error: 'Origen no autorizado.' });
  }
}

module.exports = { requireLocaleWriteOrigin };
