const SCHEMA_VERSION = 1;
const DEFAULT_DURATION_MS = 60000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_PROCESSED_COMMANDS = 256;
const CONTROL_ROLES = new Set(["presenter", "stage"]);
const DISPLAY_ROLES = new Set(["screen", "viewer", "audience"]);
const TIMER_STATUSES = new Set(["idle", "running", "paused", "finished"]);

function defaultTimerId() {
  return "timer_" +