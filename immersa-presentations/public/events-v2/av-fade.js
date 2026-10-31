(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaEventFade = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function create({ getState, getMedia, video = false, now = () => performance.now(), requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame }) {
    let id = null, frame = null, started = 0;
    function cancel() {
      if (frame !== null) cancelFrame(frame);
      frame = null; id = null;
      if (video) getMedia().forEach((media) => media.style.removeProperty("opacity"));
    }
    function tick() {
      frame = null;
      const state = getState();
      if (state.status !== "fading" || state.fadeOut?.id !== id) { cancel(); return; }
      const ratio = Math.max(0, 1 - (now() - started) / Math.max(1, state.fadeOut.durationMs));
      const volume = Math.max(0, Math.min(1, Number(state.volume ?? 1)));
      getMedia().forEach((media) => {
        media.volume = volume * ratio;
        if (video && media.classList.contains("is-visible")) media.style.opacity = String(ratio);
      });
      if (ratio > 0) frame = requestFrame(tick);
    }
    function apply() {
      const state = getState();
      if (!state.fadeOut?.id || state.status !== "fading") { cancel(); return; }
      if (id === state.fadeOut.id) return;
      cancel(); id = state.fadeOut.id; started = now(); tick();
    }
    return { apply, cancel };
  }
  return { create };
});

