const TICK_MS = 50;
const BROADCAST_MS = 100;
const LOOP_STATUSES = new Set(["ready", "running"]);

function createPongSocketHandlers({
  io,
  store,
  coordinator = null,
  onFinished = null,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  queueAvailable = false
}) {
  const loops = new Map();
  const audioBySession = new Map();
  const canControl = (context) => context?.role === "presenter" || context?.role === "stage";
  const emitState = (roomKey, sessionId) => io.to(roomKey).emit("pong:state", store.snapshot(sessionId));

  function audioState(sessionId) {
    return audioBySession.get(String(sessionId || "")) || { muted: false, volume: 0.7, pack: "arcade" };
  }

  function normalizeAudioConfig(next = {}) {
    const volume = Number(next?.volume);
    const pack = String(next?.pack || "arcade").trim().toLowerCase();
    return {
      muted: Boolean(next?.muted),
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.7,
      pack: /^[a-z0-9_-]{1,32}$/.test(pack) ? pack : "arcade"
    };
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
    let lastAt = now();
    let lastBroadcastAt = 0;
    const initial = store.snapshot(sessionId, lastAt);
    let lastStatus = initial.status;
    let lastGoalId = initial.last_goal?.id || "";
    const handle = setIntervalFn(() => {
      const nowMs = now();
      const state = store.step(sessionId, nowMs - lastAt, nowMs);
      lastAt = nowMs;
      const goalId = state.last_goal?.id || "";
      if (goalId && goalId !== lastGoalId) io.to(roomKey).emit("pong:goal", state.last_goal);
      lastGoalId = goalId;
      if (nowMs - lastBroadcastAt >= BROADCAST_MS || !LOOP_STATUSES.has(state.status)) {
        io.to(roomKey).emit("pong:state", state);
        lastBroadcastAt = nowMs;
      }
      if (state.status === "finished" && lastStatus !== "finished") {
        onFinished?.({ sessionId, roomKey, gameType: "pong", state });
      }
      lastStatus = state.status;
      if (!LOOP_STATUSES.has(state.status)) stopLoop(sessionId);
    }, TICK_MS);
    handle?.unref?.();
    loops.set(key, { handle, roomKey });
  }

  function clearCompeting(context) {
    const { sessionId, roomKey } = context;
    const interactionStore = coordinator?.interactionStore;
    const raffleStore = coordinator?.raffleStore;
    const canCloseGames = typeof coordinator?.closeActiveGames === "function";
    if (!interactionStore && !raffleStore && !canCloseGames && coordinator?.hasAnyActive?.(sessionId, "pong")) {
      return { ok: false, reason: "active_interaction_exists" };
    }
    const interaction = interactionStore?.getSession(sessionId)?.active || null;
    if (interaction) {
      interactionStore.close(sessionId);
      io.to(roomKey).emit("interaction:closed", { interactionId: interaction.id || "" });
      io.to(roomKey).emit("interaction:state", { active: null, response: null, resultsVisible: false });
      io.to(roomKey).emit("interaction:hide_results", { interactionId: interaction.id || "" });
    }
    const raffle = raffleStore?.getActive(sessionId) || null;
    if (raffle) {
      raffleStore.close(sessionId);
      io.to(roomKey).emit("raffle:closed", { raffleId: raffle.id || "" });
      io.to(roomKey).emit("raffle:state", { active: null, previousWinnerCount: 0, visualKeyDraftEntryKey: "" });
    }
    const games = coordinator?.closeActiveGames?.(context, "pong");
    if (games?.ok === false) return games;
    if (coordinator?.hasActiveGame?.(sessionId, "pong")) return { ok: false, reason: "active_interaction_exists" };
    return { ok: true };
  }

  async function transition(context, action, { skipLock = false } = {}) {
    const execute = () => {
      const cleared = clearCompeting(context);
      if (!cleared.ok) return cleared;
      return action === "prepare"
        ? store.prepare(context.sessionId, context.role)
        : store.start(context.sessionId, context.role);
    };
    return coordinator && !skipLock
      ? coordinator.withSessionLock(context.sessionId, execute)
      : execute();
  }

  function reject(socket, action, reason) {
    socket.emit("pong:rejected", { action, reason });
  }

  function sendMembership(socket, context) {
    if (context?.sessionId && context?.role === "audience") {
      socket.emit("pong:membership", store.membership(context.sessionId, context.audienceId));
    }
  }

  function attach(socket, getContext) {
    socket.on("pong:prepare", async () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = await prepareSession(context);
      if (!result.ok) reject(socket, "prepare", result.reason);
    });

    socket.on("pong:start", async () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = await transition(context, "start");
      if (!result.ok) return reject(socket, "start", result.reason);
      stopLoop(context.sessionId);
      emitState(context.roomKey, context.sessionId);
      ensureLoop(context.roomKey, context.sessionId);
    });

    socket.on("pong:pause", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = store.pause(context.sessionId, context.role);
      if (!result.ok) return reject(socket, "pause", result.reason);
      stopLoop(context.sessionId);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("pong:resume", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = store.resume(context.sessionId, context.role);
      if (!result.ok) return reject(socket, "resume", result.reason);
      emitState(context.roomKey, context.sessionId);
      ensureLoop(context.roomKey, context.sessionId);
    });

    socket.on("pong:close", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = closeSession(context);
      if (!result.ok) reject(socket, "close", result.reason);
    });

    socket.on("pong:teams:set", (names = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControl(context)) return;
      const result = store.setTeamNames(context.sessionId, context.role, names);
      if (!result.ok) return reject(socket, "teams:set", result.reason);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("pong:team:join", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "audience" || !context.audienceId) return;
      const result = store.joinTeam(context.sessionId, context.audienceId, payload?.team);
      if (!result.ok) return reject(socket, "team:join", result.reason);
      sendMembership(socket, context);
      emitState(context.roomKey, context.sessionId);
    });

    socket.on("pong:input", (payload = {}) => {
      const context = getContext();
      if (!context?.sessionId || context.role !== "audience" || !context.audienceId) return;
      const result = store.input(context.sessionId, context.audienceId, payload?.direction);
      if (!result.ok && result.reason !== "rate_limited") reject(socket, "input", result.reason);
    });

    socket.on("pong:audio:set", (next = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "stage") return;
      const config = normalizeAudioConfig(next);
      audioBySession.set(String(context.sessionId), config);
      io.to(context.roomKey).emit("pong:audio:state", config);
    });

    socket.on("pong:audio:request", () => {
      const context = getContext();
      if (context?.sessionId) socket.emit("pong:audio:state", audioState(context.sessionId));
    });

    socket.on("pong:request_state", () => sendCurrentState(socket, getContext()));
  }

  async function prepareSession(context, options = {}) {
    if (!context?.roomKey || !context?.sessionId || !canControl(context)) return { ok: false, reason: "unauthorized_role" };
    const result = await transition(context, "prepare", options);
    if (!result.ok) return result;
    emitState(context.roomKey, context.sessionId);
    ensureLoop(context.roomKey, context.sessionId);
    return result;
  }

  function sendCurrentState(socket, context) {
    if (!context?.sessionId) return;
    const state = store.snapshot(context.sessionId);
    socket.emit("pong:audio:state", audioState(context.sessionId));
    socket.emit("pong:state", state);
    sendMembership(socket, context);
    if (LOOP_STATUSES.has(state.status) && context.roomKey) ensureLoop(context.roomKey, context.sessionId);
  }

  function closeSession(context) {
    if (!context?.roomKey || !context?.sessionId || !canControl(context)) return { ok: false, reason: "unauthorized_role" };
    const result = store.close(context.sessionId, context.role);
    if (!result.ok) return result;
    stopLoop(context.sessionId);
    io.to(context.roomKey).emit("pong:closed", store.snapshot(context.sessionId));
    return result;
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
    prepare: prepareSession,
    close: closeSession,
    closeSession,
    closeAll,
    hasActive: (sessionId) => store.hasActive(sessionId),
    queueAvailable: Boolean(queueAvailable),
    audioState,
    constants: { TICK_MS, BROADCAST_MS }
  };
}

module.exports = { createPongSocketHandlers, TICK_MS, BROADCAST_MS };
