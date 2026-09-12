const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Local package import command uses the Local storage and Event Hub transaction", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "import-local-event-package.js"), "utf8");
  assert.match(source, /extractArchive/);
  assert.match(source, /importPackage/);
  assert.match(source, /repository\.importLocalSnapshot/);
});
