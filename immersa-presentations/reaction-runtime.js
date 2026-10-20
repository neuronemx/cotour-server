const { randomUUID } = require("node:crypto");

const ALLOWED_REACTIONS = new Set(["❤️", "👏", "🔥"]);
const SCREEN_LIMIT = 50;
const SCREEN_LIFETIME_MS = 3100;

class ReactionRuntime {
  constructor({ emitScreen, now = Date.now }) {
    this.emitScreen = emitScreen;
    this.now = now;
    this.limiters = new Map();
    this.visibleUntil = [];
    this.nextPruneAt = 0;
    this.pending = Promise.resolve();
    this.inFlight = 0;
    this.accepting = true;
    this.resetCounts(null);
  }

  resetCounts(presentationSessionId) {
    if (this.bucket) this.bucket.retired = true;
    this.bucket = { collectorId: randomUUID(), presentationSessionId, counts: { "❤️": 0, "👏": 0, "🔥": 0 }, version: 0, saved: 0 };
  }

  setRecording(presentationSessionId) {
    if (this.bucket.presentationSessionId !== presentationSessionId) this.resetCounts(presentationSessionId);
    if (presentationSessionId) this.accepting = true;
  }

  react({ socket, audienceId, emoji, showOnScreen }) {
    if (!this.accepting || !audienceId || !ALLOWED_REACTIONS.has(emoji)) return false;
    const now = this.now();
    if (now >= this.nextPruneAt) {
      for (const [id, state] of this.limiters) if (now - state.at >= 60_000) this.limiters.delete(id);
      this.nextPruneAt = now + 10_000;
    }
    // Four immediate reactions, then two per second. Identity survives reconnects.
    const previous = this.limiters.get(audienceId) || { tokens: 4, at: now };
    const tokens = Math.min(4, previous.tokens + Math.max(0, now - previous.at) / 500);
    if (tokens < 1) return false;
    this.limiters.set(audienceId, { tokens: tokens - 1, at: now });
    this.bucket.counts[emoji] += 1;
    this.bucket.version += 1;
    socket.emit("reaction", { emoji, target: "audience", at: now });
    this.visibleUntil = this.visibleUntil.filter((until) => until > now);
    if (showOnScreen && this.visibleUntil.length < SCREEN_LIMIT) {
      this.visibleUntil.push(now + SCREEN_LIFETIME_MS);
      this.emitScreen({ emoji, target: "screen", at: now });
    }
    return true;
  }

  flush(repository, context, presentationSessionId = null) {
    if (!repository) return Promise.resolve();
    if (this.inFlight && !presentationSessionId) return this.pending;
    const bucket = this.bucket;
    this.inFlight += 1;
    const operation = this.pending.catch(() => {}).then(async () => {
      if (bucket.saved === bucket.version) return;
      const id = presentationSessionId || bucket.presentationSessionId || await repository.activeLiveSession(context);
      if (!presentationSessionId && !bucket.presentationSessionId && bucket.retired) return;
      const version = bucket.version;
      const counts = { ...bucket.counts };
      if (id) await repository.recordReactionSnapshot({ presentationSessionId: id, collectorId: bucket.collectorId, counts });
      bucket.saved = version;
    });
    this.pending = operation.finally(() => { this.inFlight -= 1; });
    return this.pending;
  }
}

module.exports = { ReactionRuntime, ALLOWED_REACTIONS, SCREEN_LIMIT, SCREEN_LIFETIME_MS };
