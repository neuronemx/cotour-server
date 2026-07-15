const DEFAULT_DURATION_MS = 60000;
const INPUT_WINDOW_MS = 100;
const CONTROL_ROLES = new Set(["presenter", "stage"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createGameId(nowMs = Date.now()) {
  return "breakout_" + nowMs.toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function createBlocks(columns = 7, rows = 4