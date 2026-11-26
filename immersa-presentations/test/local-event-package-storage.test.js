const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const storage = require("../local-event-package-storage");

test("exports and verifies the exact Local package assets", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-local-package-"));
  const source = path.join(root, "source");
  await fs.promises.mkdir(path.join(source, "decks", "deck-1", "slides"), { recursive: true });
  await fs.promises.mkdir(path.join(source, "event-hubs", "hub-1", "brand-assets"), { recursive: true });
  await fs.promises.writeFile(path.join(source, "decks", "deck-1", "slides", "slide-001.jpg"), "slide");
  await fs.promises.writeFile(path.join(source, "event-hubs", "hub-1", "brand-assets", "logo-a.png"), "logo");
  const manifest = await storage.exportPackage({
    destination: path.join(root, "package"), sourceRoot: source,
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" },
    stages: [{ id: "stage-1", name: "CCC Sala THX", capacity: 300 }],
    activities: [{ id: "activity-1", stageId: "stage-1", title: "Apertura", deckId: "deck-1" }],
    publicQrs: [{ publicId: "p_evt_free", audienceLevel: "FREE" }],
    brands: [{ id: "brand-1", name: "Immersa", pitch: "Presentaciones", targetUrl: "https://immersa.mx", logo: { file_name: "logo-a.png" } }],
    decks: [{ id: "deck-1", manifest: "decks/deck-1/manifest.json", assets: ["decks/deck-1/slides/slide-001.jpg"] }],
    assets: ["event-hubs/hub-1/brand-assets/logo-a.png"]
  });
  assert.equal(manifest.assets.length, 2);
  const verified = await storage.verifyPackage(path.join(root, "package"));
  assert.equal(verified.decks[0].id, "deck-1");
  assert.equal(verified.snapshot.activities[0].deckId, "deck-1");
  assert.equal(verified.snapshot.publicQrs[0].publicId, "p_evt_free");
});

test("imports verified assets and the Event Hub snapshot together", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-local-import-"));
  const source = path.join(root, "source");
  await fs.promises.mkdir(path.join(source, "decks", "deck-1"), { recursive: true });
  await fs.promises.writeFile(path.join(source, "decks", "deck-1", "manifest.json"), "{}");
  await storage.exportPackage({ destination: path.join(root, "package"), sourceRoot: source,
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" },
    stages: [{ id: "stage-1", name: "CCC Sala THX" }], activities: [], brands: [],
    decks: [{ id: "deck-1", manifest: "decks/deck-1/manifest.json", assets: ["decks/deck-1/manifest.json"] }] });
  let imported;
  await storage.importPackage({ packageRoot: path.join(root, "package"), destinationRoot: path.join(root, "local-data"), importEventHub: async (snapshot) => { imported = snapshot; } });
  assert.equal(imported.eventHub.workspaceId, "hub-1");
  assert.equal(await fs.promises.readFile(path.join(root, "local-data", "decks", "deck-1", "manifest.json"), "utf8"), "{}");
});

test("exports an assigned system Deck from its own source directory", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-local-static-deck-"));
  const systemDeck = path.join(root, "system-deck");
  await fs.promises.mkdir(systemDeck, { recursive: true });
  await fs.promises.writeFile(path.join(systemDeck, "manifest.json"), "{\"id\":\"demo\"}");
  await storage.exportPackage({
    destination: path.join(root, "package"), sourceRoot: path.join(root, "empty"),
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" }, stages: [], activities: [], brands: [],
    decks: [{ id: "demo", manifest: "decks/demo/manifest.json", assets: [{ path: "decks/demo/manifest.json", source: path.join(systemDeck, "manifest.json") }] }]
  });
  assert.equal(await fs.promises.readFile(path.join(root, "package", "assets", "decks", "demo", "manifest.json"), "utf8"), "{\"id\":\"demo\"}");
});

test("rejects a package whose Event Hub Program changed after export", async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-local-snapshot-checksum-"));
  const source = path.join(root, "source");
  await fs.promises.mkdir(source, { recursive: true });
  await storage.exportPackage({ destination: path.join(root, "package"), sourceRoot: source,
    eventHub: { workspaceId: "hub-1", slug: "semana-amc", title: "Semana AMC" }, stages: [], activities: [], brands: [], decks: [] });
  const file = path.join(root, "package", "data", "event-hub.json");
  const snapshot = JSON.parse(await fs.promises.readFile(file, "utf8"));
  snapshot.eventHub.title = "Alterado";
  await fs.promises.writeFile(file, JSON.stringify(snapshot));
  await assert.rejects(() => storage.verifyPackage(path.join(root, "package")), /Event Hub checksum mismatch/);
});
