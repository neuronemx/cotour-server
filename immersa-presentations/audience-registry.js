function normalizeAudienceId(audienceId, fallback) {
  return String(audienceId || fallback || "");
}

function registerAudience(session, { audienceId, socketId, audienceName, label, joinedAt = Date.now() }) {
  if (!session?.audience) return "";
  const normalizedAudienceId = normalizeAudienceId(audienceId, socketId);
  if (!normalizedAudienceId) return "";

  session.audience.set(normalizedAudienceId, {
    joinedAt,
    name: String(audienceName || ""),
    label: String(label || audienceName || ""),
    socketId: String(socketId || "")
  });
  return normalizedAudienceId;
}

function unregisterAudience(session, audienceId, socketId) {
  if (!session?.audience || !audienceId) return false;
  const normalizedAudienceId = String(audienceId);
  const currentAudience = session.audience.get(normalizedAudienceId);
  if (!currentAudience || currentAudience.socketId !== String(socketId || "")) return false;
  return session.audience.delete(normalizedAudienceId);
}

module.exports = { registerAudience, unregisterAudience };
