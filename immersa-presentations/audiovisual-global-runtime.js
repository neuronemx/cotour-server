const { randomUUID } = require("node:crypto");
const AUDIO_REACT_ENABLED = false;
const FADE_MS = 1000;

function createAudiovisualGlobalRuntime({ getChannels, publish, setTimer = setTimeout, now = Date.now, createId = randomUUID }) {
  function setVolume(context, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const volume = Math.max(0, Math.min(1, value));
    const session = context.session, channels = getChannels(session);
    session.audiovisualVolume = volume;
    for (const type of ["audio", "video"]) {
      const channel = channels[type];
      channels[type] = { ...channel, volume, updatedAt: now(),
        lastAction: channel.status === "fading" ? channel.lastAction : "volume",
        ...(channel.pendingResource ? { pendingResource: { ...channel.pendingResource, volume } } : {}) };
    }
    publish(context, session);
    return true;
  }

  function stopAll(context) {
    const session = context.session, channels = getChannels(session), pending = [];
    const startedAt = now();
    for (const type of ["audio", "video"]) {
      const current = channels[type];
      if (!current.resource || current.status === "stopped" || current.fadeOut?.id) continue;
      const id = createId();
      if (current.fxPlayback) current.fxPlayback.consumed = true;
      channels[type] = { ...current, status: "fading", pendingResource: null,
        fadeOut: { id, startedAt, durationMs: FADE_MS }, updatedAt: startedAt, lastAction: "fade-stop-all" };
      pending.push({ type, id });
    }
    if (!pending.length) return false;
    publish(context, session);
    setTimer(() => {
      let changed = false;
      const latestChannels = getChannels(session);
      for (const { type, id } of pending) {
        const latest = latestChannels[type];
        if (latest.status !== "fading" || latest.fadeOut?.id !== id) continue;
        latestChannels[type] = { ...latest, status: "stopped", position: 0, startedAt: null,
          fadeOut: null, pendingResource: null, updatedAt: now(), lastAction: "stop" };
        changed = true;
      }
      if (changed) publish(context, session);
    }, FADE_MS);
    return true;
  }
  return { setVolume, stopAll };
}
module.exports = { createAudiovisualGlobalRuntime, AUDIO_REACT_ENABLED, FADE_MS };
