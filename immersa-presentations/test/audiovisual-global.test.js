const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createAudiovisualGlobalRuntime, AUDIO_REACT_ENABLED } = require("../audiovisual-global-runtime");
const { createAudiovisualFxRuntime } = require("../audiovisual-fx-runtime");
const { create } = require("../public/shared/audiovisual-fade");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
function harness() {
  const session = { audiovisualVolume: 1, audiovisual: { audio: { resource: null, status: "stopped", volume: 1 }, video: { resource: null, status: "stopped", volume: 1 } } };
  const tasks = [], publications = []; let id = 0;
  const runtime = createAudiovisualGlobalRuntime({ getChannels: (s) => s.audiovisual, publish: (ctx) => publications.push(ctx.roomKey), setTimer: (fn, ms) => tasks.push({ fn, ms }), now: () => 1000, createId: () => "fade-" + ++id });
  return { session, tasks, publications, runtime, context: { session, roomKey: "own-room" } };
}
test("Master volume works with no media and accepts mute without altering playback positions", () => {
  const h = harness();
  assert.equal(h.runtime.setVolume(h.context, .35), true);
  assert.equal(h.session.audiovisualVolume, .35);
  assert.equal(h.session.audiovisual.video.volume, .35);
  h.session.audiovisual.audio = { resource: { id: "music" }, status: "playing", position: 12, startedAt: 123, volume: .35 };
  h.runtime.setVolume(h.context, 0);
  assert.equal(h.session.audiovisual.audio.volume, 0);
  assert.equal(h.session.audiovisual.audio.position, 12);
  assert.equal(h.session.audiovisual.audio.startedAt, 123);
  for (const value of [NaN, Infinity, "0.5", undefined]) assert.equal(h.runtime.setVolume(h.context, value), false);
  assert.equal(h.session.audiovisualVolume, 0);
});
test("Global stop fades Audio and Video together, is idempotent, retains volume and cancels pending replacement", () => {
  const h = harness();
  h.session.audiovisual.audio = { resource: { id: "audio" }, status: "fading", volume: .4, lastAction: "fade-replace", pendingResource: { resource: { id: "pending" }, volume: 1 } };
  h.session.audiovisual.video = { resource: { id: "video" }, status: "playing", volume: .4 };
  h.runtime.stopAll(h.context);
  assert.equal(h.tasks.length, 1); assert.equal(h.tasks[0].ms, 1000);
  assert.equal(h.session.audiovisual.audio.pendingResource, null);
  assert.equal(h.session.audiovisual.video.status, "fading");
  const fadeId = h.session.audiovisual.video.fadeOut.id;
  h.runtime.stopAll(h.context); assert.equal(h.tasks.length, 1);
  h.runtime.setVolume(h.context, .6);
  assert.equal(h.session.audiovisual.video.fadeOut.id, fadeId);
  h.tasks[0].fn();
  for (const channel of Object.values(h.session.audiovisual)) { assert.equal(channel.status, "stopped"); assert.equal(channel.volume, .6); assert.equal(channel.position, 0); }
  assert.equal(h.runtime.stopAll(h.context), false);
});
test("An old global stop cannot stop a freshly selected clip with the same resource ID", () => {
  const h = harness(); h.session.audiovisual.video = { resource: { id: "same" }, status: "playing", volume: 1 };
  h.runtime.stopAll(h.context);
  h.session.audiovisual.video = { resource: { id: "same" }, status: "playing", volume: 1 };
  h.tasks[0].fn(); assert.equal(h.session.audiovisual.video.status, "playing");
});
test("Volume during legacy audio replacement preserves its timer action and updates the next clip", () => {
  const h = harness(); h.session.audiovisual.audio = { resource: { id: "old" }, status: "fading", lastAction: "fade-replace", pendingResource: { resource: { id: "new" }, volume: 1 } };
  h.runtime.setVolume(h.context, .2);
  assert.equal(h.session.audiovisual.audio.lastAction, "fade-replace"); assert.equal(h.session.audiovisual.audio.pendingResource.volume, .2);
});
test("Global stop cancels an FX marker even while navigation is awaiting deck I/O", async () => {
  const h = harness(); h.session.presenterSlideIndex = 0;
  h.session.audiovisual.video = { resource: { id: "local:fx", type: "video", category: "fx", source: "local", fx: { timecode: "03:15", fps: 30, seconds: 3.5 } }, status: "playing", volume: 1 };
  const fx = createAudiovisualFxRuntime({ getChannel: (s) => s.audiovisual.video, navigate: async (_ctx, _s, _next, when) => { h.runtime.stopAll(h.context); return when(); }, publish() {} });
  const channel = h.session.audiovisual.video; channel.fxPlayback = fx.begin(channel.resource, h.session);
  const payload = { resourceId: channel.resource.id, playbackId: channel.fxPlayback.id, mediaTime: 3.5 };
  assert.equal(await fx.advance({ ...h.context, role: "screen" }, payload), false);
  assert.equal(h.session.presenterSlideIndex, 0); assert.equal(h.session.audiovisual.video.fxPlayback.consumed, true);
});
test("Frame fade respects mute and volume changes, fades visible pictures and never reveals empty slots", () => {
  let time = 0, nextId = 0; const frames = new Map();
  const media = (visible) => ({ volume: 0, style: { opacity: "", removeProperty(key) { this[key] = ""; } }, classList: { contains: () => visible } });
  const visible = media(true), hidden = media(false);
  const state = { status: "fading", volume: 0, fadeOut: { id: "fade", durationMs: 1000 } };
  const fade = create({ getState: () => state, getMedia: () => [visible, hidden], video: true, now: () => time, requestFrame: (fn) => { frames.set(++nextId, fn); return nextId; }, cancelFrame: (id) => frames.delete(id) });
  function tick(t) { time = t; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); }
  fade.apply(); tick(250); assert.equal(visible.volume, 0); assert.equal(visible.style.opacity, "0.75"); assert.equal(hidden.style.opacity, "");
  state.volume = .8; fade.apply(); tick(500); assert.equal(visible.volume, .4); assert.equal(visible.style.opacity, "0.5");
  tick(1000); assert.equal(visible.volume, 0); assert.equal(visible.style.opacity, "0"); assert.equal(frames.size, 0);
  fade.cancel(); assert.equal(visible.style.opacity, "");
});
test("React stays disabled in the server even if an older controller asks to enable it", () => {
  assert.equal(AUDIO_REACT_ENABLED, false);
  const source = read("server.js"), start = source.indexOf('socket.on("audio-react:control"'), end = source.indexOf('socket.on("audiovisual:metadata"', start);
  let handler; const session = { audioReact: { enabled: true, reaction: 2 } };
  const ctx = { AUDIO_REACT_ENABLED, currentRoomKey: "own", currentRole: "presenter", canControlPresentation: () => true, getSessionByRoomKey: () => session, createAudioReactState: () => ({}), socket: { on: (_event, fn) => { handler = fn; } }, io: { to: () => ({ emit() {} }) }, emitState() {} };
  vm.runInNewContext(source.slice(start, end), ctx); handler({ enabled: true, reaction: 4 }); assert.equal(session.audioReact.enabled, false);
});
