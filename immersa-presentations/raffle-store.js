const RAFFLE_STATES = new Set(["collecting", "entries_closed", "drawing", "winner", "closed"]);
const RAFFLE_MODES = new Set(["visual_key", "poll", "free"]);
const AUTO_REVEAL_DELAY_MS = 5000;

function nowIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function createRaffleId() {
  return "raffle_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function normalizeOption(option, index) {
  const label = normalizeText(option?.label);
  const id = normalizeText(option?.id, "opt_" + (index + 1));
  if (!id || !label) return null;
  return { id, label };
}

function uniqueOptions(options) {
  const seen = new Set();
  const unique = [];
  for (const option of options) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    unique.push(option);
  }
  return unique;
}

function publicEntry(entry) {
  if (!entry) return null;
  return {
    audienceId: entry.audienceId,
    name: entry.name,
    label: entry.label,
    selectedOptionId: entry.selectedOptionId,
    enteredAt: entry.enteredAt,
    selectedAt: entry.selectedAt || null
  };
}

function ownEntry(entry) {
  if (!entry) return null;
  return {
    label: entry.label,
    selectedOptionId: entry.selectedOptionId,
    enteredAt: entry.enteredAt
  };
}

function audienceEntry(audience) {
  const audienceId = normalizeText(audience?.audienceId || audience?.id);
  if (!audienceId) return null;
  return {
    audienceId,
    name: normalizeText(audience?.name, "Participante"),
    label: normalizeText(audience?.label || audience?.name, "Participante"),
    selectedOptionId: null,
    enteredAt: nowIso()
  };
}

function raffleEligibleEntries(session, raffle) {
  const previousWinners = session.previousWinnerAudienceIds;
  const source = raffle.eligibleSnapshot || Array.from(raffle.entries.values());
  return source.filter((entry) => !previousWinners.has(entry.audienceId));
}

function activeBase(raffle) {
  return {
    id: raffle.id,
    type: raffle.type,
    mode: raffle.mode,
    state: RAFFLE_STATES.has(raffle.state) ? raffle.state : "closed",
    title: raffle.title,
    prompt: raffle.prompt,
    createdAt: raffle.createdAt,
    entriesClosedAt: raffle.entriesClosedAt,
    drawingAt: raffle.drawingAt,
    revealAt: raffle.revealAt,
    drawingEndsAt: raffle.revealAt,
    winnerSelectedAt: raffle.winnerSelectedAt,
    closedAt: raffle.closedAt
  };
}

function controllerActive(raffle, session) {
  if (!raffle) return null;
  const eligible = raffleEligibleEntries(session, raffle);
  return {
    ...activeBase(raffle),
    options: raffle.options,
    entryKey: raffle.entryKey,
    entryCount: raffle.entries.size,
    eligibleCount: eligible.length,
    entries: Array.from(raffle.entries.values()).map(publicEntry),
    pendingWinnerSelected: Boolean(raffle.pendingWinner),
    winner: raffle.state === "winner" ? publicEntry(raffle.winner) : null,
    winners: raffle.state === "winner" ? raffle.winners.map(publicEntry) : [],
    pollResults: pollResults(raffle)
  };
}

function screenActive(raffle) {
  if (!raffle) return null;
  return {
    ...activeBase(raffle),
    hasWinner: raffle.state === "winner" && Boolean(raffle.winner)
  };
}

function audienceActive(raffle, audienceId) {
  if (!raffle) return null;
  const entry = audienceId ? raffle.entries.get(String(audienceId)) : null;
  return {
    ...activeBase(raffle),
    options: raffle.state === "collecting" ? raffle.options : [],
    ownEntry: ownEntry(entry),
    isWinner: raffle.state === "winner" && raffle.winner?.audienceId === String(audienceId || "")
  };
}

function pollResults(raffle) {
  if (!raffle || raffle.mode !== "poll") return null;
  const totalResponses = raffle.entries.size;
  return {
    totalResponses,
    options: raffle.options.map((option) => {
      const count = Array.from(raffle.entries.values()).filter((entry) => entry.selectedOptionId === option.id).length;
      return {
        id: option.id,
        label: option.label,
        count,
        percentage: totalResponses ? Math.round((count / totalResponses) * 100) : 0
      };
    })
  };
}

class RaffleStore {
  constructor(random = Math.random) {
    this.random = random;
    this.sessions = new Map();
  }

  getSession(sessionId) {
    const key = String(sessionId || "");
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        active: null,
        winners: [],
        previousWinnerAudienceIds: new Set()
      });
    }
    return this.sessions.get(key);
  }

  getActive(sessionId) {
    return this.getSession(sessionId).active;
  }

  normalizeRaffle(config = {}) {
    if (!RAFFLE_MODES.has(config.mode)) return { ok: false, reason: "invalid_raffle_mode" };
    const mode = config.mode;
    const options = uniqueOptions(
      (Array.isArray(config.poll?.options || config.options) ? (config.poll?.options || config.options) : [])
        .map(normalizeOption)
        .filter(Boolean)
    );
    const entryKey = normalizeText(config.entryKey || config.visualKey || config.key);

    if (mode === "poll" && options.length < 2) return { ok: false, reason: "poll_options_required" };
    if (mode === "visual_key") {
      if (options.length !== 4) return { ok: false, reason: "visual_key_requires_four_options" };
      if (!entryKey) return { ok: false, reason: "entry_key_required" };
      if (!options.some((option) => option.id === entryKey)) return { ok: false, reason: "entry_key_must_match_option" };
    }

    return {
      ok: true,
      raffle: {
        id: normalizeText(config.id, createRaffleId()),
        type: "raffle",
        mode,
        state: "collecting",
        title: normalizeText(config.title, "Sorteo"),
        prompt: normalizeText(config.prompt, mode === "poll" ? "Elige una opcion" : "Participa en el sorteo"),
        entryKey,
        options,
        entries: new Map(),
        eligibleSnapshot: null,
        pendingWinner: null,
        winners: [],
        winner: null,
        revealAt: null,
        createdAt: nowIso(),
        entriesClosedAt: null,
        drawingAt: null,
        winnerSelectedAt: null,
        closedAt: null
      }
    };
  }

  create({ sessionId, config }) {
    const session = this.getSession(sessionId);
    if (session.active && session.active.state !== "closed") return { ok: false, reason: "active_raffle_exists" };
    const normalized = this.normalizeRaffle(config);
    if (!normalized.ok) return normalized;
    session.active = normalized.raffle;
    return { ok: true, raffle: session.active };
  }

  findOption(raffle, optionId) {
    return raffle.options.find((option) => option.id === optionId) || null;
  }

  createEntry({ raffle, audienceId, name, label, selectedOptionId = null }) {
    const option = selectedOptionId ? this.findOption(raffle, selectedOptionId) : null;
    return {
      audienceId,
      name: normalizeText(name, "Participante"),
      label: normalizeText(label || name, option?.label || "Participante"),
      selectedOptionId,
      enteredAt: nowIso()
    };
  }

  enter({ sessionId, audienceId, name, label, optionId }) {
    const raffle = this.getSession(sessionId).active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "collecting") return { ok: false, reason: "entries_not_collecting" };
    if (!audienceId) return { ok: false, reason: "missing_audience_id" };
    if (raffle.mode === "poll") return { ok: false, reason: "use_poll_response" };
    if (raffle.mode === "free") return { ok: false, reason: "free_mode_does_not_use_entries" };
    if (raffle.entries.has(audienceId)) return { ok: false, reason: "duplicate_entry" };

    const selectedOptionId = normalizeText(optionId);
    if (!this.findOption(raffle, selectedOptionId)) return { ok: false, reason: "invalid_option" };
    if (selectedOptionId !== raffle.entryKey) return { ok: false, reason: "incorrect_option" };

    const entry = this.createEntry({ raffle, audienceId, name, label, selectedOptionId });
    raffle.entries.set(audienceId, entry);
    return { ok: true, entry };
  }

  submitPollResponse({ sessionId, audienceId, optionId, name }) {
    const raffle = this.getSession(sessionId).active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.mode !== "poll") return { ok: false, reason: "not_poll_raffle" };
    if (raffle.state !== "collecting") return { ok: false, reason: "entries_not_collecting" };
    if (!audienceId) return { ok: false, reason: "missing_audience_id" };
    if (raffle.entries.has(audienceId)) return { ok: false, reason: "duplicate_entry" };

    const option = this.findOption(raffle, String(optionId || ""));
    if (!option) return { ok: false, reason: "invalid_option" };

    const entry = this.createEntry({
      raffle,
      audienceId,
      name,
      label: option.label,
      selectedOptionId: option.id
    });
    raffle.entries.set(audienceId, entry);
    return { ok: true, entry };
  }

  closeEntries(sessionId, connectedAudience = []) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "collecting") return { ok: false, reason: "invalid_state" };

    if (raffle.mode === "free") {
      raffle.entries = new Map();
      for (const audience of connectedAudience) {
        const entry = audienceEntry(audience);
        if (entry) raffle.entries.set(entry.audienceId, entry);
      }
    }

    raffle.state = "entries_closed";
    raffle.entriesClosedAt = nowIso();
    raffle.eligibleSnapshot = raffleEligibleEntries(session, raffle).map((entry) => ({ ...entry }));
    return { ok: true, raffle };
  }

  drawWinner(sessionId, connectedAudienceIds = [], options = {}) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "entries_closed") return { ok: false, reason: "invalid_state" };

    const eligible = raffleEligibleEntries(session, raffle);
    if (!eligible.length) return { ok: false, reason: "no_eligible_entries" };

    const connected = new Set(connectedAudienceIds.map(String));
    const connectedEligible = eligible.filter((entry) => connected.has(entry.audienceId));
    if (!connectedEligible.length) return { ok: false, reason: "no_connected_eligible_entries" };

    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const revealDelayMs = Number.isFinite(options.revealDelayMs) ? options.revealDelayMs : AUTO_REVEAL_DELAY_MS;
    const pendingWinner = { ...connectedEligible[Math.floor(this.random() * connectedEligible.length)], selectedAt: nowIso(nowMs) };
    raffle.state = "drawing";
    raffle.drawingAt = nowIso(nowMs);
    raffle.revealAt = nowIso(nowMs + revealDelayMs);
    raffle.pendingWinner = pendingWinner;
    return { ok: true, pendingWinner, revealAt: raffle.revealAt, raffle };
  }

  revealWinner(sessionId, options = {}) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "drawing") return { ok: false, reason: "invalid_state" };
    if (!raffle.pendingWinner) return { ok: false, reason: "no_pending_winner" };

    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    raffle.state = "winner";
    raffle.winner = raffle.pendingWinner;
    raffle.winners = [raffle.winner];
    raffle.winnerSelectedAt = nowIso(nowMs);
    raffle.pendingWinner = null;
    session.winners.push(raffle.winner);
    session.previousWinnerAudienceIds.add(raffle.winner.audienceId);
    return { ok: true, winner: raffle.winner, raffle };
  }

  revealDueWinners(nowMs = Date.now()) {
    const revealed = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      const raffle = session.active;
      const revealTime = raffle?.revealAt ? Date.parse(raffle.revealAt) : NaN;
      if (raffle?.state === "drawing" && Number.isFinite(revealTime) && revealTime <= nowMs) {
        const result = this.revealWinner(sessionId, { nowMs });
        if (result.ok) revealed.push({ sessionId, result });
      }
    }
    return revealed;
  }

  close(sessionId) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    raffle.state = "closed";
    raffle.closedAt = nowIso();
    const closed = raffle;
    session.active = null;
    return { ok: true, raffle: closed };
  }

  resetWinners(sessionId) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (raffle && raffle.state !== "entries_closed") return { ok: false, reason: "invalid_state" };
    session.previousWinnerAudienceIds = new Set();
    session.winners = [];
    if (raffle) raffle.eligibleSnapshot = Array.from(raffle.entries.values()).map((entry) => ({ ...entry }));
    return { ok: true, active: raffle || null };
  }

  getControllerState(sessionId) {
    const session = this.getSession(sessionId);
    return {
      active: controllerActive(session.active, session),
      winners: session.winners.map(publicEntry),
      previousWinnerCount: session.previousWinnerAudienceIds.size
    };
  }

  getScreenState(sessionId) {
    const session = this.getSession(sessionId);
    return { active: screenActive(session.active) };
  }

  getAudienceState(sessionId, audienceId = "") {
    const session = this.getSession(sessionId);
    return { active: audienceActive(session.active, audienceId) };
  }
}

function createRaffleSocketHandlers({ io, store, getRoleRoomKey, getConnectedAudience = () => [], coordinator = null, revealDelayMs = AUTO_REVEAL_DELAY_MS }) {
  const revealTimers = new Map();

  function canControlRaffles(context) {
    return context?.role === "presenter" || context?.role === "stage";
  }

  function timerKey(sessionId) {
    return String(sessionId || "");
  }

  function clearAutoReveal(sessionId) {
    const key = timerKey(sessionId);
    const timer = revealTimers.get(key);
    if (timer) clearTimeout(timer);
    revealTimers.delete(key);
  }

  function emitWinner(context, result) {
    io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("raffle:winner", { raffle: store.getControllerState(context.sessionId).active });
    io.to(getRoleRoomKey(context.roomKey, "stage")).emit("raffle:winner", { raffle: store.getControllerState(context.sessionId).active });
    io.to(getRoleRoomKey(context.roomKey, "screen")).emit("raffle:winner", { hasWinner: true, raffle: store.getScreenState(context.sessionId).active });
    io.to(audienceRoom(context.roomKey, result.winner.audienceId)).emit("raffle:winner", { isWinner: true, raffleId: result.raffle.id });
    emitAllStates(context);
  }

  function scheduleAutoReveal(context, revealAt) {
    clearAutoReveal(context.sessionId);
    const revealTime = Date.parse(revealAt);
    if (!Number.isFinite(revealTime)) return;
    const delay = Math.max(0, revealTime - Date.now());
    revealTimers.set(timerKey(context.sessionId), setTimeout(() => {
      revealTimers.delete(timerKey(context.sessionId));
      const result = store.revealWinner(context.sessionId);
      if (result.ok) emitWinner(context, result);
    }, delay));
  }

  function connectedAudience(context) {
    return getConnectedAudience(context.roomKey).map((audience) => ({ ...audience, audienceId: String(audience.audienceId || audience.id || "") }));
  }

  function connectedAudienceIds(context) {
    return connectedAudience(context).map((audience) => audience.audienceId).filter(Boolean);
  }

  function audienceRoom(roomKey, audienceId) {
    return getRoleRoomKey(roomKey, "audience:" + audienceId);
  }

  function emitControllerState(roomKey, sessionId) {
    const state = store.getControllerState(sessionId);
    io.to(getRoleRoomKey(roomKey, "presenter")).emit("raffle:state", state);
    io.to(getRoleRoomKey(roomKey, "stage")).emit("raffle:state", state);
    return state;
  }

  function emitScreenState(roomKey, sessionId) {
    const state = store.getScreenState(sessionId);
    io.to(getRoleRoomKey(roomKey, "screen")).emit("raffle:state", state);
    io.to(getRoleRoomKey(roomKey, "viewer")).emit("raffle:state", state);
    return state;
  }

  function emitAudienceStates(context) {
    for (const audience of connectedAudience(context)) {
      if (!audience.audienceId) continue;
      io.to(audienceRoom(context.roomKey, audience.audienceId)).emit("raffle:state", store.getAudienceState(context.sessionId, audience.audienceId));
    }
  }

  function emitAllStates(context) {
    emitControllerState(context.roomKey, context.sessionId);
    emitScreenState(context.roomKey, context.sessionId);
    emitAudienceStates(context);
  }

  function reject(socket, event, reason, extra = {}) {
    socket.emit("raffle:rejected", { event, reason, ...extra });
  }

  async function createRaffle(context, config) {
    const execute = () => {
      if (coordinator?.hasActiveInteraction(context.sessionId)) return { ok: false, reason: "active_interaction_exists" };
      clearAutoReveal(context.sessionId);
      return store.create({ sessionId: context.sessionId, config });
    };
    return coordinator ? coordinator.withSessionLock(context.sessionId, execute) : execute();
  }

  function attach(socket, getContext) {
    socket.on("raffle:create", async (config = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = await createRaffle(context, config);
      if (!result.ok) return reject(socket, "raffle:create", result.reason);
      io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("raffle:active", store.getControllerState(context.sessionId).active);
      io.to(getRoleRoomKey(context.roomKey, "stage")).emit("raffle:active", store.getControllerState(context.sessionId).active);
      emitAllStates(context);
    });

    socket.on("raffle:enter", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "audience") return;
      const audienceId = String(context.audienceId || payload.audienceId || "");
      const result = store.enter({
        sessionId: context.sessionId,
        audienceId,
        name: payload.name,
        label: payload.label,
        optionId: payload.optionId
      });
      if (!result.ok) return reject(socket, "raffle:enter", result.reason);
      socket.emit("raffle:entry_accepted", { entry: ownEntry(result.entry) });
      socket.emit("raffle:state", store.getAudienceState(context.sessionId, audienceId));
      emitControllerState(context.roomKey, context.sessionId);
      emitScreenState(context.roomKey, context.sessionId);
    });

    socket.on("raffle:submit_poll_response", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "audience") return;
      const audienceId = String(context.audienceId || payload.audienceId || "");
      const result = store.submitPollResponse({
        sessionId: context.sessionId,
        audienceId,
        optionId: String(payload.optionId || ""),
        name: payload.name
      });
      if (!result.ok) return reject(socket, "raffle:submit_poll_response", result.reason);
      socket.emit("raffle:poll_response_accepted", { entry: ownEntry(result.entry) });
      socket.emit("raffle:state", store.getAudienceState(context.sessionId, audienceId));
      emitControllerState(context.roomKey, context.sessionId);
      emitScreenState(context.roomKey, context.sessionId);
    });

    socket.on("raffle:close_entries", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      clearAutoReveal(context.sessionId);
      const result = store.closeEntries(context.sessionId, connectedAudience(context));
      if (!result.ok) return reject(socket, "raffle:close_entries", result.reason);
      io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("raffle:entries_closed", store.getControllerState(context.sessionId).active);
      io.to(getRoleRoomKey(context.roomKey, "stage")).emit("raffle:entries_closed", store.getControllerState(context.sessionId).active);
      emitAllStates(context);
    });

    socket.on("raffle:draw", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.drawWinner(context.sessionId, connectedAudienceIds(context), { revealDelayMs });
      if (!result.ok) return reject(socket, "raffle:draw", result.reason);
      scheduleAutoReveal(context, result.revealAt);
      io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("raffle:drawing", store.getControllerState(context.sessionId).active);
      io.to(getRoleRoomKey(context.roomKey, "stage")).emit("raffle:drawing", store.getControllerState(context.sessionId).active);
      io.to(getRoleRoomKey(context.roomKey, "screen")).emit("raffle:drawing", store.getScreenState(context.sessionId).active);
      emitAllStates(context);
    });

    socket.on("raffle:reveal_winner", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      clearAutoReveal(context.sessionId);
      const result = store.revealWinner(context.sessionId);
      if (!result.ok) return reject(socket, "raffle:reveal_winner", result.reason);
      emitWinner(context, result);
    });

    socket.on("raffle:close", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      clearAutoReveal(context.sessionId);
      const result = store.close(context.sessionId);
      if (!result.ok) return reject(socket, "raffle:close", result.reason);
      io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("raffle:closed", { raffleId: result.raffle.id });
      io.to(getRoleRoomKey(context.roomKey, "stage")).emit("raffle:closed", { raffleId: result.raffle.id });
      io.to(getRoleRoomKey(context.roomKey, "screen")).emit("raffle:closed", { raffleId: result.raffle.id });
      emitAllStates(context);
    });

    socket.on("raffle:reset_winners", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.resetWinners(context.sessionId);
      if (!result.ok) return reject(socket, "raffle:reset_winners", result.reason);
      io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("raffle:winners_reset", store.getControllerState(context.sessionId));
      io.to(getRoleRoomKey(context.roomKey, "stage")).emit("raffle:winners_reset", store.getControllerState(context.sessionId));
      emitAllStates(context);
    });
  }

  function sendCurrentState(socket, context) {
    if (!context?.sessionId) return;
    if (context.role === "presenter" || context.role === "stage") {
      socket.emit("raffle:state", store.getControllerState(context.sessionId));
      return;
    }
    if (context.role === "screen" || context.role === "viewer") {
      socket.emit("raffle:state", store.getScreenState(context.sessionId));
      return;
    }
    socket.emit("raffle:state", store.getAudienceState(context.sessionId, context.audienceId));
  }

  return { attach, sendCurrentState };
}

module.exports = { RaffleStore, createRaffleSocketHandlers, RAFFLE_STATES, RAFFLE_MODES, AUTO_REVEAL_DELAY_MS };
