(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ImmersaBreakoutUi = api;
    api.autoMount();
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const ACTIVE = new Set(["running", "paused", "finished"]);
  const HOLD_INTERVAL_MS = 75;

  function roleFromPath(path) {
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(path)) return "presenter";
    if (/^\/stage(?:\/|$)/.test(path)) return "stage";
    if (/^\/(?:screen