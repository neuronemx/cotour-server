// Shared slide semantics. Authorization and publication belong to the caller.
function clampSlide(state, index) {
  return Math.max(0, Math.min(Number.isFinite(index) ? index : 0, Math.max(0, (state.slideCount || 1) - 1)));
}
function applyPresenterSlide(state, index) {
  state.presenterSlideIndex = clampSlide(state, index);
  state.slideIndex = state.presenterSlideIndex;
  if (!state.transmissionPaused) state.liveSlideIndex = state.presenterSlideIndex;
  return state;
}
module.exports = { clampSlide, applyPresenterSlide };
