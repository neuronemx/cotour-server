const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { setImmediate: flushStats } = require("node:timers/promises");
const { runInNewContext } = require("node:vm");

const client = readFileSync(resolve(__dirname, "../public/live-camera/pilot.js"), "utf8");

test("Pantalla can go live with decoded video when Chrome does not call the frame callback", async () => {
  const events = [];
  const handlers = new Map();
  let now = 0;
  let framesDecoded = 0;
  let tick;
  let peer;
  const video = {
    readyState: 0, videoWidth: 0, paused: true,
    requestVideoFrameCallback: () => 1,
    setAttribute() {}, addEventListener() {},
    async play() { this.paused = false; }
  };
  const sticker = {};
  let projecting = false;
  const program = {
    append(...children) { assert.deepEqual(children, [video, sticker]); },
    classList: { toggle: (name, visible) => { if (name === "is-live") projecting = visible; } }
  };
  const host = {
    querySelector: () => null, append() {},
    classList: { toggle() {} }, style: { removeProperty() {} }
  };
  const socket = {
    connected: true,
    on: (event, handler) => handlers.set(event, handler),
    emit: (...event) => events.push(event)
  };
  runInNewContext(client, {
    window: { IMMERSA_ROLE_OPEN: { role: "screen", access_token: "test" } },
    document: { querySelector: () => host, createElement: tag => ({ div: program, video, img: sticker })[tag] },
    io: () => socket,
    performance: { now: () => now },
    setInterval: callback => { tick = callback; },
    clearInterval() {},
    MediaStream: class {},
    RTCPeerConnection: class {
      constructor() { peer = this; }
      close() {}
    }
  });

  assert.equal(sticker.src, "/live-camera/live-sticker.png");
  assert.equal(projecting, false);
  handlers.get("live:prepare")({ id: "attempt", rtc: {}, duration: 3500 });
  peer.connectionState = "connected";
  peer.onconnectionstatechange();
  peer.ontrack({
    track: { kind: "video" },
    receiver: { getStats: async () => new Map([["stream", { id: "stream", type: "inbound-rtp", framesDecoded }]]) }
  });
  video.readyState = 2;
  video.videoWidth = 1280;

  tick();
  await flushStats();
  assert.deepEqual(events, [["live:connected", "attempt"]]);

  framesDecoded = 1;
  now = 200;
  tick();
  await flushStats();
  assert.deepEqual(events.at(-1), ["live:ready", "attempt"]);
  assert.equal(projecting, false);
  handlers.get("live:status")({ id: "attempt", phase: "live" });
  assert.equal(projecting, true);

  now = 2400;
  tick();
  assert.equal(events.at(-1)[0], "live:stop");
  assert.equal(events.at(-1)[1].reason, "signal");
  assert.equal(projecting, false);
});
