const SCHEMA_VERSION = 1;
const DEFAULT_DURATION_MS = 60000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 86400000;
const CONTROL_ROLES = new Set(["presenter", "stage"]);

function timerId() {
  return "timer_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function visibility(value = {}) {
  return { screen: Boolean(value.screen), audience: Boolean(value.audience)