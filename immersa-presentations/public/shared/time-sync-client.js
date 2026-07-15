(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaTimeSync = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const SCHEMA_VERSION = 1;
  const SAMPLE_COUNT = 3;
  const RESYNC_MS = 15000;
  function monotonicNow() { return root.performance?.now ? root.performance.now() : Date.now(); }
  function estimateSample(sentWall, receivedWall, sentMono, receivedMono, serverNow) { const rttMs = Math.max(0, receivedMono - sentMono); return { rttMs, offsetMs: serverNow - ((sentWall + receivedWall) / 2), serverAtReceiveMs: serverNow + rttMs / 2, receivedMonoMs: receivedMono }; }
  function chooseBestSample(samples) { return samples.filter(Boolean).sort((a, b) => a.rttMs - b.rttMs)[0] || null; }
  function remainingMs(state, serverNow) { const timer = state?.timer; if (!timer || state?.visible === false) return null; if (timer.status === "running" && Number.isFinite(Number(timer.ends_at_server_ms))) return Math.max(0, Number(timer.ends_at_server_ms) - serverNow); if (Number.isFinite(Number(timer.remaining_ms))) return Math.max(0, Number(timer.remaining_ms)); return timer.status === "finished" ? 0 : null; }
  function create(socket, options = {}) {
    const wallNow = options.wallNow || Date.now;
    const monoNow = options.monoNow || monotonicNow;
    const setTimer = options.setTimeoutFn || root.setTimeout || setTimeout;
    const clearTimer = options.clearTimeoutFn || root.clearTimeout || clearTimeout;
    const documentRef = options.document || root.document;
    const subscribers = new Set();
    let state = null, anchorServerMs = null, anchorMonoMs = null, pending = null, joined = false, resyncTimer = null, syncing = null, commandSequence = 0;
    function serverNow() { return Number.isFinite(anchorServerMs) ? anchorServerMs + (monoNow() - anchorMonoMs) : wallNow(); }
    function getRemainingMs() { return remainingMs(state, serverNow()); }
    function notify() { for (const fn of subscribers) fn(state, { server_now_ms: serverNow(), remaining_ms: getRemainingMs() }); }
    function applyState(payload, receivedMono = monoNow()) { if (!payload || typeof payload !== "object") return; if (!Number.isFinite(anchorServerMs) && Number.isFinite(Number(payload.server_now_ms))) { anchorServerMs = Number(payload.server_now_ms); anchorMonoMs = receivedMono; } state = payload; notify(); scheduleResync(); }
    function clearResync() { if (resyncTimer) clearTimer(resyncTimer); resyncTimer = null; }
    function scheduleResync() { clearResync(); if (!joined || !socket.connected || state?.timer?.status !== "running") return; resyncTimer = setTimer(() => { resyncTimer = null; synchronize(SAMPLE_COUNT).catch(() => {}); }, options.resyncMs || RESYNC_MS); resyncTimer?.unref?.(); }
    function sample() { if (!joined || !socket.connected) return Promise.reject(new Error("not_joined")); const sentWall = wallNow(); const sentMono = monoNow(); return new Promise((resolve, reject) => { const timeout = setTimer(() => { if (pending?.sentWall === sentWall) pending = null; reject(new Error("sync_timeout")); }, options.sampleTimeoutMs || 1500); pending = { sentWall, sentMono, timeout, resolve, reject }; socket.emit("time:sync:request", { schema_version: SCHEMA_VERSION, client_sent_at_ms: sentWall }); }); }
    function onSync(payload) { const receivedWall = wallNow(); const receivedMono = monoNow(); if (!pending) return applyState(payload, receivedMono); if (Number(payload.client_sent_at_ms) !== pending.sentWall) return; const current = pending; pending = null; clearTimer(current.timeout); current.resolve({ ...estimateSample(current.sentWall, receivedWall, current.sentMono, receivedMono, Number(payload.server_now_ms)), response: payload }); }
    async function synchronize(count = SAMPLE_COUNT) { if (syncing) return syncing; syncing = (async () => { const samples = []; for (let index = 0; index < count; index += 1) { try { samples.push(await sample()); } catch (_error) {} } const best = chooseBestSample(samples); if (!best) return null; anchorServerMs = best.serverAtReceiveMs; anchorMonoMs = best.receivedMonoMs; applyState(best.response, best.receivedMonoMs); return best; })().finally(() => { syncing = null; scheduleResync(); }); return syncing; }
    function handlePresentationJoin(count = SAMPLE_COUNT) { joined = true; return synchronize(count); }
    function handleDisconnect() { joined = false; clearResync(); if (pending) { const current = pending; pending = null; clearTimer(current.timeout); current.reject(new Error("disconnected")); } }
    function command(action, payload = {}, commandOptions = {}) { const revision = Number(commandOptions.expectedRevision ?? state?.revision); if (!joined || !socket.connected || !Number.isInteger(revision)) return null; const commandId = commandOptions.commandId || ("time_cmd_" + wallNow().toString(36) + "_" + (++commandSequence).toString(36)); socket.emit("time:command", { schema_version: SCHEMA_VERSION, command_id: commandId, expected_revision: revision, action, payload }); return commandId; }
    function subscribe(fn) { if (typeof fn !== "function") return () => {}; subscribers.add(fn); if (state) fn(state, { server_now_ms: serverNow(), remaining_ms: getRemainingMs() }); return () => subscribers.delete(fn); }
    function onVisible() { if (documentRef?.visibilityState === "visible" && joined && socket.connected) synchronize(SAMPLE_COUNT).catch(() => {}); }
    socket.on("time:sync:response", onSync); socket.on("time:state", applyState); socket.on("time:error", payload => { if (payload?.state) applyState(payload.state); }); socket.on("disconnect", handleDisconnect); documentRef?.addEventListener?.("visibilitychange", onVisible);
    return { synchronize, handlePresentationJoin, handleDisconnect, serverNow, getRemainingMs, getRemainingSeconds: () => { const value = getRemainingMs(); return value === null ? null : Math.ceil(value / 1000); }, getState: () => state, command, subscribe };
  }
  return { SCHEMA_VERSION, SAMPLE_COUNT, RESYNC_MS, estimateSample, chooseBestSample, remainingMs, create };
});