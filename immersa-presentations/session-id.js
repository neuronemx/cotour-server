const crypto = require('crypto');

const SESSION_ID_PATTERN = /^s_[a-z0-9]{10}$/;
const SESSION_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function generateSessionId() {
  const bytes = crypto.randomBytes(10);
  let suffix = '';
  for (const byte of bytes) suffix += SESSION_ID_ALPHABET[byte % SESSION_ID_ALPHABET.length];
  return 's_' + suffix;
}

function isValidSessionId(value) {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function manifestSessionId(manifest) {
  return isValidSessionId(manifest?.session_id) ? manifest.session_id : null;
}

function generateUniqueSessionId(usedSessionIds = new Set()) {
  let sessionId = generateSessionId();
  while (usedSessionIds.has(sessionId)) sessionId = generateSessionId();
  usedSessionIds.add(sessionId);
  return sessionId;
}

module.exports = {
  generateSessionId,
  generateUniqueSessionId,
  isValidSessionId,
  manifestSessionId
};
