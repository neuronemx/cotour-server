const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { manifestSessionId } = require("../session-id");

const deckId = "live-shop-demo";

async function fixture(t) {
  const { synchronizeDemoDeck } = await import("../scripts/seed-live-shop-demo.mjs");
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-shop-seed-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const manifestPath = path.join(dataDir, "decks", deckId, "manifest.json");
  const linksPath = path.join(dataDir, "access-links.json");
  return { synchronizeDemoDeck, dataDir, manifestPath, linksPath };
}

test("fresh Live Shop deck shares one valid session ID across Home, ownership and role links", async t => {
  const { synchronizeDemoDeck, dataDir, manifestPath, linksPath } = await fixture(t);
  const registrations = [];
  const workspaces = {
    ownsDeck: async () => false,
    registerDeck: async deck => registrations.push(deck)
  };
  const sessionId = await synchronizeDemoDeck({ workspaces, dataDir, userId: "tester", workspaceId: "workspace" });
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifestSessionId(manifest), sessionId);
  assert.equal(registrations[0].sessionId, sessionId);
  const links = JSON.parse(await fs.readFile(linksPath, "utf8"));
  assert.deepEqual(links.map(link => [link.role, link.session_id]), [["speaker", sessionId], ["screen", sessionId]]);
});

test("bootstrap repairs ownership and old links after Home normalized the manifest session ID", async t => {
  const { synchronizeDemoDeck, dataDir, manifestPath, linksPath } = await fixture(t);
  const sessionId = "s_abcdefgh12";
  const oldSessionId = "live-shop-demo-v01";
  const manifest = { deckId, session_id: sessionId, title: "Mi deck editado" };
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const other = { deck_id: "different-deck", session_id: oldSessionId, access_token: "a_otherdeck1" };
  await fs.writeFile(linksPath, JSON.stringify([
    { deck_id: deckId, session_id: oldSessionId, role: "speaker", access_token: "a_speaker123" },
    { deck_id: deckId, session_id: oldSessionId, role: "screen", access_token: "a_screen1234", presentation_session_id: "old-execution" },
    { deck_id: deckId, session_id: oldSessionId, role: "audience", access_token: "a_audience12", public_id: "p_liveaudience" },
    other
  ]));
  const updates = [];
  const options = {
    database: { execute: async (_sql, args) => updates.push(args) },
    workspaces: { ownsDeck: async () => true },
    userId: "tester", workspaceId: "workspace", dataDir
  };
  assert.equal(await synchronizeDemoDeck(options), sessionId);
  assert.deepEqual(updates, [[sessionId, deckId, "workspace", sessionId]]);
  assert.deepEqual(JSON.parse(await fs.readFile(manifestPath, "utf8")), manifest);
  const links = JSON.parse(await fs.readFile(linksPath, "utf8"));
  assert.deepEqual(links.slice(0, 3).map(link => link.session_id), Array(3).fill(sessionId));
  assert.deepEqual(links.slice(0, 3).map(link => link.access_token), ["a_speaker123", "a_screen1234", "a_audience12"]);
  assert.equal(links[1].presentation_session_id, undefined);
  assert.equal(links[2].public_id, "p_liveaudience");
  assert.deepEqual(links[3], other);
  await synchronizeDemoDeck(options);
  assert.deepEqual(JSON.parse(await fs.readFile(linksPath, "utf8")), links);
});
