class ActiveInteractionCoordinator {
  constructor({ interactionStore, raffleStore, breakoutStore = null, gameRuntimes = null }) {
    this.interactionStore = interactionStore;
    this.raffleStore = raffleStore;
    this.gameRuntimes = new Map();
    this.activityRuntimes = new Map();
    this.locks = new Map();
    this.activityListeners = new Set();

    if (gameRuntimes) {
      const entries = gameRuntimes instanceof Map ? gameRuntimes.entries() : Object.entries(gameRuntimes);
      for (const [gameType, runtime] of entries) this.registerGame(gameType, runtime);
    }
    if (breakoutStore) this.registerGame("breakout", breakoutStore);
  }

  registerGame(gameType, runtime) {
    const type = String(gameType || "").trim();
    if (!type) throw new Error("gameType is required");
    if (!runtime || typeof runtime.hasActive !== "function") {
      throw new Error(`Game runtime ${type} must expose hasActive(sessionId)`);
    }
    const current = this.gameRuntimes.get(type);
    if (current && current !== runtime) throw new Error(`Game runtime already registered: ${type}`);
    this.gameRuntimes.set(type, runtime);
    return runtime;
  }

  registerActivity(activityType, runtime) {
    const type = String(activityType || "").trim();
    if (!type) throw new Error("activityType is required");
    if (!runtime || typeof runtime.hasActive !== "function") {
      throw new Error(`Activity runtime ${type} must expose hasActive(sessionId)`);
    }
    const current = this.activityRuntimes.get(type);
    if (current && current !== runtime) throw new Error(`Activity runtime already registered: ${type}`);
    this.activityRuntimes.set(type, runtime);
    return runtime;
  }

  getActiveActivityType(sessionId, exceptActivityType = "") {
    const except = String(exceptActivityType || "").replace(/^activity:/, "");
    for (const [activityType, runtime] of this.activityRuntimes.entries()) {
      if (activityType !== except && runtime.hasActive(sessionId)) return activityType;
    }
    return "";
  }

  hasActiveActivity(sessionId, exceptActivityType = "") {
    return Boolean(this.getActiveActivityType(sessionId, exceptActivityType));
  }

  getGameRuntime(gameType) {
    return this.gameRuntimes.get(String(gameType || "")) || null;
  }

  getRegisteredGameTypes(requiredMethod = "") {
    const method = String(requiredMethod || "");
    return Array.from(this.gameRuntimes.entries())
      .filter(([, runtime]) => !method || typeof runtime?.[method] === "function")
      .map(([gameType]) => gameType);
  }

  getActiveGameType(sessionId, exceptGameType = "") {
    const except = String(exceptGameType || "").replace(/^game:/, "");
    for (const [gameType, runtime] of this.gameRuntimes.entries()) {
      if (gameType !== except && runtime.hasActive(sessionId)) return gameType;
    }
    return "";
  }

  hasActiveGame(sessionId, exceptGameType = "") {
    return Boolean(this.getActiveGameType(sessionId, exceptGameType));
  }

  closeActiveGames(context, exceptGameType = "") {
    const except = String(exceptGameType || "").replace(/^game:/, "");
    for (const [gameType, runtime] of this.gameRuntimes.entries()) {
      if (gameType === except || !runtime.hasActive(context?.sessionId)) continue;
      if (typeof runtime.close !== "function") return { ok: false, reason: "active_interaction_exists", gameType };
      const result = runtime.close(context);
      if (result?.ok === false) return { ...result, gameType };
    }
    return { ok: true };
  }

  async withSessionLock(sessionId, action) {
    const key = String(sessionId || "");
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);

    await previous;
    const wasActive = this.hasAnyActive(sessionId);
    try {
      const result = await action();
      if (wasActive !== this.hasAnyActive(sessionId)) this.notifyActivityChange(sessionId);
      return result;
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }

  subscribeActivity(listener) {
    if (typeof listener !== "function") throw new Error("activity listener must be a function");
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  notifyActivityChange(sessionId) {
    const snapshot = { sessionId: String(sessionId || ""), active: this.hasAnyActive(sessionId) };
    for (const listener of this.activityListeners) listener(snapshot);
    return snapshot;
  }

  hasActiveInteraction(sessionId) {
    return Boolean(this.interactionStore?.getSession(sessionId)?.active)
      || this.hasActiveGame(sessionId)
      || this.hasActiveActivity(sessionId);
  }

  hasActiveRaffle(sessionId) {
    return Boolean(this.raffleStore?.getActive(sessionId));
  }

  hasActiveBreakout(sessionId) {
    return Boolean(this.getGameRuntime("breakout")?.hasActive(sessionId));
  }

  hasAnyActive(sessionId, except = "") {
    return (
      (except !== "interaction" && Boolean(this.interactionStore?.getSession(sessionId)?.active)) ||
      (except !== "raffle" && this.hasActiveRaffle(sessionId)) ||
      this.hasActiveGame(sessionId, except) ||
      this.hasActiveActivity(sessionId, except)
    );
  }
}

module.exports = { ActiveInteractionCoordinator };
