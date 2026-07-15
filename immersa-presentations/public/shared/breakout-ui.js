(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ImmersaBreakoutUi = api;
    api.autoMount();
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const VISIBLE_STATES = new Set(["running", "paused", "finished"]);
  const LOCKED_STATES = new