const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLiveGuests } = require("../live-guests");
const { createLiveProjection } = require("../live-projection");
const { setTimeout: pause } = require("node:timers/promises");

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await pause(5);
  }
  assert.fail("Slide read did not start");
}

async function waitForLive(stage) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (stage.messages.at(-1)?.[1].phase === "live") return;
    await pause(50);
  }
  assert.fail("Countdown did not finish");
}

async function setup(t, options = {}) {
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
    dataDir, publicDir: path.resolve(__dirname, "../public"), origin: "https://beta.test", enabled: true,
    authorizeRole: async (role, token) => { const grant = grants.get(token); return grant?.accessLink.role === role ? grant : null; },
    getRtcConfiguration: async () => ({ iceServers: [], iceTransportPolicy: "all" }),
    projection, canProject: () => true, ...options
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
  screen.receive("guest:return-ready", true);
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
  assert.equal(stage.messages.at(-1)[1].phase, "starting");
  stage.receive("guest:ready", { id: prepared.id, channel: "program" });
  screen.receive("guest:ready", { id: prepared.id, channel: "program" });
  assert.equal(stage.messages.at(-1)[1].phase, "countdown");
  await waitForLive(stage);
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

test("the current slide is sent after entry and follows only its Deck/session in waiting and live", async t => {
  const current = { index: 2, src: "/decks/deck/slides/3.jpg", locale: "es", title: "Actual" };
  let reads = 0;
  const { open, stage, screen, runtime } = await setup(t, {
    getPresentationSlide: async (scope, snapshot) => {
      reads++;
      assert.equal(scope.deckId, "deck");
      assert.equal(scope.sessionId, "session");
      return snapshot ? { ...current, index: snapshot.liveSlideIndex } : current;
    }
  });
  const created = await stage.request("guest:invite", {});
  const guest = await open("guest", created.url.split("/").pop());
  const slides = () => guest.messages.filter(([event]) => event === "guest:slide").map(([, payload]) => payload);
  assert.equal(reads, 0);
  await guest.receive("guest:media-ready");
  assert.deepEqual(slides(), [current]);
  await runtime.updatePresentation({ deckId: "other", sessionId: "session", liveSlideIndex: 5 });
  await runtime.updatePresentation({ deckId: "deck", sessionId: "other", liveSlideIndex: 5 });
  assert.equal(reads, 1);
  await runtime.updatePresentation({ deckId: "deck", sessionId: "session", liveSlideIndex: 3 });
  assert.equal(slides().at(-1).index, 3);
  await runtime.updatePresentation({ deckId: "deck", sessionId: "session", liveSlideIndex: 3 });
  assert.equal(reads, 2);
  stage.receive("guest:media-ready");
  screen.receive("guest:media-ready");
  await stage.request("guest:connect");
  const { id } = guest.messages.find(([event]) => event === "guest:prepare")[1];
  stage.receive("guest:ready", { id, channel: "monitor" });
  await stage.request("guest:take");
  screen.receive("guest:ready", { id, channel: "program" });
  await runtime.updatePresentation({ deckId: "deck", sessionId: "session", liveSlideIndex: 4, operationalLocale: "en" });
  assert.equal(slides().at(-1).index, 4);
  const count = slides().length;
  await stage.request("guest:end");
  await runtime.updatePresentation({ deckId: "deck", sessionId: "session", liveSlideIndex: 5 });
  assert.equal(slides().length, count);
});

test("slow reads cannot overwrite newer slides or send content after replacement or revocation", async t => {
  const pending = [];
  const { open, stage, runtime, grants } = await setup(t, {
    getPresentationSlide: () => new Promise(resolve => pending.push(resolve))
  });
  const created = await stage.request("guest:invite", {});
  const guest = await open("guest", created.url.split("/").pop());
  const slides = () => guest.messages.filter(([event]) => event === "guest:slide");
  const initial = guest.receive("guest:media-ready");
  await waitFor(() => pending.length === 1);
  const newerSlide = runtime.updatePresentation({ deckId: "deck", sessionId: "session", liveSlideIndex: 1 });
  await waitFor(() => pending.length === 2);
  pending[1]({ index: 1 });
  await newerSlide;
  pending[0]({ index: 0 });
  await initial;
  assert.deepEqual(slides().map(([, slide]) => slide.index), [1]);
  const replaced = runtime.updatePresentation({ deckId: "deck", sessionId: "session", liveSlideIndex: 2 });
  await waitFor(() => pending.length === 3);
  await stage.request("guest:invite", {});
  pending[2]({ index: 2 });
  await replaced;
  assert.equal(slides().length, 1);
  const newer = await stage.request("guest:invite", {});
  const nextGuest = await open("guest", newer.url.split("/").pop());
  grants.delete("a_stage00001");
  await nextGuest.receive("guest:media-ready");
  assert.equal(pending.length, 3);
  assert.equal(nextGuest.messages.filter(([event]) => event === "guest:slide").at(-1)[1], null);
});

test("countdown waits for picture and return, can be cancelled to private waiting and retaken", async t => {
  const { stage, screen, open, projection } = await setup(t);
  const created = await stage.request("guest:invite", {});
  const guest = await open("guest", created.url.split("/").pop());
  for (const peer of [stage, screen, guest]) await peer.receive("guest:media-ready");
  await stage.request("guest:connect");
  const { id } = guest.messages.find(([event]) => event === "guest:prepare")[1];
  stage.receive("guest:ready", { id, channel: "monitor" });
  screen.receive("guest:return-ready", false);
  assert.equal((await stage.request("guest:take")).ok, false);
  screen.receive("guest:return-ready", true);
  assert.equal((await stage.request("guest:take")).ok, true);
  screen.receive("guest:ready", { id, channel: "program" });
  assert.equal(stage.messages.at(-1)[1].phase, "starting");
  stage.receive("guest:ready", { id, channel: "program" });
  assert.equal(guest.messages.at(-1)[1].countdown, 3);
  assert.equal((await stage.request("guest:wait")).ok, true);
  assert.equal(guest.messages.at(-1)[1].phase, "ready");
  assert.equal(guest.connected, true);
  assert.equal(projection.acquire("session", "deck", "other"), true);
  projection.release("session", "deck", "other");
  await pause(1100);
  assert.equal(guest.messages.at(-1)[1].phase, "ready");
  assert.equal((await stage.request("guest:take")).ok, true);
  stage.receive("guest:ready", { id, channel: "program" });
  screen.receive("guest:ready", { id, channel: "program" });
  await waitForLive(stage);
  assert.deepEqual(guest.messages.filter(([event, value]) => event === "guest:state" && value.phase === "countdown").slice(-3).map(([, value]) => value.countdown), [3, 2, 1]);
  assert.equal((await stage.request("guest:wait")).ok, true);
  assert.equal(guest.messages.at(-1)[1].phase, "ready");
});

test("the guest welcome uses the current Deck title and safely escapes personalized names", async t => {
  const { stage, runtime, grants } = await setup(t);
  grants.get("a_stage00001").deck.title = 'Deck <script>alert(1)</script>';
  const invitation = await stage.request("guest:invite", { name: '<img src=x onerror=alert(1)>' });
  let html;
  const response = { set() {}, type(value) { assert.equal(value, "html"); return this; }, send(value) { html = value; } };
  await runtime.openGuest({ params: { token: invitation.url.split("/").pop() } }, response);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('Deck &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('a_stage00001'));
  assert.ok(!html.includes('{{GUEST_NAME}}'));
  assert.ok(html.includes('Entrar a la sala de espera'));
});

test("public poll results and reactions stay scoped, recover after entry and stop after end or revocation", async t => {
  let current = { title: "Resultados", options: [] };
  const { stage, open, runtime, grants } = await setup(t, { getPublicResults: async () => current });
  const invite = await stage.request("guest:invite", {});
  const guest = await open("guest", invite.url.split("/").pop());
  const content = () => guest.messages.filter(([event]) => event === "guest:content");
  assert.equal(content().length, 0);
  await runtime.reaction({ deckId: "deck", sessionId: "session" }, { emoji: "❤️" });
  assert.equal(guest.messages.some(([event]) => event === "guest:reaction"), false);
  await guest.receive("guest:media-ready");
  assert.deepEqual(content().at(-1)[1], { results: current });
  await runtime.reaction({ deckId: "other", sessionId: "session" }, { emoji: "❤️" });
  assert.equal(guest.messages.some(([event]) => event === "guest:reaction"), false);
  await runtime.reaction({ deckId: "deck", sessionId: "session" }, { emoji: "❤️", name: "private" });
  assert.deepEqual(guest.messages.at(-1), ["guest:reaction", { emoji: "❤️" }]);
  current = null;
  const before = content().length;
  for (let i = 0; i < 30; i++) runtime.updateContent({ deckId: "deck", sessionId: "session" });
  await waitFor(() => content().length > before);
  assert.equal(content().length, before + 1);
  assert.deepEqual(content().at(-1)[1], { results: null });
  current = { title: "New results", options: [] };
  guest.disconnect();
  const reconnect = await open("guest", invite.url.split("/").pop());
  await reconnect.receive("guest:media-ready");
  assert.deepEqual(reconnect.messages.filter(([event]) => event === "guest:content").at(-1)[1], { results: current });
  grants.delete("a_stage00001");
  await runtime.reaction({ deckId: "deck", sessionId: "session" }, { emoji: "🔥" });
  assert.equal(reconnect.messages.some(([event]) => event === "guest:reaction"), false);
  await reconnect.receive("guest:media-ready");
  assert.deepEqual(reconnect.messages.filter(([event]) => event === "guest:content").at(-1)[1], { results: null });
  await runtime.endSession({ deckId: "deck", sessionId: "session" });
  const endedCount = reconnect.messages.length;
  runtime.updateContent({ deckId: "deck", sessionId: "session" });
  await runtime.reaction({ deckId: "deck", sessionId: "session" }, { emoji: "❤️" });
  await pause(100);
  assert.equal(reconnect.messages.length, endedCount);
});
