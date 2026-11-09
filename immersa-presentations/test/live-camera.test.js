const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { readLiveCameraPilot, readLiveCameraDemo, liveCameraPageAssets, attachLiveCamera } = require("../live-camera");

const config = {
  origin: "https://beta.example.test", eventWorkspaceId: "event-a", activityId: "activity-a",
  deckId: "deck-a", sessionId: "room-a",
  links: { speaker: "a_speaker001", screen: "a_screen0001", stage: "a_stage00001" }
};

function configure(overrides = {}) {
  return readLiveCameraPilot({ IMMERSA_LIVE_CAMERA_PILOT: JSON.stringify({ ...config, ...overrides }) });
}

function roleAccess(role, token = config.links[role]) {
  return {
    accessLink: { role, access_token: token, session_id: config.sessionId },
    deck: { deckId: config.deckId, session_id: config.sessionId }
  };
}

test("camera assets are gated by the pilot and the exact role link", () => {
  const page = { req: { query: {} }, ...roleAccess("speaker") };
  assert.equal(readLiveCameraPilot({}), null);
  assert.equal(configure({ forceRelay: true }), null);
  assert.equal(liveCameraPageAssets(null, page), null);
  assert.match(liveCameraPageAssets(configure(), page), /live-camera\/pilot.js/);
  assert.equal(liveCameraPageAssets(configure(), { ...page, req: { query: { deck: "deck-b" } } }), null);
  assert.equal(liveCameraPageAssets(configure(), { ...page, accessLink: { ...page.accessLink, access_token: "a_individ001" } }), null);
  assert.equal(liveCameraPageAssets(configure(), { req: page.req, ...roleAccess("audience") }), null);
});

function testChannel(t, namespaceName) {
  const broadcasts = [];
  const channel = {
    use(fn) { this.authorize = fn; },
    on(_event, fn) { this.connect = fn; },
    emit(event, payload) { broadcasts.push([event, payload]); }
  };
  const namespace = { of: name => { assert.equal(name, namespaceName); return channel; } };
  async function open(role, accessToken = config.links[role], origin = config.origin) {
    const handlers = new Map();
    const socket = {
      handshake: { auth: { role, accessToken }, headers: { origin } }, data: {}, connected: true, messages: [],
      on: (event, handler) => handlers.set(event, handler),
      emit(event, payload) { this.messages.push([event, payload]); },
      receive: (event, payload) => handlers.get(event)(payload),
      disconnect() { this.connected = false; handlers.get("disconnect")?.(); }
    };
    const error = await new Promise(resolve => channel.authorize(socket, resolve));
    if (error) return error;
    channel.connect(socket);
    t.after(() => socket.disconnect());
    return socket;
  }
  return { namespace, open, broadcasts };
}

test("a demo Deck uses its normal Speaker and Screen links without Event Hub", async t => {
  const { namespace, open, broadcasts } = testChannel(t, "/live-camera-demo");
  const demo = readLiveCameraDemo({ IMMERSA_LIVE_CAMERA_DEMO: JSON.stringify({ origin: config.origin, deckId: config.deckId }) });
  const ordinarySpeaker = "a_individ001";
  const isEventLink = token => token === config.links.speaker;
  const page = { req: { query: {} }, ...roleAccess("speaker", ordinarySpeaker) };
  assert.equal(readLiveCameraDemo({}), null);
  const byTitle = { origin: config.origin, deckTitle: "Prueba BETA" };
  assert.equal(readLiveCameraDemo({ IMMERSA_LIVE_CAMERA_DEMO: JSON.stringify(byTitle) }).deckTitle, byTitle.deckTitle);
  assert.equal(readLiveCameraDemo({ IMMERSA_LIVE_CAMERA_DEMO: JSON.stringify({ ...byTitle, deckId: config.deckId }) }), null);
  assert.match(liveCameraPageAssets(demo, page, isEventLink), /data-live-camera-namespace="\/live-camera-demo"/);
  assert.equal(liveCameraPageAssets(demo, { ...page, deck: { ...page.deck, deckId: "other-deck" } }), null);
  assert.equal(liveCameraPageAssets(demo, { ...page, req: { query: { eventActivityId: config.activityId } } }), null);
  assert.equal(liveCameraPageAssets(demo, { ...page, ...roleAccess("speaker") }, isEventLink), null);
  assert.equal(liveCameraPageAssets(demo, { ...page, ...roleAccess("stage") }), null);
  let screenSession = config.sessionId;
  let blocked = false;
  attachLiveCamera(namespace, {
    pilot: demo,
    isEventLink,
    accessLinks: {
      resolveRoleLink: async (token, role) => {
        if (role === "speaker" && [ordinarySpeaker, config.links.speaker].includes(token)) return roleAccess(role, token);
        if (role !== "screen" || token !== config.links.screen) return null;
        const result = roleAccess(role);
        result.accessLink.session_id = screenSession;
        return result;
      }
    },
    canProject: sessionId => {
      assert.equal(sessionId, config.sessionId);
      return !blocked;
    }
  });

  assert.ok(await open("speaker", ordinarySpeaker, "https://elsewhere.test") instanceof Error);
  assert.ok(await open("speaker") instanceof Error);
  assert.ok(await open("screen", ordinarySpeaker) instanceof Error);
  assert.ok(await open("stage") instanceof Error);
  const screen = await open("screen");
  const speaker = await open("speaker", ordinarySpeaker);
  const start = () => new Promise(resolve => speaker.receive("live:start", resolve));
  screenSession = "stale-session";
  assert.deepEqual(await start(), { ok: false, reason: "screen-access" });
  screenSession = config.sessionId;
  blocked = true;
  assert.deepEqual(await start(), { ok: false, reason: "production" });
  blocked = false;
  assert.deepEqual(await start(), { ok: true });
  const id = broadcasts.at(-1)[1].id;
  screen.receive("live:ready", id);
  assert.equal(broadcasts.at(-1)[1].phase, "live");
  await speaker.receive("live:stop", { id });
  assert.equal(broadcasts.at(-1)[1].phase, "idle");
});

test("only authenticated participants in the configured live event can negotiate one video source", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"] });
  const { namespace, open, broadcasts } = testChannel(t, "/live-camera");
  let live = null;
  let serviceUnavailable = false;
  const revoked = new Set();
  const turnUrls = ["turns:turn.example.test:443?transport=tcp"];
  const turnSecret = "relay-test-secret";
  attachLiveCamera(namespace, {
    pilot: readLiveCameraPilot({
      IMMERSA_LIVE_CAMERA_PILOT: JSON.stringify({ ...config, turnUrls }),
      IMMERSA_LIVE_CAMERA_TURN_SECRET: turnSecret
    }),
    accessLinks: { resolveRoleLink: async (token, role) => token === config.links[role] && !revoked.has(role) ? roleAccess(role) : null },
    eventHub: {
      getStageControlForDeck: async () => {
        if (serviceUnavailable) throw new Error("Event Hub unavailable");
        return { eventWorkspaceId: config.eventWorkspaceId, activityId: config.activityId, stageId: "stage-a", liveSessionId: live?.id };
      },
      getLiveSession: async () => live,
      authorizeStageOperation: async () => {}
    }
  });

  assert.ok(await open("screen", config.links.speaker) instanceof Error);
  assert.ok(await open("speaker", "a_individ001") instanceof Error);
  assert.ok(await open("speaker", config.links.speaker, "https://elsewhere.test") instanceof Error);
  assert.ok(await open("audience") instanceof Error);

  const screen = await open("screen");
  const secondScreen = await open("screen");
  assert.equal(secondScreen.connected, false);
  const speaker = await open("speaker");
  const otherSpeaker = await open("speaker");
  const stage = await open("stage");
  const start = socket => new Promise(resolve => socket.receive("live:start", resolve));
  async function waitForStartTimeout() {
    for (let seconds = 0; seconds < 15; seconds++) {
      t.mock.timers.tick(1000);
      await new Promise(setImmediate);
    }
  }
  assert.deepEqual(await start(speaker), { ok: false, reason: "event" });

  live = { id: "event-live-a", status: "LIVE", event_workspace_id: "event-a", event_activity_id: "activity-a", event_stage_id: "stage-a", deck_id: "deck-a" };
  const starting = start(speaker);
  assert.deepEqual(await start(otherSpeaker), { ok: false, reason: "busy" });
  assert.deepEqual(await starting, { ok: true });
  const id = screen.messages.find(([event]) => event === "live:prepare")[1].id;
  for (const socket of [speaker, screen]) {
    const { rtc } = socket.messages.find(([event]) => event === "live:prepare")[1];
    assert.equal(rtc.iceTransportPolicy, "all");
    const [{ urls, username, credential }] = rtc.iceServers;
    assert.deepEqual(urls, turnUrls);
    assert.equal(Number(username.split(":")[0]), Math.floor(Date.now() / 1000 + 600));
    assert.equal(credential, createHmac("sha1", turnSecret).update(username).digest("base64"));
  }
  assert.equal(secondScreen.messages.length, 0);
  const signal = sdp => ({ id, description: { type: "offer", sdp } });
  speaker.receive("live:signal", signal("v=0\r\nm=video 9\r\nm=audio 9\r\n"));
  otherSpeaker.receive("live:signal", signal("v=0\r\nm=video 9\r\n"));
  assert.equal(screen.messages.filter(([event]) => event === "live:signal").length, 0);
  speaker.receive("live:signal", signal("v=0\r\nm=video 9\r\n"));
  assert.equal(screen.messages.filter(([event]) => event === "live:signal").length, 1);
  assert.equal(stage.messages.length, 0);

  screen.receive("live:ready", id);
  assert.equal(broadcasts.at(-1)[1].phase, "live");
  otherSpeaker.receive("live:camera-switch", { id, switching: true });
  speaker.receive("live:camera-switch", { id: "stale", switching: true });
  speaker.receive("live:camera-switch", { id, switching: true });
  speaker.receive("live:camera-switch", { id, switching: false });
  assert.deepEqual(screen.messages.filter(([event]) => event === "live:camera-switch"), [
    ["live:camera-switch", { id, switching: true }],
    ["live:camera-switch", { id, switching: false }]
  ]);
  assert.equal(stage.messages.length, 0);
  await stage.receive("live:stop", { id });
  assert.deepEqual(broadcasts.at(-1)[1], { phase: "idle", id: null, screenReady: true, reason: "stage" });

  for (const elapsed of [30_000, 60_000, 31_000]) {
    t.mock.timers.tick(elapsed);
    assert.deepEqual(await start(speaker), { ok: true });
    const newId = broadcasts.at(-1)[1].id;
    screen.receive("live:ready", newId);
    assert.equal(broadcasts.at(-1)[1].phase, "live");
    await speaker.receive("live:stop", { id: newId });
    assert.equal(broadcasts.at(-1)[1].reason, "stopped");
  }

  assert.deepEqual(await start(speaker), { ok: true });
  const disconnectedId = broadcasts.at(-1)[1].id;
  speaker.receive("live:connected", disconnectedId);
  screen.receive("live:connected", "stale-id");
  await waitForStartTimeout();
  assert.equal(broadcasts.at(-1)[1].reason, "network");

  assert.deepEqual(await start(speaker), { ok: true });
  screen.receive("live:connected", broadcasts.at(-1)[1].id);
  await waitForStartTimeout();
  assert.equal(broadcasts.at(-1)[1].reason, "video");

  revoked.add("speaker");
  assert.deepEqual(await start(speaker), { ok: false, reason: "speaker-access" });
  revoked.delete("speaker");
  revoked.add("screen");
  assert.deepEqual(await start(speaker), { ok: false, reason: "screen-access" });
  revoked.delete("screen");
  serviceUnavailable = true;
  assert.deepEqual(await start(speaker), { ok: false, reason: "service" });
  serviceUnavailable = false;

  assert.deepEqual(await start(speaker), { ok: true });
  screen.receive("live:ready", broadcasts.at(-1)[1].id);
  live = null;
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.equal(broadcasts.at(-1)[1].reason, "event");
});
