const DEFAULT_SESSION_INACTIVITY_MINUTES = 60;

const PASSIVE_SOCKET_EVENTS = new Set([
  "breakout:audio:request",
  "breakout:request_state",
  "games:queue:request_state",
  "pong:audio:request",
  "pong:request_state",
  "presentation:lifecycle:request",
  "time:sync:request"
]);

function resolveSessionInactivityMs(env = process.env) {
  const configured = Number(env.IMMERSA_SESSION_INACTIVITY_MINUTES);
  const minutes = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_SESSION_INACTIVITY_MINUTES;
  return Math.round(minutes * 60 * 1000);
}

function isMeaningfulSessionEvent(eventName) {
  const normalized = String(eventName || "").trim();
  return Boolean(normalized) && normalized !== "join_presentation" && !PASSIVE_SOCKET_EVENTS.has(normalized);
}

function isSessionInactive(session, now = Date.now(), inactivityMs = resolveSessionInactivityMs()) {
  const lastActivityAt = Number(session?.lastActivityAt || 0);
  return Boolean(lastActivityAt) && now - lastActivityAt >= inactivityMs;
}

module.exports = {
  DEFAULT_SESSION_INACTIVITY_MINUTES,
  PASSIVE_SOCKET_EVENTS,
  resolveSessionInactivityMs,
  isMeaningfulSessionEvent,
  isSessionInactive
};
