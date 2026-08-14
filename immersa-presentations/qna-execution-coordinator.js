class QnaExecutionCoordinator {
  constructor(repository) {
    if (!repository?.getActivePresentationSession || !repository?.startPresentationSession) {
      throw new Error("A Q&A repository is required");
    }
    this.repository = repository;
    this.screenBindings = new Map();
    this.locks = new Map();
  }

  executionKey(deckId, sourceSessionId) {
    return `${String(sourceSessionId || "")}::${String(deckId || "")}`;
  }

  async withLock(key, operation) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    this.locks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }

  async openScreen({ deckId, sourceSessionId, screenLinkId, presentationSessionId = null }) {
    const normalizedDeckId = String(deckId || "").trim();
    const normalizedSourceSessionId = String(sourceSessionId || "").trim();
    const normalizedScreenLinkId = String(screenLinkId || "").trim();
    if (!normalizedDeckId || !normalizedSourceSessionId || !normalizedScreenLinkId) {
      throw new Error("deckId, sourceSessionId and screenLinkId are required");
    }
    const key = this.executionKey(normalizedDeckId, normalizedSourceSessionId);

    return this.withLock(key, async () => {
      const rememberedId = this.screenBindings.get(normalizedScreenLinkId) || presentationSessionId || null;
      const active = await this.repository.getActivePresentationSession({
        deckId: normalizedDeckId,
        sourceSessionId: normalizedSourceSessionId
      });

      if (rememberedId && active) {
        this.screenBindings.set(normalizedScreenLinkId, active.presentationSessionId);
        return { ...active, created: false };
      }

      const started = await this.repository.startPresentationSession({
        deckId: normalizedDeckId,
        sourceSessionId: normalizedSourceSessionId,
        replaceActive: true
      });
      this.screenBindings.set(normalizedScreenLinkId, started.presentationSessionId);
      return {
        presentationSessionId: started.presentationSessionId,
        deckId: normalizedDeckId,
        sourceSessionId: normalizedSourceSessionId,
        startedAt: null,
        created: true
      };
    });
  }

  async ensureExecution({ deckId, sourceSessionId }) {
    const normalizedDeckId = String(deckId || "").trim();
    const normalizedSourceSessionId = String(sourceSessionId || "").trim();
    if (!normalizedDeckId || !normalizedSourceSessionId) {
      throw new Error("deckId and sourceSessionId are required");
    }
    const key = this.executionKey(normalizedDeckId, normalizedSourceSessionId);
    return this.withLock(key, async () => {
      const active = await this.repository.getActivePresentationSession({
        deckId: normalizedDeckId,
        sourceSessionId: normalizedSourceSessionId
      });
      if (active) return { ...active, created: false };
      const started = await this.repository.startPresentationSession({
        deckId: normalizedDeckId,
        sourceSessionId: normalizedSourceSessionId,
        replaceActive: false
      });
      return { ...started, created: true };
    });
  }
}

module.exports = { QnaExecutionCoordinator };
