const AUTO_ADVANCE_DELAY_MS = 5000;

function createGameQueueSocketHandlers({
  io,
  store,
  coordinator,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  autoAdvanceDelayMs = AUTO_ADVANCE_DELAY_MS
}) {
  const timers = new Map();
  const canControl = (context) => context?.role === "presenter" || context?.role === "stage";
  const runtimeFor = (gameType) => coordinator?.getGameRuntime?.(gameType) || null;
  const availableGameTypes = () => (coordinator?.getRegisteredGameTypes?.("prepare") || [])
    .filter((gameType) => runtimeFor(gameType)?.queueAvailable !== false);
  const withLock = (sessionId, action) => coordinator?.withSessionLock
    ? coordinator.withSessionLock(sessionId, action)
    : action();

  function snapshot(sessionId) {
    return store.snapshot(sessionId, availableGameTypes());
  }

  function emitState(roomKey, sessionId) {
    if (roomKey) io.to(roomKey).emit("games:queue:state", snapshot(sessionId));
  }

  function reject(socket, action, reason) {
    socket.emit("games:queue:rejected", { action, reason });
  }

  function clearTimer(sessionId) {
    const key = String(sessionId || "");
    const timer = timers.get(key);
    if (timer) clearTimeoutFn(timer);
    timers.delete(key);
  }

  async function prepareGame(context, gameType) {
    const runtime = runtimeFor(gameType);
    if (!runtime || typeof runtime.prepare !== "function") return { ok: false, reason: "game_unavailable" };
    return runtime.prepare(context, { skipLock: true });
  }

  function closeGame(context, gameType) {
    const runtime = runtimeFor(gameType);
    if (!runtime || typeof runtime.close !== "function") return { ok: false, reason: "game_unavailable" };
    return runtime.close(context);
  }

  async function startQueue(context) {
    return withLock(context.sessionId, async () => {
      const validation = store.validateStart(context.sessionId, context.role, availableGameTypes());
      if (!validation.ok) return validation;
      const prepared = await prepareGame(context, validation.gameType);
      if (!prepared.ok) return prepared;
      return store.start(context.sessionId, validation.gameType);
    });
  }

  async function advanceNow(context, expectedGameType, options = {}) {
    return withLock(context.sessionId, async () => {
      const session = store.getSession(context.sessionId);
      if (session.status !== "running" || session.current_game_type !== expectedGameType) {
        return { ok: false, reason: "invalid_state" };
      }
      if (options.expectedRevision !== undefined && session.revision !== options.expectedRevision) {
        return { ok: false, reason: "stale_transition" };
      }
      clearTimer(context.sessionId);
      const closed = closeGame(context, expectedGameType);
      if (!closed.ok) return closed;
      const nextGameType = store.nextGameType(context.sessionId);
      if (!nextGameType) return store.end(context.sessionId, context.role);
      const prepared = await prepareGame(context, nextGameType);
      if (!prepared.ok) {
        store.finish(context.sessionId, expectedGameType);
        return prepared;
      }
      return store.advance(context.sessionId, expectedGameType, nextGameType);
    });
  }

  function handleGameFinished({ sessionId, roomKey, gameType }) {
    const current = store.getSession(sessionId);
    if (current.status !== "running" || current.current_game_type !== gameType || current.transition_at_ms) return false;
    const nextGameType = store.nextGameType(sessionId);
    if (!nextGameType) {
      store.finish(sessionId, gameType);
      emitState(roomKey, sessionId);
      return true;
    }
    const transitionAtMs = now() + autoAdvanceDelayMs;
    const scheduled = store.scheduleTransition(sessionId, gameType, transitionAtMs);
    if (!scheduled.ok) return false;
    const expectedRevision = store.getSession(sessionId).revision;
    emitState(roomKey, sessionId);
    clearTimer(sessionId);
    const handle = setTimeoutFn(async () => {
      timers.delete(String(sessionId || ""));
      const context = { sessionId, roomKey, role: "stage" };
      const result = await advanceNow(context, gameType, { expectedRevision });
      if (!result.ok) store.finish(sessionId, gameType);
      emitState(roomKey, sessionId);
    }, autoAdvanceDelayMs);
    handle?.unref?.();
    timers.set(String(sessionId || ""), handle);
    return true;
  }

  function attach(socket, getContext) {
    socket.on("games:queue:set", async ({ selected } = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = await withLock(context.sessionId, () => store.configure(
        context.sessionId,
        context.role,
        selected,
        availableGameTypes()
      ));
      if (!result.ok) return reject(socket, "set", result.reason);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("games:queue:start", async () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = await startQueue(context);
      if (!result.ok) return reject(socket, "start", result.reason);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("games:queue:skip", async () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const currentGameType = store.getSession(context.sessionId).current_game_type;
      const result = await advanceNow(context, currentGameType);
      if (!result.ok) return reject(socket, "skip", result.reason);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("games:queue:end", async () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = await withLock(context.sessionId, () => {
        clearTimer(context.sessionId);
        const currentGameType = store.getSession(context.sessionId).current_game_type;
        if (currentGameType) {
          const closed = closeGame(context, currentGameType);
          if (!closed.ok) return closed;
        }
        return store.end(context.sessionId, context.role);
      });
      if (!result.ok) return reject(socket, "end", result.reason);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("games:queue:request_state", () => sendCurrentState(socket, getContext()));
  }

  function sendCurrentState(socket, context) {
    if (context?.sessionId) socket.emit("games:queue:state", snapshot(context.sessionId));
  }

  function closeAll() {
    for (const sessionId of Array.from(timers.keys())) clearTimer(sessionId);
  }

  function resetSession(context) {
    if (!context?.roomKey || !context?.sessionId) return;
    clearTimer(context.sessionId);
    for (const gameType of coordinator?.getRegisteredGameTypes?.() || []) {
      coordinator.getGameRuntime?.(gameType)?.resetSession?.(context);
    }
    store.reset(context.sessionId);
    emitState(context.roomKey, context.sessionId);
  }

  return { attach, sendCurrentState, emitState, handleGameFinished, closeAll, resetSession, snapshot };
}

module.exports = { createGameQueueSocketHandlers, AUTO_ADVANCE_DELAY_MS };
