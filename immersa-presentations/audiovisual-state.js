// Pure transitions shared by Presentaciones and the typed Events adapter.
function emptyChannel(now = Date.now()) { return { resource: null, status: 'stopped', loop: false, volume: 1, position: 0, updatedAt: now }; }
function channels(now = Date.now()) { return { audio: emptyChannel(now), video: emptyChannel(now) }; }
function select(current, resource, loop, volume, now = Date.now()) {
  const next = { resource, status: 'playing', loop: Boolean(loop), volume, position: 0, startedAt: now, updatedAt: now, lastAction: 'select' };
  return resource.type === 'audio' && current.resource && current.status === 'playing' && String(current.resource.id) !== String(resource.id)
    ? { ...current, status: 'fading', updatedAt: now, lastAction: 'fade-replace', pendingResource: next } : next;
}
function completeFade(current, now = Date.now()) {
  if (current.status !== 'fading') return current;
  if (current.lastAction === 'fade-replace' && current.pendingResource) return { ...current.pendingResource, updatedAt: now, lastAction: 'select' };
  return { ...current, status: 'stopped', position: 0, startedAt: null, updatedAt: now, lastAction: 'stop' };
}
function control(current, payload, now = Date.now()) {
  const action = payload.action;
  if (action === 'stop') return { ...current, status: 'stopped', position: 0, startedAt: null, updatedAt: now, lastAction: 'stop' };
  if (action === 'fade-stop') return { ...current, status: 'fading', updatedAt: now, lastAction: action };
  const position = current.status === 'playing' && current.startedAt ? Math.max(0, Number(current.position || 0) + (now - current.startedAt) / 1000) : Number(current.position || 0);
  const status = action === 'play' ? 'playing' : action === 'pause' ? 'paused' : current.status;
  return { ...current, status, loop: action === 'loop' ? Boolean(payload.loop) : current.loop,
    volume: action === 'volume' ? Math.max(0, Math.min(1, Number(payload.volume))) : current.volume,
    position: action === 'seek' ? Math.max(0, Number(payload.position) || 0) : status === 'playing' || action === 'pause' ? position : current.position,
    startedAt: status === 'playing' ? now : null, updatedAt: now, lastAction: action };
}
function advancePlaylist(current, playlist, finishOnLast, now = Date.now()) {
  const index = playlist.findIndex(item => String(item.id) === String(current.resource?.id));
  if (index < 0) return null;
  const next = playlist[index + 1] || (current.loop ? playlist[0] : null);
  if (next) return { ...current, resource: next, status: 'playing', position: 0, startedAt: now, updatedAt: now, lastAction: 'playlist-next' };
  return finishOnLast ? { ...current, status: 'stopped', position: 0, startedAt: null, updatedAt: now, lastAction: 'ended' } : null;
}
function audioReact(previous, payload, now = Date.now()) {
  return { enabled: typeof payload.enabled === 'boolean' ? payload.enabled : previous.enabled === true,
    reaction: payload.action === 'next' ? (Number(previous.reaction || 0) + 1) % 12 : Math.max(0, Math.min(11, Number.isFinite(Number(payload.reaction)) ? Math.floor(Number(payload.reaction)) : Number(previous.reaction || 0))), updatedAt: now };
}
function overlayPatch(overlays = {}) {
  const patch = { ...overlays }, state = patch.showReactions ?? patch.reactionsOnScreen;
  if (typeof state !== 'undefined') patch.showReactions = patch.reactionsOnScreen = Boolean(state);
  return patch;
}
function drawing(stroke, slideIndex, now = Date.now()) {
  const points = Array.isArray(stroke?.points) ? stroke.points : [];
  if (points.length < 2) return null;
  return { slideIndex, points: points.slice(0, 240).map(point => ({ x: Math.max(0, Math.min(1, Number(point?.x) || 0)), y: Math.max(0, Math.min(1, Number(point?.y) || 0)) })),
    color: '#b20de9', width: Math.max(0.003, Math.min(0.02, Number(stroke?.width) || 0.009)), createdAt: now,
    ttl: Math.max(3000, Math.min(5000, Number(stroke?.ttl) || 4200)) };
}
module.exports = { emptyChannel, channels, select, completeFade, control, advancePlaylist, audioReact, overlayPatch, drawing };
