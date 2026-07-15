const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Time Sync UI uses a dedicated mount marker", () => {
  const ui = fs.readFileSync(path.join(__dirname, "../public/shared/time-sync-ui.js"), "utf8");
  assert.match(ui, /data-immersa-time-ui-root/);
  assert.doesNotMatch(ui, /querySelector\('\[data-immersa-time-ui\]'\)/);
});
