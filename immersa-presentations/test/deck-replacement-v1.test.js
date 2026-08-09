const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { BYTES_PER_MEGABYTE, PlanLimitError } = require("../auth/plan-limits");
const { WorkspaceRepository } = require("../auth/workspace-repository");

const appDir = path.join(__dirname, "..");

async function withServer(app, operation) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function replacementPool({ currentBytes = 12, totalBytes = 20, nextBytes = 15 } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ kind: "begin" }); },
    async commit() { calls.push({ kind: "commit" }); },
    async rollback() { calls.push({ kind: "rollback" }); },
    release() { calls.push({ kind: "release" }); },
    async execute(sql, params) {
      calls.push({ kind: "execute", sql: String(sql), params });
      if (/SELECT w\.id, w\.plan/.test(sql)) return [[{ id: "workspace-a", plan: "FREE" }]];
      if (/SELECT d\.source_size_bytes/.test(sql)) return [[{ source_size_bytes: currentBytes }]];
      if (/SELECT COUNT\(\*\) AS deck_count/.test(sql)) return [[{ deck_count: 2, storage_bytes: totalBytes }]];
      if (/UPDATE decks/.test(sql)) return [{ affectedRows: 1 }];
      return [[], []];
    }
  };
  return { calls, nextBytes, pool: { async getConnection() { return connection; } } };
}

test("Replacing a Deck keeps its slot and atomically exchanges only original bytes", async () => {
  const { pool, calls, nextBytes } = replacementPool();
  const repository = new WorkspaceRepository(pool);
  const result = await repository.replaceDeckSource({
    userId: "user-a",
    workspaceId: "workspace-a",
    deckId: "deck-a",
    sourceSizeBytes: nextBytes
  });
  assert.equal(result.previousSourceSizeBytes, 12);
  assert.equal(result.plan.usage.decks, 2);
  assert.equal(result.plan.usage.storageBytes, 23);
  assert.deepEqual(calls.find((call) => /UPDATE decks/.test(call.sql || "")).params, [15, "workspace-a", "deck-a"]);
  assert.equal(calls.some((call) => call.kind === "commit"), true);
});

test("Replacement can reuse the current file bytes but cannot exceed FREE storage", async () => {
  const repository = new WorkspaceRepository(replacementPool({
    currentBytes: 10 * BYTES_PER_MEGABYTE,
    totalBytes: 48 * BYTES_PER_MEGABYTE
  }).pool);
  await assert.rejects(
    repository.replaceDeckSource({
      userId: "user-a",
      workspaceId: "workspace-a",
      deckId: "deck-a",
      sourceSizeBytes: 13 * BYTES_PER_MEGABYTE
    }),
    (error) => error instanceof PlanLimitError && error.code === "STORAGE_LIMIT_REACHED"
  );
});

test("Successful replacement preserves Deck configuration and flags structural changes", async (t) => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-replace-"));
  t.after(() => fs.promises.rm(dataDir, { recursive: true, force: true }));
  const deckDir = path.join(dataDir, "decks", "deck-a");
  await fs.promises.mkdir(path.join(deckDir, "slides"), { recursive: true });
  await fs.promises.mkdir(path.join(deckDir, "thumbs"), { recursive: true });
  await fs.promises.writeFile(path.join(deckDir, "slides", "slide-1.jpg"), "old-slide");
  await fs.promises.writeFile(path.join(deckDir, "thumbs", "slide-1.jpg"), "old-thumb");
  await fs.promises.writeFile(path.join(deckDir, "original.pdf"), "old-source");
  await fs.promises.writeFile(path.join(deckDir, "interactions.json"), JSON.stringify({ videos: [{ slide_id: "slide-1" }], interactions: [{ id: "poll-a" }] }));
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify({
    deckId: "deck-a", title: "Deck A", session_id: "s_abcdefghij", source: { type: "pdf", filename: "original.pdf", sizeBytes: 10 },
    slides: [{ id: "slide-1", src: "slides/slide-1.jpg" }], conversion: { status: "completed" }
  }));

  const previousDataDir = process.env.IMMERSA_DATA_DIR;
  process.env.IMMERSA_DATA_DIR = dataDir;
  const modulePath = require.resolve("../pdf-upload-support");
  delete require.cache[modulePath];
  const { createDeckReplacementHandler } = require("../pdf-upload-support");
  if (previousDataDir === undefined) delete process.env.IMMERSA_DATA_DIR;
  else process.env.IMMERSA_DATA_DIR = previousDataDir;

  const app = express();
  app.post("/decks/:deckId/replace", createDeckReplacementHandler({
    async convertDeckPdf({ deckDir: stagedDir, manifest }) {
      await fs.promises.mkdir(path.join(stagedDir, "thumbs"), { recursive: true });
      await fs.promises.writeFile(path.join(stagedDir, "slides", "slide-1.jpg"), "new-slide-1");
      await fs.promises.writeFile(path.join(stagedDir, "slides", "slide-2.jpg"), "new-slide-2");
      await fs.promises.writeFile(path.join(stagedDir, "thumbs", "slide-1.jpg"), "new-thumb-1");
      await fs.promises.writeFile(path.join(stagedDir, "thumbs", "slide-2.jpg"), "new-thumb-2");
      return { ...manifest, status: "converted", slides: [
        { id: "slide-1", src: "slides/slide-1.jpg", thumb: "thumbs/slide-1.jpg" },
        { id: "slide-2", src: "slides/slide-2.jpg", thumb: "thumbs/slide-2.jpg" }
      ], conversion: { status: "completed" } };
    },
    async onDeckReplaced() { return { plan: { plan: "FREE" } }; }
  }));

  await withServer(app, async (origin) => {
    const form = new FormData();
    form.append("pptx", new Blob(["%PDF-1.4 new"], { type: "application/pdf" }), "new.pdf");
    const response = await fetch(origin + "/decks/deck-a/replace", { method: "POST", body: form });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.deckId, "deck-a");
    assert.equal(payload.associationsReviewRequired, true);
    assert.equal(payload.previousSlideCount, 1);
    assert.equal(payload.nextSlideCount, 2);
  });

  assert.equal(await fs.promises.readFile(path.join(deckDir, "slides", "slide-1.jpg"), "utf8"), "new-slide-1");
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(deckDir, "interactions.json"), "utf8")), {
    videos: [{ slide_id: "slide-1" }], interactions: [{ id: "poll-a" }]
  });
  const manifest = JSON.parse(await fs.promises.readFile(path.join(deckDir, "manifest.json"), "utf8"));
  assert.equal(manifest.session_id, "s_abcdefghij");
  assert.equal(manifest.source.sizeBytes, 12);
  assert.match(manifest.slides[0].src, /^slides\/slide-1\.jpg\?v=[0-9a-f-]+$/);
  assert.match(manifest.slides[0].thumb, /^thumbs\/slide-1\.jpg\?v=[0-9a-f-]+$/);
});

test("Failed conversion leaves the previous Deck and configuration untouched", async (t) => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-replace-fail-"));
  t.after(() => fs.promises.rm(dataDir, { recursive: true, force: true }));
  const deckDir = path.join(dataDir, "decks", "deck-a");
  await fs.promises.mkdir(path.join(deckDir, "slides"), { recursive: true });
  await fs.promises.writeFile(path.join(deckDir, "slides", "slide-1.jpg"), "old-slide");
  await fs.promises.writeFile(path.join(deckDir, "interactions.json"), "preserve-me");
  await fs.promises.writeFile(path.join(deckDir, "manifest.json"), JSON.stringify({ deckId: "deck-a", session_id: "s_abcdefghij", slides: [{ id: "slide-1" }] }));

  const previousDataDir = process.env.IMMERSA_DATA_DIR;
  process.env.IMMERSA_DATA_DIR = dataDir;
  const modulePath = require.resolve("../pdf-upload-support");
  delete require.cache[modulePath];
  const { createDeckReplacementHandler } = require("../pdf-upload-support");
  if (previousDataDir === undefined) delete process.env.IMMERSA_DATA_DIR;
  else process.env.IMMERSA_DATA_DIR = previousDataDir;
  const app = express();
  app.post("/decks/:deckId/replace", createDeckReplacementHandler({ async convertDeckPdf() { throw new Error("broken conversion"); } }));

  await withServer(app, async (origin) => {
    const form = new FormData();
    form.append("pptx", new Blob(["%PDF-1.4 new"]), "new.pdf");
    const response = await fetch(origin + "/decks/deck-a/replace", { method: "POST", body: form });
    assert.equal(response.status, 422);
  });
  assert.equal(await fs.promises.readFile(path.join(deckDir, "slides", "slide-1.jpg"), "utf8"), "old-slide");
  assert.equal(await fs.promises.readFile(path.join(deckDir, "interactions.json"), "utf8"), "preserve-me");
});

test("Home offers centered rename and replacement actions and explains preserved configuration", () => {
  const html = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  const css = fs.readFileSync(path.join(appDir, "public", "home", "home.css"), "utf8");
  assert.match(html, /id="detailRename"[^>]*>[\s\S]*Renombrar/);
  assert.match(html, /id="detailReplace"[^>]*>[\s\S]*Sustituir/);
  assert.doesNotMatch(html, /id="detailDelete"|Eliminar presentación/);
  assert.match(html, /id="replacementReview"/);
  assert.match(css, /\.deck-file-actions\s*\{[^}]*justify-content:center/s);
  assert.match(source, /encodeURIComponent\(deck\.deckId\) \+ "\/title"/);
  assert.match(source, /renderDecks\(\);[\s\S]*openDeckModal\(detailDeck\)/);
  assert.match(source, /Se conservarán Interacciones, Videos, enlaces y configuración/);
  assert.match(source, /Tu versión anterior permanece intacta/);
  assert.match(source, /encodeURIComponent\(deck\.deckId\) \+ "\/replace"/);
  assert.match(source, /const \[rawPath, \.\.\.queryParts\] = value\.split\("\?"\)/);
});

test("Deck summaries expose the versioned first slide for immediate Home cover refresh", () => {
  const server = fs.readFileSync(path.join(appDir, "server.js"), "utf8");
  const upload = fs.readFileSync(path.join(appDir, "pdf-upload-support.js"), "utf8");
  const source = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  assert.match(server, /thumbnail: manifest\.slides\?\.\[0\]\?\.thumb \|\| manifest\.slides\?\.\[0\]\?\.src/);
  assert.match(upload, /thumbnail: manifest\.slides\?\.\[0\]\?\.thumb \|\| manifest\.slides\?\.\[0\]\?\.src/);
  assert.match(server, /app\.get\("\/api\/decks"[\s\S]*?Cache-Control", "no-store"/);
  assert.match(source, /fetch\("\/api\/decks", \{ cache: "no-store" \}\)/);
  assert.match(source, /decks\[deckIndex\] = \{ \.\.\.decks\[deckIndex\], \.\.\.data \};[\s\S]*?renderDecks\(\)/);
  assert.match(source, /direct\.map\(\(value\) => deckAssetUrl\(deck\.deckId, value\)\)/);
});

test("Review confirmation refreshes rendered Deck handlers with the acknowledged state", () => {
  const source = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  assert.match(source, /replacementReview\.hidden = true;\s*renderDecks\(\);/);
});

test("Home puts presentations beside creation and uses the approved concise copy", () => {
  const html = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(appDir, "public", "home", "home.css"), "utf8");
  const source = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  assert.doesNotMatch(html, /class="content-tabs"/);
  assert.match(html, /Encuestas[\s\S]*Sorteos[\s\S]*Trivias[\s\S]*Q&amp;A[\s\S]*Evaluaciones[\s\S]*Métricas/);
  assert.match(html, /Tus experiencias listas para compartir en las manos de tu público\./);
  assert.doesNotMatch(html + source, /presentaciónes/);
  assert.doesNotMatch(html + source, /deckCount/);
  assert.doesNotMatch(source, /Elimina una para subir otra/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 390px\)/);
  assert.match(css, /\.create-panel \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 1;/);
  assert.match(css, /\.presentations-panel \{[\s\S]*grid-column: 1;[\s\S]*grid-row: 1;[\s\S]*padding-top: 162px;/);
});

test("Rename opens above Deck detail and owns Escape while active", () => {
  const source = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  const css = fs.readFileSync(path.join(appDir, "public", "home", "home.css"), "utf8");
  assert.match(css, /#nameModal\s*\{[^}]*z-index:\s*70/s);
  assert.match(source, /deckDetailModal\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(source, /if \(nameModal && !nameModal\.hidden\) return closeNameModal\(false\);[\s\S]*if \(deckDetailModal/);
});

test("Rename persists a bounded title on the owned Deck manifest", () => {
  const server = fs.readFileSync(path.join(appDir, "server.js"), "utf8");
  assert.match(server, /async function renameDeck\(deckId, requestedTitle\)/);
  assert.match(server, /title\.length > 120/);
  assert.match(server, /manifest\.title = title/);
  assert.match(server, /app\.put\("\/api\/decks\/:deckId\/title", \.\.\.requireDeckAccount/);
});
