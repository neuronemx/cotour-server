const test = require("node:test");
const assert = require("node:assert/strict");
const pkg = require("../local-event-package");

test("Local Event package manifest binds Event Hub, Decks and assets", () => {
  const manifest = pkg.createManifest({
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" },
    snapshotChecksum: "snapshot-sha",
    decks: [{ id: "deck-1", manifest: "decks/deck-1/manifest.json" }],
    assets: [{ path: "decks/deck-1/slides/slide-001.jpg", sha256: "abc", bytes: 42 }],
    exportedAt: "2026-09-03T00:00:00.000Z"
  });
  assert.equal(manifest.format, "immersa-local-event-package");
  assert.equal(manifest.version, 1);
  assert.equal(pkg.verifyManifest(manifest).eventHub.slug, "semana-amc");
});

test("Local Event package rejects a changed manifest", () => {
  const manifest = pkg.createManifest({ eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" }, snapshotChecksum: "snapshot-sha" });
  manifest.eventHub.title = "Otro evento";
  assert.throws(() => pkg.verifyManifest(manifest), /checksum mismatch/);
});
