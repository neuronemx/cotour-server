const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const storage = require("../local-event-package-storage");
const archive = require("../local-event-package-archive");

test("Local package survives a zip round trip", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-local-archive-"));
  const source = path.join(root, "source");
  await fs.promises.mkdir(path.join(source, "decks", "deck-1"), { recursive: true });
  await fs.promises.writeFile(path.join(source, "decks", "deck-1", "manifest.json"), "{}");
  const packageRoot = path.join(root, "package");
  await storage.exportPackage({ destination: packageRoot, sourceRoot: source, eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" }, stages: [], activities: [], brands: [], decks: [{ id: "deck-1", manifest: "decks/deck-1/manifest.json", assets: ["decks/deck-1/manifest.json"] }] });
  const zip = await archive.createArchive({ packageRoot, destination: path.join(root, "semana-amc.immersa-local.zip") });
  const restored = await archive.extractArchive({ archive: zip, destination: path.join(root, "restored") });
  assert.equal(restored.eventHub.slug, "semana-amc");
});
