const RAFFLE_STATES = new Set(["collecting", "entries_closed", "drawing", "winner", "closed"]);
const RAFFLE_MODES = new Set(["visual_key", "poll", "free"]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value, fallback = "") {
  return String(value || fallback).trim();
}

function createRaffleId() {
  return "raffle_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function normalizeOption(option, index) {
  const label = normalizeText(option?.label);
  if (!label) return null;
  return {
    id: normalizeText(option?.id, "opt_" + (index + 1)),
    label
  };
}

function publicEntry(entry) {
  if (!entry) return null;
  return {
    audienceId: entry.audienceId,
    name: entry.name,
    label: entry.label,
    selectedOptionId: entry.selectedOptionId,
    enteredAt: entry.enteredAt
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

  normalizeRaffle(config = {}) {
    const mode = RAFFLE_MODES.has(config.mode) ? config.mode : "free";
    const options = Array.isArray(config.poll?.options || config.options)
      ? (config.poll?.options || config.options).map(normalizeOption).filter(Boolean)
      : [];

    if (mode === "poll" && options.length < 2) {
      return { ok: false, reason: "poll_options_required" };
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
        entryKey: normalizeText(config.entryKey || config.visualKey || config.key),
        options,
        entries: new Map(),
        eligibleSnapshot: null,
        winners: [],
        winner: null,
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
    if (session.active && session.active.state !== "closed") {
      return { ok: false, reason: "active_raffle_exists" };
    }

    const normalized = this.normalizeRaffle(config);
    if (!normalized.ok) return normalized;
    session.active = normalized.raffle;
    return { ok: true, raffle: session.active };
  }

  getActive(sessionId) {
    return this.getSession(sessionId).active;
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

  enter({ sessionId, audienceId, name, label, key }) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "collecting") return { ok: false, reason: "entries_not_collecting" };
    if (!audienceId) return { ok: false, reason: "missing_audience_id" };
    if (raffle.mode === "poll") return { ok: false, reason: "use_poll_response" };
    if (raffle.mode === "visual_key" && raffle.entryKey && normalizeText(key) !== raffle.entryKey) {
      return { ok: false, reason: "invalid_key" };
    }
    if (raffle.entries.has(audienceId)) return { ok: false, reason: "duplicate_entry" };

    const entry = this.createEntry({ raffle, audienceId, name, label });
    raffle.entries.set(audienceId, entry);
    return { ok: true, entry };
  }

  submitPollResponse({ sessionId, audienceId, optionId, name }) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
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

  eligibleEntries(session, raffle) {
    const previousWinners = session.previousWinnerAudienceIds;
    const source = raffle.eligibleSnapshot || Array.from(raffle.entries.values());
    return source.filter((entry) => !previousWinners.has(entry.audienceId));
  }

  closeEntries(sessionId) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "collecting") return { ok: false, reason: "invalid_state" };

    raffle.state = "entries_closed";
    raffle.entriesClosedAt = nowIso();
    raffle.eligibleSnapshot = this.eligibleEntries(session, raffle).map((entry) => ({ ...entry }));
    return { ok: true, raffle };
  }

  drawWinner(sessionId) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    if (raffle.state !== "entries_closed") return { ok: false, reason: "invalid_state" };

    const eligible = this.eligibleEntries(session, raffle);
    if (!eligible.length) return { ok: false, reason: "no_eligible_entries" };

    raffle.state = "drawing";
    raffle.drawingAt = nowIso();
    const drawingState = this.getState(sessionId);
    const winner = { ...eligible[Math.floor(this.random() * eligible.length)], selectedAt: nowIso() };
    raffle.state = "winner";
    raffle.winner = winner;
    raffle.winners = [winner];
    raffle.winnerSelectedAt = winner.selectedAt;
    session.winners.push(winner);
    session.previousWinnerAudienceIds.add(winner.audienceId);

    return { ok: true, drawingState, winner, raffle };
  }

  close(sessionId) {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) return { ok: false, reason: "raffle_not_active" };
    raffle.state = "closed";
    raffle.closedAt = nowIso();
    const closedState = this.getState(sessionId);
    session.active = null;
    return { ok: true, raffle, closedState };
  }

  resetWinners(sessionId) {
    const session = this.getSession(sessionId);
    session.previousWinnerAudienceIds = new Set();
    session.winners = [];
    if (session.active) {
      session.active.winners = [];
      session.active.winner = null;
    }
    return { ok: true, state: this.getState(sessionId) };
  }

  getPollResults(raffle) {
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

  getState(sessionId, audienceId = "") {
    const session = this.getSession(sessionId);
    const raffle = session.active;
    if (!raffle) {
      return {
        active: null,
        winners: session.winners.map(publicEntry),
        previousWinnerCount: session.previousWinnerAudienceIds.size
      };
    }

    const entry = audienceId ? raffle.entries.get(String(audienceId)) : null;
    const eligible = this.eligibleEntries(session, raffle);
    return {
      active: {
        id: raffle.id,
        type: raffle.type,
        mode: raffle.mode,
        state: RAFFLE_STATES.has(raffle.state) ? raffle.state : "closed",
        title: raffle.title,
        prompt: raffle.prompt,
        options: raffle.options,
        entryCount: raffle.entries.size,
        eligibleCount: eligible.length,
        winner: publicEntry(raffle.winner),
        winners: raffle.winners.map(publicEntry),
        ownEntry: ownEntry(entry),
        createdAt: raffle.createdAt,
        entriesClosedAt: raffle.entriesClosedAt,
        drawingAt: raffle.drawingAt,
        winnerSelectedAt: raffle.winnerSelectedAt,
        closedAt: raffle.closedAt,
        pollResults: this.getPollResults(raffle)
      },
      winners: session.winners.map(publicEntry),
      previousWinnerCount: session.previousWinnerAudienceIds.size
    };
  }
}

function createRaffleSocketHandlers({ io, store, getRoleRoomKey }) {
  function canControlRaffles(context) {
    return context?.role === "presenter" || context?.role === "stage";
  }

  function emitStateToRoom(roomKey, sessionId) {
    const baseState = store.getState(sessionId);
    io.to(getRoleRoomKey(roomKey, "presenter")).emit("raffle:state", baseState);
    io.to(getRoleRoomKey(roomKey, "stage")).emit("raffle:state", baseState);
    io.to(getRoleRoomKey(roomKey, "screen")).emit("raffle:state", baseState);
    io.to(getRoleRoomKey(roomKey, "viewer")).emit("raffle:state", baseState);
  }

  function reject(socket, event, reason, extra = {}) {
    socket.emit("raffle:rejected", { event, reason, ...extra });
  }

  function attach(socket, getContext) {
    socket.on("raffle:create", (config = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.create({ sessionId: context.sessionId, config });
      if (!result.ok) return reject(socket, "raffle:create", result.reason);
      io.to(context.roomKey).emit("raffle:active", store.getState(context.sessionId).active);
      emitStateToRoom(context.roomKey, context.sessionId);
    });

    socket.on("raffle:enter", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "audience") return;
      const audienceId = String(payload.audienceId || context.audienceId || "");
      const result = store.enter({
        sessionId: context.sessionId,
        audienceId,
        name: payload.name,
        label: payload.label,
        key: payload.key
      });
      if (!result.ok) return reject(socket, "raffle:enter", result.reason);
      socket.emit("raffle:entry_accepted", { entry: ownEntry(result.entry) });
      socket.emit("raffle:state", store.getState(context.sessionId, audienceId));
      emitStateToRoom(context.roomKey, context.sessionId);
    });

    socket.on("raffle:submit_poll_response", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "audience") return;
      const audienceId = String(payload.audienceId || context.audienceId || "");
      const result = store.submitPollResponse({
        sessionId: context.sessionId,
        audienceId,
        optionId: String(payload.optionId || ""),
        name: payload.name
      });
      if (!result.ok) return reject(socket, "raffle:submit_poll_response", result.reason);
      socket.emit("raffle:poll_response_accepted", { entry: ownEntry(result.entry) });
      socket.emit("raffle:state", store.getState(context.sessionId, audienceId));
      emitStateToRoom(context.roomKey, context.sessionId);
    });

    socket.on("raffle:close_entries", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.closeEntries(context.sessionId);
      if (!result.ok) return reject(socket, "raffle:close_entries", result.reason);
      io.to(context.roomKey).emit("raffle:entries_closed", store.getState(context.sessionId).active);
      emitStateToRoom(context.roomKey, context.sessionId);
    });

    socket.on("raffle:draw", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.drawWinner(context.sessionId);
      if (!result.ok) return reject(socket, "raffle:draw", result.reason);
      io.to(context.roomKey).emit("raffle:drawing", result.drawingState.active);
      io.to(context.roomKey).emit("raffle:winner", { winner: publicEntry(result.winner), raffle: store.getState(context.sessionId).active });
      emitStateToRoom(context.roomKey, context.sessionId);
    });

    socket.on("raffle:close", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.close(context.sessionId);
      if (!result.ok) return reject(socket, "raffle:close", result.reason);
      io.to(context.roomKey).emit("raffle:closed", result.closedState.active);
      emitStateToRoom(context.roomKey, context.sessionId);
    });

    socket.on("raffle:reset_winners", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlRaffles(context)) return;
      const result = store.resetWinners(context.sessionId);
      io.to(context.roomKey).emit("raffle:winners_reset", result.state);
      emitStateToRoom(context.roomKey, context.sessionId);
    });
  }

  function sendCurrentState(socket, context) {
    if (!context?.sessionId) return;
    socket.emit("raffle:state", store.getState(context.sessionId, context.audienceId));
  }

  return { attach, sendCurrentState };
}

module.exports = { RaffleStore, createRaffleSocketHandlers, RAFFLE_STATES, RAFFLE_MODES };
