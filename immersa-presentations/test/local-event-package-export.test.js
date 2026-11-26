const test = require("node:test");
const assert = require("node:assert/strict");
const { readEventHubForLocalExport } = require("../local-event-package-export");

test("reads the configured Event Hub instead of recreating its Program", async () => {
  const repository = {
    async getHub() { return { workspace_id: "hub-1", slug: "semana-amc", title: "Semana AMC", stages: [{ id: "stage-1", name: "CCC Sala THX" }] }; },
    async listActivities() { return [{ id: "activity-1", event_stage_id: "stage-1", title: "Apertura", deck_id: "deck-1" }]; }
  };
  const snapshot = await readEventHubForLocalExport({ repository, eventWorkspaceId: "hub-1", listBrands: async () => [{ id: "brand-1", name: "Immersa" }] });
  assert.equal(snapshot.eventHub.title, "Semana AMC");
  assert.equal(snapshot.activities[0].deckId, "deck-1");
});

test("Local package export allows Event Hubs without brand assets yet", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /if \(error\.code === "ENOENT"\) return \[\];/);
});

test("Local package export identifies the Program activity when an assigned Deck is missing", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /LOCAL_PACKAGE_DECK_MISSING/);
  assert.match(source, /activity\?\.title/);
});

test("Event brand assets preserve one Event Hub workspace directory in the package", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /files\.map\(\(file\) => `event-hubs\/\$\{file\}`\)/);
});
