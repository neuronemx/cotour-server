const CONTROL_ROLES = new Set(["presenter", "stage"]);

const DEFAULT_GAME_CATALOG = Object.freeze([
  Object.freeze({ id: "breakout", title: "Breakout", mode: "Colaborativo", difficulty: 1 }),
  Object.freeze({ id: "pong", title: "Pong", mode: "Competitivo", difficulty: 2 })
]);

function normalizedAvailable(gameTypes) {
  return new Set(Array.from(gameTypes || []).map((gameType) => String(gameType || "")));
}

function createSession() {
  return {
    status: "idle",
    selected: [],
    current_game_type: "",
    current_index: -1,
    transition_at_ms: null,
    revision: 0
  };
}

class GameQueueStore {
  constructor(options = {}) {
    this.catalog = [...(options.catalog || DEFAULT_GAME_CATALOG)]
      .map((game) => ({ ...game, id: String(game.id || "") }))
      .filter((game) => game.id)
      .sort((a, b) => Number(a.difficulty || 0) - Number(b.difficulty || 0) || a.id.localeCompare(b.id));
    this.catalogById = new Map(this.catalog.map((game) => [game.id, game]));
    this.sessions = new Map();
  }

  getSession(sessionId) {
    const key = String(sessionId || "");
    if (!this.sessions.has(key)) this.sessions.set(key, createSession());
    return this.sessions.get(key);
  }

  reset(sessionId) {
    this.sessions.delete(String(sessionId || ""));
    return this.getSession(sessionId);
  }

  orderedSelection(gameTypes) {
    const requested = new Set(Array.from(gameTypes || []).map((gameType) => String(gameType || "")));
    return this.catalog.filter((game) => requested.has(game.id)).map((game) => game.id);
  }

  configure(sessionId, role, gameTypes, availableGameTypes) {
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    const session = this.getSession(sessionId);
    if (session.status !== "idle") return { ok: false, reason: "queue_locked" };
    const requested = Array.from(new Set(Array.from(gameTypes || []).map((gameType) => String(gameType || ""))));
    if (requested.some((gameType) => !this.catalogById.has(gameType))) return { ok: false, reason: "unknown_game" };
    const available = normalizedAvailable(availableGameTypes);
    if (requested.some((gameType) => !available.has(gameType))) return { ok: false, reason: "game_unavailable" };
    session.selected = this.orderedSelection(requested);
    session.revision += 1;
    return { ok: true, state: session };
  }

  validateStart(sessionId, role, availableGameTypes) {
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    const session = this.getSession(sessionId);
    if (session.status !== "idle") return { ok: false, reason: "queue_locked" };
    if (!session.selected.length) return { ok: false, reason: "empty_queue" };
    const available = normalizedAvailable(availableGameTypes);
    if (session.selected.some((gameType) => !available.has(gameType))) return { ok: false, reason: "game_unavailable" };
    return { ok: true, gameType: session.selected[0] };
  }

  start(sessionId, gameType) {
    const session = this.getSession(sessionId);
    if (session.status !== "idle" || session.selected[0] !== gameType) return { ok: false, reason: "invalid_state" };
    session.status = "running";
    session.current_game_type = gameType;
    session.current_index = 0;
    session.transition_at_ms = null;
    session.revision += 1;
    return { ok: true, state: session };
  }

  nextGameType(sessionId) {
    const session = this.getSession(sessionId);
    return session.selected[session.current_index + 1] || "";
  }

  scheduleTransition(sessionId, gameType, transitionAtMs) {
    const session = this.getSession(sessionId);
    if (session.status !== "running" || session.current_game_type !== gameType) return { ok: false, reason: "invalid_state" };
    session.transition_at_ms = Number(transitionAtMs) || null;
    session.revision += 1;
    return { ok: true, state: session };
  }

  advance(sessionId, expectedGameType, nextGameType) {
    const session = this.getSession(sessionId);
    if (session.status !== "running" || session.current_game_type !== expectedGameType || this.nextGameType(sessionId) !== nextGameType) {
      return { ok: false, reason: "invalid_state" };
    }
    session.current_index += 1;
    session.current_game_type = nextGameType;
    session.transition_at_ms = null;
    session.revision += 1;
    return { ok: true, state: session };
  }

  finish(sessionId, gameType) {
    const session = this.getSession(sessionId);
    if (session.status !== "running" || session.current_game_type !== gameType) return { ok: false, reason: "invalid_state" };
    session.status = "finished";
    session.transition_at_ms = null;
    session.revision += 1;
    return { ok: true, state: session };
  }

  end(sessionId, role) {
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    const session = this.getSession(sessionId);
    session.status = "idle";
    session.current_game_type = "";
    session.current_index = -1;
    session.transition_at_ms = null;
    session.revision += 1;
    return { ok: true, state: session };
  }

  snapshot(sessionId, availableGameTypes) {
    const session = this.getSession(sessionId);
    const available = normalizedAvailable(availableGameTypes);
    return {
      status: session.status,
      selected: [...session.selected],
      current_game_type: session.current_game_type,
      current_index: session.current_index,
      next_game_type: this.nextGameType(sessionId),
      transition_at_ms: session.transition_at_ms,
      locked: session.status !== "idle",
      revision: session.revision,
      catalog: this.catalog.map((game) => ({ ...game, available: available.has(game.id) }))
    };
  }
}

module.exports = { GameQueueStore, DEFAULT_GAME_CATALOG, CONTROL_ROLES, createSession };
