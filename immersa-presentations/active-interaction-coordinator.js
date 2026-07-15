class ActiveInteractionCoordinator {
  constructor({ interactionStore, raffleStore, breakoutStore = null }) {
    this.interactionStore = interactionStore;
    this.raffleStore = raffleStore;
    this.breakoutStore = breakoutStore;
    this.locks = new Map();
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
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }

  hasActiveInteraction(sessionId) {
    return Boolean(this.interactionStore?.getSession(sessionId)?.active);
  }

  hasActiveRaffle(sessionId) {
    return Boolean(this.raffleStore?.getActive(sessionId));
  }

  hasActiveBreakout(sessionId) {
    return Boolean(this.breakoutStore?.hasActive(sessionId));
  }

  hasAnyActive(sessionId, except = "") {
    return (
      (except !== "interaction" && this.hasActiveInteraction(sessionId)) ||
      (except !== "raffle" && this.hasActiveRaffle(sessionId)) ||
      (except !== "breakout" && this.hasActiveBreakout(sessionId))
    );
  }
}

module.exports = { ActiveInteractionCoordinator };
