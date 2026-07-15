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
      release =