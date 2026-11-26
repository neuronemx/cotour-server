const test = require("node:test");
const assert = require("node:assert/strict");
const { createSnapshot } = require("../local-event-hub-snapshot");
const { mysqlDateTime } = require("../event-hub/repository");

test("Event Hub snapshot keeps Program, Stages, activities and brands together", () => {
  const snapshot = createSnapshot({
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" },
    stages: [{ id: "stage-1", name: "CCC Sala THX", audience_capacity: 300 }],
    activities: [{ id: "activity-1", event_stage_id: "stage-1", title: "Apertura", deck_id: "deck-1", access_level: "PAID" }],
    publicQrs: [{ public_id: "p_evt_free", audience_level: "FREE", active: true }],
    brands: [{ id: "brand-1", name: "Immersa", pitch: "Presentaciones interactivas", target_url: "https://immersa.mx", logo: { file_name: "logo-a.png", mime_type: "image/png" }, active: true }]
  });
  assert.equal(snapshot.activities[0].deckId, "deck-1");
  assert.equal(snapshot.brands[0].name, "Immersa");
  assert.equal(snapshot.brands[0].logo.file_name, "logo-a.png");
  assert.equal(snapshot.publicQrs[0].publicId, "p_evt_free");
});

test("Local import turns JavaScript dates into MariaDB datetime values", () => {
  assert.equal(mysqlDateTime("Tue Sep 01 2026 10:00:00 GMT+0000 (Coordinated Universal Time)"), "2026-09-01 10:00:00");
});

test("Event Hub snapshot rejects activities without a known Stage", () => {
  assert.throws(() => createSnapshot({
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" },
    activities: [{ id: "activity-1", stageId: "missing", title: "Apertura" }]
  }), /Unknown Event Stage/);
});

test("Event Hub repository exposes a transactional Local snapshot import", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require("node:path").join(__dirname, "..", "event-hub", "repository.js"), "utf8");
  assert.match(source, /async importLocalSnapshot\(snapshot\)/);
  assert.match(source, /transaction\(this\.pool/);
  assert.match(source, /event_activities/);
});
