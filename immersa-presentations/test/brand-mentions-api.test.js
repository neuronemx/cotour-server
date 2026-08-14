const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const {
  BrandMentionError,
  BrandMentionStore,
  createBrandMentionHandlers,
  defaultBrandMentionConfig,
  normalizeLogoFile,
  normalizeTargetUrl,
  constants
} = require("../brand-mentions-api");

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function pngWithDimensions(width, height) {
  const buffer = Buffer.from(PNG_1X1);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function logoFile(name = "marca.png", buffer = PNG_1X1, mimetype = "image/png") {
  return { originalname: name, mimetype, buffer };
}

async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-brand-mentions-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataDecksDir = path.join(root, "data-decks");
  const staticDecksDir = path.join(root, "static-decks");
  const deckDir = path.join(dataDecksDir, "deck-a");
  await Promise.all([
    fs.promises.mkdir(deckDir, { recursive: true }),
    fs.promises.mkdir(staticDecksDir, { recursive: true })
  ]);
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify({ deckId: "deck-a", slides: [] }));
  return {
    root,
    dataDecksDir,
    staticDecksDir,
    deckDir,
    store: new BrandMentionStore({ dataDecksDir, staticDecksDir })
  };
}

async function startApi(t, paths) {
  const handlers = createBrandMentionHandlers(paths);
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/decks/:deckId/brand-mentions", handlers.getConfig);
  app.post("/api/decks/:deckId/brand-mentions", handlers.createBrand);
  app.put("/api/decks/:deckId/brand-mentions/order", handlers.reorderBrands);
  app.put("/api/decks/:deckId/brand-mentions/:brandId", handlers.updateBrand);
  app.delete("/api/decks/:deckId/brand-mentions/:brandId", handlers.deleteBrand);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function brandForm({ name, pitch, url, active, logo } = {}) {
  const form = new FormData();
  if (name !== undefined) form.append("name", name);
  if (pitch !== undefined) form.append("pitch", pitch);
  if (url !== undefined) form.append("url", url);
  if (active !== undefined) form.append("active", String(active));
  if (logo) form.append("logo", new Blob([logo.buffer], { type: logo.mimetype }), logo.originalname);
  return form;
}

test("empty decks receive the frozen Público-only v1 configuration", async (t) => {
  const { store } = await fixture(t);
  assert.deepEqual(await store.read("deck-a"), defaultBrandMentionConfig("deck-a"));
  assert.equal(constants.BRAND_MENTION_INTERVAL_SECONDS, 120);
  assert.equal(constants.BRAND_MENTION_DISPLAY_SECONDS, 8);
  assert.equal(Object.hasOwn(defaultBrandMentionConfig("deck-a").settings, "screen_enabled"), false);
});

test("creating a brand persists normalized fields, order and a private asset filename", async (t) => {
  const { store, deckDir } = await fixture(t);
  const result = await store.create("deck-a", {
    name: "  NeurONE  ",
    pitch: "  Inteligencia comercial para cada recorrido.  ",
    url: "www.neurone.mx/demo",
    active: "true"
  }, logoFile());

  assert.match(result.brand.id, /^brand_[a-f0-9-]+$/);
  assert.equal(result.brand.name, "NeurONE");
  assert.equal(result.brand.pitch, "Inteligencia comercial para cada recorrido.");
  assert.equal(result.brand.target_url, "https://www.neurone.mx/demo");
  assert.equal(result.brand.display_domain, "neurone.mx");
  assert.equal(result.brand.active, true);
  assert.equal(result.brand.order, 1);
  assert.match(result.brand.logo.file_name, /^logo-[a-f0-9-]+\.png$/);
  assert.equal(result.brand.logo.src, `/decks/deck-a/brand-assets/${result.brand.logo.file_name}`);
  assert.equal(result.brand.logo.width, 1);
  assert.equal(result.brand.logo.height, 1);

  const stored = JSON.parse(await fs.promises.readFile(path.join(deckDir, "brand-mentions.json"), "utf8"));
  assert.equal(stored.settings.interval_seconds, 120);
  assert.equal(stored.settings.display_seconds, 8);
  assert.equal(stored.brands[0].id, result.brand.id);
  assert.equal((await fs.promises.stat(path.join(deckDir, "brand-assets", result.brand.logo.file_name))).size, PNG_1X1.length);
});

test("simultaneous creates are serialized without losing a brand or its order", async (t) => {
  const { store } = await fixture(t);
  await Promise.all([
    store.create("deck-a", { name: "A", pitch: "Pitch A", url: "a.example" }, logoFile("a.png")),
    store.create("deck-a", { name: "B", pitch: "Pitch B", url: "b.example" }, logoFile("b.png"))
  ]);
  const config = await store.read("deck-a");
  assert.equal(config.brands.length, 2);
  assert.deepEqual(config.brands.map((brand) => brand.order), [1, 2]);
  assert.deepEqual(new Set(config.brands.map((brand) => brand.name)), new Set(["A", "B"]));
});

test("logo replacement commits first and then removes the previous asset", async (t) => {
  const { store, deckDir } = await fixture(t);
  const created = await store.create("deck-a", { name: "A", pitch: "Primero", url: "a.example" }, logoFile("old.png"));
  const previousFile = created.brand.logo.file_name;
  const updated = await store.update("deck-a", created.brand.id, {
    name: "A nueva",
    pitch: "Nuevo pitch",
    url: "https://a.example/nueva",
    active: "false"
  }, logoFile("new.png"));

  assert.equal(updated.brand.name, "A nueva");
  assert.equal(updated.brand.active, false);
  assert.notEqual(updated.brand.logo.file_name, previousFile);
  await assert.rejects(fs.promises.access(path.join(deckDir, "brand-assets", previousFile)), { code: "ENOENT" });
  await fs.promises.access(path.join(deckDir, "brand-assets", updated.brand.logo.file_name));
});

test("reordering requires every brand exactly once and deletion cleans its logo", async (t) => {
  const { store, deckDir } = await fixture(t);
  const first = await store.create("deck-a", { name: "A", pitch: "Pitch A", url: "a.example" }, logoFile("a.png"));
  const second = await store.create("deck-a", { name: "B", pitch: "Pitch B", url: "b.example" }, logoFile("b.png"));

  await assert.rejects(
    store.reorder("deck-a", [first.brand.id, first.brand.id]),
    (error) => error instanceof BrandMentionError && error.code === "INVALID_BRAND_ORDER"
  );
  const reordered = await store.reorder("deck-a", [second.brand.id, first.brand.id]);
  assert.deepEqual(reordered.brands.map((brand) => [brand.name, brand.order]), [["B", 1], ["A", 2]]);

  const removedLogo = second.brand.logo.file_name;
  const removed = await store.remove("deck-a", second.brand.id);
  assert.deepEqual(removed.config.brands.map((brand) => [brand.name, brand.order]), [["A", 1]]);
  await assert.rejects(fs.promises.access(path.join(deckDir, "brand-assets", removedLogo)), { code: "ENOENT" });
});

test("only HTTPS destinations and genuine bounded PNG, JPG or WebP files are accepted", () => {
  assert.equal(normalizeTargetUrl("marca.mx/producto"), "https://marca.mx/producto");
  assert.throws(() => normalizeTargetUrl("http://marca.mx"), { code: "INVALID_TARGET_URL" });
  assert.throws(() => normalizeTargetUrl("javascript:alert(1)"), { code: "INVALID_TARGET_URL" });
  assert.throws(() => normalizeLogoFile(logoFile("marca.jpg")), { code: "LOGO_TYPE_MISMATCH" });
  assert.throws(() => normalizeLogoFile(logoFile("marca.svg", Buffer.from("<svg></svg>"), "image/svg+xml")), { code: "INVALID_LOGO" });
  assert.throws(() => normalizeLogoFile(logoFile("huge.png", pngWithDimensions(5000, 1))), { code: "INVALID_LOGO_DIMENSIONS" });
});

test("static decks can be read but not mutated", async (t) => {
  const paths = await fixture(t);
  const staticDeckDir = path.join(paths.staticDecksDir, "demo");
  await fs.promises.mkdir(staticDeckDir, { recursive: true });
  await fs.promises.writeFile(path.join(staticDeckDir, "manifest.json"), JSON.stringify({ deckId: "demo" }));
  assert.deepEqual(await paths.store.read("demo"), defaultBrandMentionConfig("demo"));
  await assert.rejects(
    paths.store.create("demo", { name: "A", pitch: "Pitch", url: "a.example" }, logoFile()),
    (error) => error instanceof BrandMentionError && error.code === "READ_ONLY_DECK" && error.statusCode === 403
  );
});

test("HTTP API creates, lists, updates, reorders and deletes deck brands", async (t) => {
  const paths = await fixture(t);
  const origin = await startApi(t, paths);
  const endpoint = `${origin}/api/decks/deck-a/brand-mentions`;

  const createdResponse = await fetch(endpoint, {
    method: "POST",
    body: brandForm({ name: "Marca", pitch: "Pitch corto", url: "marca.example", active: true, logo: logoFile() })
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(created.brand.name, "Marca");

  const listedResponse = await fetch(endpoint);
  const listed = await listedResponse.json();
  assert.equal(listedResponse.headers.get("cache-control"), "no-store");
  assert.equal(listed.brands.length, 1);

  const updatedResponse = await fetch(`${endpoint}/${created.brand.id}`, {
    method: "PUT",
    body: brandForm({ name: "Marca activa", active: false })
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.equal(updated.brand.name, "Marca activa");
  assert.equal(updated.brand.active, false);
  assert.equal(updated.brand.pitch, "Pitch corto");

  const reorderedResponse = await fetch(`${endpoint}/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brand_ids: [created.brand.id] })
  });
  assert.equal(reorderedResponse.status, 200);

  const deletedResponse = await fetch(`${endpoint}/${created.brand.id}`, { method: "DELETE" });
  const deleted = await deletedResponse.json();
  assert.equal(deletedResponse.status, 200);
  assert.equal(deleted.config.brands.length, 0);
});

test("HTTP API returns a controlled error for an unexpected upload field", async (t) => {
  const paths = await fixture(t);
  const origin = await startApi(t, paths);
  const form = new FormData();
  form.append("name", "Marca");
  form.append("pitch", "Pitch corto");
  form.append("url", "marca.example");
  form.append("image", new Blob([PNG_1X1], { type: "image/png" }), "marca.png");
  const response = await fetch(`${origin}/api/decks/deck-a/brand-mentions`, { method: "POST", body: form });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_LOGO_UPLOAD");
});

test("server exposes only deck administration routes and does not add Screen or QR runtime", async () => {
  const server = await fs.promises.readFile(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(server, /app\.get\("\/api\/decks\/:deckId\/brand-mentions", \.\.\.requireDeckAccount, brandMentionHandlers\.getConfig\)/);
  assert.match(server, /app\.post\("\/api\/decks\/:deckId\/brand-mentions", \.\.\.requireDeckAccount, requireAccountAdjustmentCleared, brandMentionHandlers\.createBrand\)/);
  assert.match(server, /app\.put\("\/api\/decks\/:deckId\/brand-mentions\/order", \.\.\.requireDeckAccount, requireAccountAdjustmentCleared, brandMentionHandlers\.reorderBrands\)/);
  assert.doesNotMatch(server, /brand_mention:state/);
  assert.doesNotMatch(server, /brand.*(?:screen|qr)|(?:screen|qr).*brand/i);
});
