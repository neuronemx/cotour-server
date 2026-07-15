const TICK_MS = 50;
const BROADCAST_MS = 100;

function createBreakoutSocketHandlers({
  io,
  store,
  coordinator = null,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  const loops = new Map();

  function canControl(context) {
    return context?.role === "presenter" || context?.role === "stage";
  }

  function emitState(roomKey, sessionId) {
    io.to(roomKey).emit("breakout:state", store.snapshot(sessionId));
  }

  function stopLoop(sessionId) {
    const key = String(sessionId || "");
    const loop = loops.get(key);
    if (loop) clearIntervalFn(loop.handle);
    loops.delete(key);
  }

  function ensureLoop(roomKey, sessionId) {
    const key = String(sessionId || "");
    if (loops.has(key)) return;
    let lastAt = Date.now();
    let lastBroadcastAt = 0;
    const handle = setIntervalFn(() => {
      const nowMs = Date.now();
      const state = store.step(sessionId, nowMs - lastAt, nowMs);
      lastAt = nowMs;
      if (nowMs - lastBroadcastAt >= BROADCAST_MS || state.status !== "running") {
        io.to(roomKey).emit("breakout:state", state);
        lastBroadcastAt = nowMs;
      }
      if (state.status !== "running") stopLoop(sessionId);
    }, TICK_MS);
    handle?.unref?.();
    loops.set(key, { handle, roomKey });
  }

  async function start(context) {
    const execute = async () => {
      if (coordinator?.hasAnyActive(context.sessionId, "breakout")) {
        return { ok: false, reason: "active_interaction_exists" };
      }
      return store.start(context.sessionId, context.role);
    };
    return coordinator
      ? coordinator.withSessionLock(context.sessionId, execute)
      : execute();
  }

  function reject(socket, action, reason) {
    socket.emit("breakout:rejected", { action, reason });
  }

  function attach(socket, getContext) {
    socket.on("breakout:start", async () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = await start(context);
      if (!result.ok) return reject(socket, "start", result.reason);
      emitState(context.roomKey, context.sessionId);
      ensureLoop(context.roomKey, context.sessionId);
    });

    socket.on("breakout:pause", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = store.pause(context.sessionId, context.role);
      if (!result.ok) return reject(socket, "pause", result.reason);
      stopLoop(context.sessionId);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("breakout:resume", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = store.resume(context.sessionId, context.role);
      if (!result.ok) return reject(socket, "resume", result.reason);
      emitState(context.roomKey, context.sessionId);
      ensureLoop(context.roomKey, context.sessionId);
    });

    socket.on("breakout:close", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = store.close(context.sessionId, context.role);
      if (!result.ok) return reject(socket, "close", result.reason);
      stopLoop(context.sessionId);
      io.to(context.roomKey).emit("breakout:closed", store.snapshot(context.sessionId));
    });

    socket.on("breakout:input", ({ direction } = {}) => {
      const context = getContext();
      if (!context?.sessionId || context.role !== "audience" || !context.audienceId) return;
      const result = store.input(context.sessionId, context.audienceId, direction);
      if (!result.ok && result.reason !== "rate_limited") reject(socket, "input", result.reason);
    });
  }

  function sendCurrentState(socket, context) {
    if (!context?.sessionId) return;
    const state = store.snapshot(context.sessionId);
    socket.emit("breakout:state", state);
    if (state.status === "running" && context.roomKey) ensureLoop(context.roomKey, context.sessionId);
  }

  function closeAll() {
    for (const sessionId of Array.from(loops.keys())) stopLoop(sessionId);
  }

  return {
    attach,
    sendCurrentState,
    emitState,
    ensureLoop,
    stopLoop,
    closeAll,
    constants: { TICK_MS, BROADCAST_MS }
  };
}

module.exports = { createBreakoutSocketHandlers, TICK_MS, BROADCAST_MS };
