class EventAccessError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.statusCode = status;
  }
}

const ROLE_CAPABILITIES = Object.freeze({
  ADMIN: Object.freeze(['event.read', 'event.configure', 'event.members.manage', 'event.metrics.read', 'event.metrics.export']),
  PRODUCER: Object.freeze(['event.read', 'event.configure'])
});

function requireCapability(context, capability) {
  if (!context?.roles?.some(role => ROLE_CAPABILITIES[role]?.includes(capability))) {
    throw new EventAccessError('EVENT_PERMISSION_DENIED');
  }
}

function accountActor(req) {
  const userId = req.accountContext?.user?.id;
  if (!userId) throw new EventAccessError('AUTHENTICATION_REQUIRED', 401);
  return String(userId);
}

function assertFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new EventAccessError('INVALID_FIELDS', 400);
  }
}

function textField(value, max = 191) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new EventAccessError('INVALID_INPUT', 400);
  }
  return value.trim();
}

module.exports = { EventAccessError, ROLE_CAPABILITIES, requireCapability, accountActor, assertFields, textField };
