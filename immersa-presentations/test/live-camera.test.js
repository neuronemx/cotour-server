const test = require("node:test");
const assert = require("node:assert/strict");
const { readLiveCameraPilot, liveCameraPageAssets, attachLiveCamera } = require("../live-camera");

const config = {
  origin: "https://beta.example.test", eventWorkspaceId: "event-a", activityId: "activity-a",
  deckId: "deck-a", sessionId: "room-a",
  links: { speaker: "a_speaker001", screen: "a_screen0001", stage: "a_stage00001" }
};

function configure(overrides = {}) {
  return readLiveCameraPilot({ IMMERSA_LIVE_CAMERA_PILOT: JSON.stringify({ ...config, ...overrides }) });
}

function roleAccess(role) {
  return {
    accessLink: { role, access_token: config.links[role], session_id: config.sessionId },
    deck: { deckId: config.deckId }
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

test("only authenticated participants in the configured live event can negotiate one video source", async t => {
  t.mock.timers.enable({ apis: ["Date"] });
  const broadcasts = [];
  const channel = {
    use(fn) { this.authorize = fn; },
    on(_event, fn) { this.connect = fn; },
    emit(event, payload) { broadcasts.push([event, payload]); }
  };
  const namespace = { of: name => { assert.equal(name, "/live-camera"); return channel; } };
  let live = null;
  let serviceUnavailable = false;
  const revoked = new Set();
  attachLiveCamera(namespace, {
    pilot: configure(),
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

  assert.ok(await open("screen", config.links.speaker) instanceof Error);
  assert.ok(await open("speaker", "a_individ001") instanceof Error);
  assert.ok(await open("speaker", config.links.speaker, "https://elsewhere.test") instanceof Error);
  assert.ok(await open("audience") instanceof Error);

  const screen = await open("screen");
  const speaker = await open("speaker");
  const otherSpeaker = await open("speaker");
  const stage = await open("stage");
  const start = socket => new Promise(resolve => socket.receive("live:start", resolve));
  assert.deepEqual(await start(speaker), { ok: false, reason: "event" });

  live = { id: "event-live-a", status: "LIVE", event_workspace_id: "event-a", event_activity_id: "activity-a", event_stage_id: "stage-a", deck_id: "deck-a" };
  const starting = start(speaker);
  assert.deepEqual(await start(otherSpeaker), { ok: false, reason: "busy" });
  assert.deepEqual(await starting, { ok: true });
  const id = screen.messages.find(([event]) => event === "live:prepare")[1].id;
  const signal = sdp => ({ id, description: { type: "offer", sdp } });
  speaker.receive("live:signal", signal("v=0\r\nm=video 9\r\nm=audio 9\r\n"));
  otherSpeaker.receive("live:signal", signal("v=0\r\nm=video 9\r\n"));
  assert.equal(screen.messages.filter(([event]) => event === "live:signal").length, 0);
  speaker.receive("live:signal", signal("v=0\r\nm=video 9\r\n"));
  assert.equal(screen.messages.filter(([event]) => event === "live:signal").length, 1);
  assert.equal(stage.messages.length, 0);

  screen.receive("live:ready", id);
  assert.equal(broadcasts.at(-1)[1].phase, "live");
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

  revoked.add("speaker");
  assert.deepEqual(await start(speaker), { ok: false, reason: "speaker-access" });
  revoked.delete("speaker");
  revoked.add("screen");
  assert.deepEqual(await start(speaker), { ok: false, reason: "screen-access" });
  revoked.delete("screen");
  serviceUnavailable = true;
  assert.deepEqual(await start(speaker), { ok: false, reason: "service" });
});
