const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Time Sync runtime retries until role globals are available", () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../public/shared/presentation-runtime.js"), "utf8");
  assert.match(runtime, /setInterval/);
  assert.match(runtime, /attempts>=50/);
  assert.match(runtime, /if\(instance\)return instance/);
  assert.match(runtime, /if\(!bootstrap\(\)\)scheduleBootstrap\(\)/);
});
