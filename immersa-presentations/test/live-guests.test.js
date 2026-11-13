const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLiveGuests } = require("../live-guests");
const { createLiveProjection } = require("../live-projection");

async function setup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "live-guests-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let authorize, connected;
  const projection = createLiveProjection();
  const grants = new Map([
    ["a_stage00001", { accessLink: { role: "stage", session_id: "session" }, deck: { deckId: "deck" } }],
    ["a_screen0001", { accessLink: { role: "screen", session_id: "session" }, deck: { deckId: "deck" } }],
    ["a_screen0002", { accessLink: { role: "screen", session_id: "session" }, deck: { deckId: "other" } }]
  ]);
  const runtime = createLiveGuests({
    io: { of(name) { assert.equal(name, "/live-guests"); return { use(fn) { authorize = fn; }, on(event, fn) { connected = fn; } }; } },
    dataDir, publicDir: "public", origin: "https://beta.test", enabled: true,
    authorizeRole: async (role, token) => { const grant = grants.get(token); return grant?.accessLink.role === role ? grant : null; },
    getRtcConfiguration: async () => ({ iceServers: [], iceTransportPolicy: "all" }),
    projection, canProject: () => true
  });
  async function open(role, token, origin = "https://beta.test") {
    const handlers = new Map();
    const socket = {
      data: {}, connected: true, messages: [], handshake: { auth: { role, token }, headers: { origin } },
      on(event, fn) { handlers.set(event, fn); },
      emit(event, payload) { this.messages.push([event, payload]); },
      receive(event, ...args) { return handlers.get(event)(...args); },
      disconnect() { if (!this.connected) return; this.connected = false; handlers.get("disconnect")?.(); }
    };
    const denied = await new Promise(resolve => authorize(socket, resolve));
    if (denied) return denied;
    connected(socket);
    t.after(() => socket.disconnect());
    return socket;
  }
  const stage = await open("stage", "a_stage00001");
  const screen = await open("screen", "a_screen0001");
  const makeRequest = (socket, event, ...args) => new Promise(resolve => socket.receive(event, ...args, resolve));
  stage.request = makeRequest.bind(null, stage);
  return { open, stage, screen, runtime, projection, grants, dataDir };
}

// A small fake namespace keeps authorization, routing and lifecycle tests independent of the network.
test("guest links are scoped, persisted and invalidated on replacement or revocation", async t => {
  const { open, stage, runtime, grants } = await setup(t);
  assert.ok(await open("stage", "a_stage00001", "https://foreign.test") instanceof Error);
  assert.ok(await open("audience", "a_stage00001") instanceof Error);
  assert.ok(await open("stage", "a_screen0001") instanceof Error);
  const created = await stage.request("guest:invite", { name: "Arquitecto" });
  assert.equal(created.ok, true);
  const token = created.url.split("/").pop();
  const guest = await open("guest", token);
  assert.equal(guest.messages.at(-1)[1].guestName, "Arquitecto");
  const replacement = await stage.request("guest:invite", { name: "Directora" });
  assert.equal(guest.connected, false);
  assert.equal(guest.messages.at(-1)[1].phase, "ended");
  assert.ok(await open("guest", token) instanceof Error);
  const otherGuest = await open("guest", replacement.url.split("/").pop());
  assert.equal(otherGuest.messages.at(-1)[1].guestName, "Directora");
  grants.delete("a_stage00001");
  assert.ok(await open("guest", replacement.url.split("/").pop()) instanceof Error);
  assert.ok(runtime.pageAssets({ accessLink: { role: "stage" } }));
  assert.equal(runtime.pageAssets({ accessLink: { role: "audience" } }), null);
});

test("only Stage can put a prepared guest on air, with one shared LIVE program owner", async t => {
  const { open, stage, screen, projection, runtime } = await setup(t);
  const created = await stage.request("guest:invite", { name: "Invitado" });
  const guest = await open("guest", created.url.split("/").pop());
  const other = await open("screen", "a_screen0002");
  stage.receive("guest:media-ready");
  guest.receive("guest:media-ready");
  screen.receive("guest:media-ready");
  assert.deepEqual(await stage.request("guest:take"), { ok: false, reason: "busy" });
  assert.deepEqual(await stage.request("guest:connect"), { ok: true });
  const prepared = guest.messages.find(([event]) => event === "guest:prepare")[1];
  assert.equal(prepared.channel, "monitor");
  assert.equal(screen.messages.some(([event]) => event === "guest:prepare"), false);
  guest.receive("guest:ready", { id: prepared.id, channel: "monitor" });
  assert.equal(stage.messages.filter(([event]) => event === "guest:state").at(-1)[1].phase, "preparing");
  stage.receive("guest:ready", { id: prepared.id, channel: "monitor" });
  assert.equal(stage.messages.at(-1)[1].phase, "ready");
  projection.acquire("session", "deck", "speaker-live");
  assert.deepEqual(await stage.request("guest:take"), { ok: false, reason: "production" });
  projection.release("session", "deck", "speaker-live");
  assert.deepEqual(await stage.request("guest:take"), { ok: true });
  assert.equal(other.messages.some(([event]) => event === "guest:prepare"), false);
  stage.receive("guest:ready", { id: prepared.id, channel: "program" });
  assert.equal(stage.messages.at(-1)[1].phase, "starting");
  screen.receive("guest:ready", { id: prepared.id, channel: "program" });
  assert.equal(stage.messages.at(-1)[1].phase, "live");
  assert.equal(projection.acquire("session", "deck", "speaker-live"), false);
  guest.receive("guest:mute", true);
  assert.equal(stage.messages.at(-1)[1].muted, false);
  stage.receive("guest:mute", true);
  assert.equal(screen.messages.at(-1)[1].muted, true);
  await runtime.endSession({ deckId: "deck", sessionId: "session" });
  assert.equal(guest.messages.at(-1)[1].phase, "ended");
  assert.equal(projection.acquire("session", "deck", "speaker-live"), true);
});

test("a disconnect immediately cuts the program, releases the lock and requires a fresh take", async t => {
  const { open, stage, screen, projection } = await setup(t);
  const created = await stage.request("guest:invite", { name: "Invitado" });
  const guest = await open("guest", created.url.split("/").pop());
  for (const peer of [stage, screen, guest]) peer.receive("guest:media-ready");
  await stage.request("guest:connect");
  const { id } = guest.messages.find(([event]) => event === "guest:prepare")[1];
  stage.receive("guest:ready", { id, channel: "monitor" });
  await stage.request("guest:take");
  screen.receive("guest:ready", { id, channel: "program" });
  screen.disconnect();
  assert.equal(guest.messages.at(-1)[1].phase, "waiting");
  assert.equal(projection.acquire("session", "deck", "speaker-live"), true);
  const reconnect = await open("screen", "a_screen0001");
  reconnect.receive("guest:media-ready");
  assert.equal(guest.messages.at(-1)[1].phase, "waiting");
  assert.deepEqual(await stage.request("guest:take"), { ok: false, reason: "busy" });
});

test("finished invitations remain terminal on reconnect and expired links are rejected", async t => {
  const { open, stage, dataDir } = await setup(t);
  const created = await stage.request("guest:invite", { name: "Invitado" });
  const token = created.url.split("/").pop();
  const guest = await open("guest", token);
  assert.deepEqual(await stage.request("guest:end"), { ok: true });
  guest.disconnect();
  const reconnected = await open("guest", token);
  assert.equal(reconnected.messages.at(-1)[1].phase, "ended");
  stage.receive("guest:media-ready");
  reconnected.receive("guest:media-ready");
  assert.deepEqual(await stage.request("guest:connect"), { ok: false, reason: "access" });
  assert.equal(reconnected.messages.some(([event]) => event === "guest:prepare"), false);
  const replacement = await stage.request("guest:invite", { name: "Invitado" });
  const newToken = replacement.url.split("/").pop();
  const filename = path.join(dataDir, "live-guests", newToken.slice(0, 64) + ".json");
  const record = JSON.parse(await fs.readFile(filename, "utf8"));
  record.expiresAt = Date.now() - 1;
  await fs.writeFile(filename, JSON.stringify(record));
  assert.ok(await open("guest", newToken) instanceof Error);
});
