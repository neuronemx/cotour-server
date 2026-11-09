const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { readLiveCameraPilot, readLiveCameraDemo, readLiveCameraWorkDecks, liveCameraPageAssets, attachLiveCamera } = require("../live-camera");

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
  const rooms = new Map();
  const channel = {
    use(fn) { this.authorize = fn; },
    on(_event, fn) { this.connect = fn; },
    emit(event, payload) { broadcasts.push([event, payload]); },
    to(key) {
      return { emit: (event, payload) => {
        for (const socket of rooms.get(key) || []) socket.emit(event, payload);
      } };
    }
  };
  const namespace = { of: name => { assert.equal(name, namespaceName); return channel; } };
  async function open(role, accessToken = config.links[role], origin = config.origin) {
    const handlers = new Map();
    const socket = {
      handshake: { auth: { role, accessToken }, headers: { origin } }, data: {}, connected: true, messages: [],
      on: (event, handler) => handlers.set(event, handler),
      emit(event, payload) { this.messages.push([event, payload]); },
      receive: (event, payload) => handlers.get(event)(payload),
      join(key) {
        if (!rooms.has(key)) rooms.set(key, new Set());
        rooms.get(key).add(this);
        this.room = key;
      },
      disconnect() {
        if (!this.connected) return;
        this.connected = false;
        rooms.get(this.room)?.delete(this);
        handlers.get("disconnect")?.();
      }
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

test("ordinary Beta Decks get LIVE automatically and use separate camera rooms", async t => {
  const beta = {
    RAILWAY_ENVIRONMENT_ID: "9ae7d5ba-2954-4c96-818a-ee918310e20d",
    RAILWAY_ENVIRONMENT_NAME: "beta",
    RAILWAY_SERVICE_NAME: "immersa-presentations"
  };
  const workDecks = readLiveCameraWorkDecks(beta);
  assert.equal(workDecks.origin, "https://beta.immersalive.com");
  assert.equal(readLiveCameraWorkDecks({ ...beta, RAILWAY_ENVIRONMENT_NAME: "production" }), null);
  assert.equal(readLiveCameraWorkDecks({ ...beta, RAILWAY_SERVICE_NAME: "cotour-server" }), null);
  assert.equal(readLiveCameraWorkDecks({ ...beta, IMMERSA_LIVE_CAMERA_ENABLED: "false" }), null);

  const access = new Map([
    ["a_speaker001", ["speaker", "deck-a"]],
    ["a_screen0001", ["screen", "deck-a"]],
    ["a_speaker002", ["speaker", "deck-b"]],
    ["a_screen0002", ["screen", "deck-b"]],
    ["a_speaker003", ["speaker", "immersa-demo-master"]],
    ["a_speaker004", ["speaker", "immersa-demo"]]
  ].map(([token, [role, deckId]]) => {
    const resolved = roleAccess(role, token);
    resolved.deck.deckId = deckId;
    return [token, resolved];
  }));
  const page = (token, query = {}) => ({ req: { query }, ...access.get(token) });
  assert.match(liveCameraPageAssets(workDecks, page("a_speaker001")), /live-camera-demo/);
  assert.match(liveCameraPageAssets(workDecks, page("a_screen0002")), /live-camera-demo/);
  assert.equal(liveCameraPageAssets(workDecks, page("a_speaker001", { deck: "deck-b" })), null);
  assert.equal(liveCameraPageAssets(workDecks, page("a_speaker001", { eventActivityId: "event-activity" })), null);
  assert.equal(liveCameraPageAssets(workDecks, page("a_speaker003")), null);
  assert.equal(liveCameraPageAssets(workDecks, page("a_speaker004")), null);

  const { namespace, open } = testChannel(t, "/live-camera-demo");
  let blockedDeck;
  attachLiveCamera(namespace, {
    pilot: workDecks,
    accessLinks: { resolveRoleLink: async (token, role) => {
      const resolved = access.get(token);
      return resolved?.accessLink.role === role ? resolved : null;
    } },
    canProject: (sessionId, deckId) => {
      assert.equal(sessionId, config.sessionId);
      return deckId !== blockedDeck;
    }
  });

  const connect = (role, token) => open(role, token, workDecks.origin);
  const start = socket => new Promise(resolve => socket.receive("live:start", resolve));
  const prepared = socket => socket.messages.find(([event]) => event === "live:prepare")?.[1].id;
  const phase = socket => socket.messages.filter(([event]) => event === "live:status").at(-1)?.[1].phase;
  assert.ok(await connect("speaker", "a_speaker003") instanceof Error);
  assert.ok(await connect("screen", "a_speaker001") instanceof Error);
  const speakerA = await connect("speaker", "a_speaker001");
  const speakerB = await connect("speaker", "a_speaker002");
  const screenA = await connect("screen", "a_screen0001");
  assert.deepEqual(await start(speakerB), { ok: false, reason: "busy" });
  const screenB = await connect("screen", "a_screen0002");

  assert.deepEqual(await start(speakerA), { ok: true });
  const idA = prepared(screenA);
  assert.equal(prepared(screenB), undefined);
  screenB.receive("live:ready", idA);
  assert.equal(phase(speakerA), "starting");
  screenA.receive("live:ready", idA);
  assert.equal(phase(speakerA), "live");
  assert.equal(phase(speakerB), "idle");

  blockedDeck = "deck-b";
  assert.deepEqual(await start(speakerB), { ok: false, reason: "production" });
  blockedDeck = undefined;
  assert.deepEqual(await start(speakerB), { ok: true });
  const idB = prepared(screenB);
  assert.notEqual(idA, idB);
  screenB.receive("live:ready", idB);
  await speakerA.receive("live:stop", { id: idA });
  assert.equal(phase(speakerA), "idle");
  assert.equal(phase(speakerB), "live");

  await speakerB.receive("live:stop", { id: idB });
  speakerA.disconnect();
  screenA.disconnect();
  assert.equal((await connect("screen", "a_screen0001")).connected, true);
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
