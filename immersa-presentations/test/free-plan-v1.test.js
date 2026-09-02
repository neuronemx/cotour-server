const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const {
  BYTES_PER_MEGABYTE,
  PLAN_LIMITS,
  PlanLimitError,
  summarizePlanUsage
} = require("../auth/plan-limits");
const { WorkspaceRepository } = require("../auth/workspace-repository");

const appDir = path.join(__dirname, "..");

function reservationPool({ plan = "FREE", deckCount = 0, storageBytes = 0 } = {}) {
  const calls = [];
  const connection = {
    async beginTransaction() { calls.push({ kind: "begin" }); },
    async commit() { calls.push({ kind: "commit" }); },
    async rollback() { calls.push({ kind: "rollback" }); },
    release() { calls.push({ kind: "release" }); },
    async execute(sql, params) {
      calls.push({ kind: "execute", sql: String(sql), params });
      if (/SELECT w\.id, w\.plan/.test(sql)) return [[{ id: "workspace-a", plan }]];
      if (/SELECT COUNT\(\*\) AS deck_count/.test(sql)) return [[{ deck_count: deckCount, storage_bytes: storageBytes }]];
      if (/INSERT INTO decks/.test(sql)) return [{ affectedRows: 1 }];
      return [[], []];
    }
  };
  return {
    calls,
    pool: { async getConnection() { return connection; } }
  };
}

async function withServer(app, operation) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await operation(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("FREE plan is frozen at 2 Decks and 50 MB of final Deck storage", () => {
  assert.deepEqual(PLAN_LIMITS.FREE, { decks: 2, audience: 25, storageBytes: 50 * BYTES_PER_MEGABYTE });
  assert.deepEqual(summarizePlanUsage("free", { decks: "1", storageBytes: String(25 * BYTES_PER_MEGABYTE) }), {
    plan: "FREE",
    usage: { decks: 1, storageBytes: 25 * BYTES_PER_MEGABYTE },
    limits: { decks: 2, audience: 25, storageBytes: 50 * BYTES_PER_MEGABYTE },
    remaining: { decks: 1, storageBytes: 25 * BYTES_PER_MEGABYTE },
    canCreateDeck: true
  });
});

test("SPEAKER and SPEAKER PRO use the approved Deck and storage limits", () => {
  assert.deepEqual(PLAN_LIMITS.SPEAKER, { decks: 5, audience: 100, storageBytes: 200 * BYTES_PER_MEGABYTE });
  assert.deepEqual(PLAN_LIMITS.SPEAKER_PRO, { decks: 15, audience: 300, storageBytes: 500 * BYTES_PER_MEGABYTE });
  assert.equal(summarizePlanUsage("speaker-pro", { decks: 14, storageBytes: 499 * BYTES_PER_MEGABYTE }).canCreateDeck, true);
});

test("Deck reservation locks the workspace before its final storage is known", async () => {
  const { pool, calls } = reservationPool({ deckCount: 1, storageBytes: 35 * BYTES_PER_MEGABYTE });
  const repository = new WorkspaceRepository(pool);
  const result = await repository.reserveDeck({
    userId: "user-a",
    workspaceId: "workspace-a",
    deckId: "deck-new",
    sessionId: "session-new",
    sourceSizeBytes: 0
  });

  assert.equal(result.usage.decks, 2);
  assert.equal(result.usage.storageBytes, 35 * BYTES_PER_MEGABYTE);
  const workspaceLock = calls.find((call) => /SELECT w\.id, w\.plan/.test(call.sql || ""));
  assert.match(workspaceLock.sql, /FOR UPDATE/);
  const insert = calls.find((call) => /INSERT INTO decks/.test(call.sql || ""));
  assert.deepEqual(insert.params, ["deck-new", "workspace-a", "session-new", "user-a", 0]);
  assert.equal(calls.some((call) => call.kind === "commit"), true);
  assert.equal(calls.some((call) => call.kind === "rollback"), false);
});

test("Deck limits reject reservations before the conversion begins", async () => {
  for (const scenario of [
    { deckCount: 2, storageBytes: 20, sourceSizeBytes: 0, code: "DECK_LIMIT_REACHED" }
  ]) {
    const { pool, calls } = reservationPool(scenario);
    const repository = new WorkspaceRepository(pool);
    await assert.rejects(
      repository.reserveDeck({
        userId: "user-a",
        workspaceId: "workspace-a",
        deckId: "deck-blocked",
        sessionId: "session-blocked",
        sourceSizeBytes: scenario.sourceSizeBytes
      }),
      (error) => error instanceof PlanLimitError && error.code === scenario.code && error.statusCode === 409
    );
    assert.equal(calls.some((call) => /INSERT INTO decks/.test(call.sql || "")), false);
    assert.equal(calls.some((call) => call.kind === "rollback"), true);
  }
});

test("Plan usage reads Deck count and final storage from the authenticated workspace", async () => {
  const calls = [];
  const repository = new WorkspaceRepository({
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      return [[{ plan: "FREE", deck_count: 1, storage_bytes: 7340032 }]];
    }
  });
  const result = await repository.getPlanUsage({ userId: "user-a", workspaceId: "workspace-a" });
  assert.equal(result.plan, "FREE");
  assert.equal(result.usage.decks, 1);
  assert.equal(result.usage.storageBytes, 7340032);
  assert.deepEqual(calls[0].params, ["workspace-a", "user-a"]);
  assert.match(calls[0].sql, /SUM\(d\.source_size_bytes\)/);
});

test("Existing Decks can be recalculated from their final stored assets", async () => {
  const calls = [];
  const repository = new WorkspaceRepository({
    async execute(sql, params) {
      calls.push({ sql: String(sql), params });
      if (/SELECT d\.deck_id/.test(sql)) return [[{ deck_id: "legacy-a" }, { deck_id: "legacy-b" }]];
      return [{ affectedRows: 1 }];
    }
  });

  assert.deepEqual(await repository.listDeckIdsForStorageSync({ userId: "user-a", workspaceId: "workspace-a" }), ["legacy-a", "legacy-b"]);
  assert.equal(await repository.setDeckSourceSize({
    userId: "user-a",
    workspaceId: "workspace-a",
    deckId: "legacy-a",
    sourceSizeBytes: 4096
  }), true);
  assert.doesNotMatch(calls[0].sql, /source_size_bytes IS NULL/);
  assert.match(calls[1].sql, /SET d\.source_size_bytes = \?/);
  assert.doesNotMatch(calls[1].sql, /source_size_bytes IS NULL/);
  assert.deepEqual(calls[1].params, [4096, "workspace-a", "legacy-a", "user-a"]);
});

test("Upload returns the plan conflict before writing or converting a Deck", async (t) => {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "immersa-free-plan-"));
  t.after(() => fs.promises.rm(dataDir, { recursive: true, force: true }));
  const previousDataDir = process.env.IMMERSA_DATA_DIR;
  process.env.IMMERSA_DATA_DIR = dataDir;
  const modulePath = require.resolve("../pdf-upload-support");
  delete require.cache[modulePath];
  const { createUploadHandler } = require("../pdf-upload-support");
  if (previousDataDir === undefined) delete process.env.IMMERSA_DATA_DIR;
  else process.env.IMMERSA_DATA_DIR = previousDataDir;

  const summary = summarizePlanUsage("FREE", { decks: 2, storageBytes: 1024 });
  const app = express();
  app.post("/upload", createUploadHandler({
    async onDeckCreateStart() {
      throw new PlanLimitError("DECK_LIMIT_REACHED", "Ya no hay cupos disponibles.", summary);
    }
  }));

  await withServer(app, async (origin) => {
    const form = new FormData();
    form.append("pptx", new Blob(["%PDF-1.4\n"], { type: "application/pdf" }), "deck.pdf");
    form.append("title", "Deck bloqueado");
    const response = await fetch(origin + "/upload", { method: "POST", body: form });
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "DECK_LIMIT_REACHED");
    assert.equal(payload.error, "Ya no hay cupos disponibles.");
    assert.equal(payload.plan.usage.decks, 2);
  });

  const deckRoot = path.join(dataDir, "decks");
  assert.deepEqual(await fs.promises.readdir(deckRoot), []);
});

test("Home exposes plan, Deck, and storage usage while the server validates converted assets", () => {
  const html = fs.readFileSync(path.join(appDir, "public", "home", "index.html"), "utf8");
  const source = fs.readFileSync(path.join(appDir, "public", "home", "home.js"), "utf8");
  const css = fs.readFileSync(path.join(appDir, "public", "home", "home.css"), "utf8");
  const server = fs.readFileSync(path.join(appDir, "server.js"), "utf8");

  assert.match(html, /id="accountPlanBadge"[^>]*>FREE</);
  assert.match(html, /id="planDeckUsage">0 de 2</);
  assert.match(html, /id="planStorageUsage">0 MB de 50 MB</);
  assert.match(html, /id="planAudienceLimit">Hasta 25</);
  assert.match(html, /id="billingOpen"[^>]*>Ver planes</);
  assert.match(html, /id="planBadge"[^>]*aria-controls="planUsage"/);
  assert.ok(html.indexOf('id="uploadStatus"') < html.indexOf('id="planLimitMessage"'));
  assert.match(source, /fetch\("\/api\/account\/plan"/);
  assert.doesNotMatch(source, /file\.size[^\n]+planUsage\.remaining\?\.storageBytes/);
  assert.match(source, /fileInput\.disabled = Boolean\(blockedMessage\)/);
  assert.match(source, /planAudienceLimit\.textContent = "Hasta " \+ Math\.max/);
  assert.match(source, /classList\.toggle\("is-limit", atLimit\)/);
  assert.match(source, /setPlanUsageOpen\(planUsagePopover\.hidden\)/);
  assert.match(css, /\.drop-zone\.is-disabled/);
  assert.match(css, /\.stage-header \{[\s\S]*position:\s*fixed/);
  assert.match(server, /app\.get\("\/api\/account\/plan", requireAccount/);
  assert.match(server, /synchronizeWorkspaceStorageSizes/);
  assert.match(server, /onDeckCreateStart:[^\n]+reserveUploadedDeck/);
  assert.match(server, /onDeckCreateFinalized:[^\n]+replaceDeckSource/);
  assert.match(server, /canRegisterAudience\(session, requestedAudienceId, audienceLimit\)/);
  assert.match(server, /AUDIENCE_LIMIT_REACHED/);
});


test("Cobros renders FREE as a non-purchasable in-app plan reference", () => {
  const billing = fs.readFileSync(path.join(appDir, "public", "home", "billing.js"), "utf8");
  const css = fs.readFileSync(path.join(appDir, "public", "home", "billing.css"), "utf8");

  assert.match(billing, /function freePlanFeatures\(\)/);
  assert.match(billing, /"2 Decks · 50 MB"/);
  assert.match(billing, /"Hasta 25 personas"/);
  assert.match(billing, /"Compartir pantalla"/);
  assert.match(billing, /"Trazo y reacciones en vivo"/);
  assert.match(billing, /"Semblanza del Speaker"/);
  assert.match(billing, /freeActive \? "Plan actual" : "Plan gratuito"/);
  assert.match(billing, /freeButton\.classList\.toggle\("is-current", freeActive\)/);
  assert.match(css, /\.billing-plans\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.billing-tier-dot\.free\{background:#A1A1AA\}/);
});
