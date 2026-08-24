const { constants } = require("./brand-mentions-api");

class BrandMentionRuntime {
  constructor({
    io,
    store,
    coordinator,
    getRoleRoomKey,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    intervalMs = constants.BRAND_MENTION_INTERVAL_SECONDS * 1000,
    displayMs = constants.BRAND_MENTION_DISPLAY_SECONDS * 1000
  }) {
    this.io = io;
    this.store = store;
    this.coordinator = coordinator;
    this.getRoleRoomKey = getRoleRoomKey;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.intervalMs = intervalMs;
    this.displayMs = displayMs;
    this.sessions = new Map();
    this.unsubscribeActivity = coordinator?.subscribeActivity?.((snapshot) => this.handleActivityChange(snapshot)) || null;
  }

  audienceRoom(roomKey) {
    return this.getRoleRoomKey(roomKey, "audience");
  }

  activeBrands(config) {
    return (Array.isArray(config?.brands) ? config.brands : [])
      .filter((brand) => brand?.active)
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  }

  publicMention(brand, shownAt) {
    return {
      id: brand.id,
      name: brand.name,
      pitch: brand.pitch,
      target_url: brand.target_url,
      display_domain: brand.display_domain,
      logo_src: brand.logo?.src || "",
      shown_at: shownAt,
      visible_until: shownAt + this.displayMs
    };
  }

  stateFor(context) {
    const roomKey = String(context?.roomKey || "");
    if (!roomKey) return null;
    let state = this.sessions.get(roomKey);
    if (!state) {
      state = {
        roomKey,
        sessionId: String(context.sessionId || ""),
        deckId: String(context.deckId || ""),
        brandSourceId: String(context.brandSourceId || context.deckId || ""),
        running: false,
        blocked: false,
        lastBrandId: "",
        mention: null,
        nextTimer: null,
        hideTimer: null,
        generation: 0
      };
      this.sessions.set(roomKey, state);
    }
    return state;
  }

  clearTimer(state, key) {
    if (state?.[key]) this.clearTimeoutFn(state[key]);
    if (state) state[key] = null;
  }

  hide(state, { emit = true } = {}) {
    if (!state) return;
    this.clearTimer(state, "hideTimer");
    const mentionId = state.mention?.id || "";
    state.mention = null;
    if (emit && mentionId) this.io.to(this.audienceRoom(state.roomKey)).emit("brand_mention:hide", { id: mentionId });
  }

  schedule(state) {
    if (!state?.running || state.blocked || state.nextTimer) return false;
    state.nextTimer = this.setTimeoutFn(() => this.showNext(state), this.intervalMs);
    state.nextTimer?.unref?.();
    return true;
  }

  async hasActiveBrands(deckId) {
    try {
      return this.activeBrands(await this.store.read(deckId)).length > 0;
    } catch (error) {
      console.warn("Unable to load brand mentions", error.message);
      return false;
    }
  }

  async start(context) {
    const state = this.stateFor(context);
    if (!state) return false;
    state.sessionId = String(context.sessionId || state.sessionId);
    state.deckId = String(context.deckId || state.deckId);
    state.brandSourceId = String(context.brandSourceId || state.brandSourceId || state.deckId);
    if (state.running) {
      if (!state.blocked && !state.nextTimer && !state.mention && await this.hasActiveBrands(state.brandSourceId)) this.schedule(state);
      return true;
    }
    state.running = true;
    state.generation += 1;
    const generation = state.generation;
    state.blocked = Boolean(this.coordinator?.hasAnyActive?.(state.sessionId));
    if (state.blocked) return true;
    await this.hasActiveBrands(state.brandSourceId);
    if (!state.running || state.generation !== generation) return false;
    return this.schedule(state);
  }

  stop(roomKey) {
    const state = this.sessions.get(String(roomKey || ""));
    if (!state) return false;
    state.running = false;
    state.generation += 1;
    this.clearTimer(state, "nextTimer");
    this.hide(state);
    this.sessions.delete(state.roomKey);
    return true;
  }

  nextBrand(brands, lastBrandId) {
    if (!brands.length) return null;
    const previousIndex = brands.findIndex((brand) => brand.id === lastBrandId);
    return brands[(previousIndex + 1) % brands.length];
  }

  async showNext(state) {
    this.clearTimer(state, "nextTimer");
    if (!state.running) return false;
    if (this.coordinator?.hasAnyActive?.(state.sessionId)) {
      state.blocked = true;
      this.hide(state);
      return false;
    }
    let brands;
    try {
      brands = this.activeBrands(await this.store.read(state.brandSourceId));
    } catch (error) {
      console.warn("Unable to load brand mentions", error.message);
      this.schedule(state);
      return false;
    }
    if (!state.running || state.blocked) return false;
    if (!brands.length) {
      this.schedule(state);
      return false;
    }
    const brand = this.nextBrand(brands, state.lastBrandId);
    const shownAt = this.now();
    state.lastBrandId = brand.id;
    state.mention = this.publicMention(brand, shownAt);
    this.io.to(this.audienceRoom(state.roomKey)).emit("brand_mention:show", state.mention);
    state.hideTimer = this.setTimeoutFn(() => this.hide(state), this.displayMs);
    state.hideTimer?.unref?.();
    this.schedule(state);
    return true;
  }

  async handleActivityChange({ sessionId, active }) {
    const matches = Array.from(this.sessions.values()).filter((state) => state.sessionId === String(sessionId || "") && state.running);
    for (const state of matches) {
      this.clearTimer(state, "nextTimer");
      if (active) {
        state.blocked = true;
        this.hide(state);
        continue;
      }
      state.blocked = false;
      if (await this.hasActiveBrands(state.brandSourceId)) this.schedule(state);
    }
  }

  sendCurrentState(socket, context) {
    if (context?.role !== "audience") return false;
    const state = this.sessions.get(String(context.roomKey || ""));
    if (!state?.mention || state.mention.visible_until <= this.now() || state.blocked) return false;
    socket.emit("brand_mention:show", state.mention);
    return true;
  }

  close() {
    for (const roomKey of Array.from(this.sessions.keys())) this.stop(roomKey);
    this.unsubscribeActivity?.();
  }
}

module.exports = { BrandMentionRuntime };
