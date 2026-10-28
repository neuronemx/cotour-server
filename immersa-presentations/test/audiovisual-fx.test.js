const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Fx = require("../public/shared/audiovisual-fx");
const { createAudiovisualFxRuntime } = require("../audiovisual-fx-runtime");
const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const resource = (id = "local:video:fx", timecode = "03:15", fps = 30) => ({
  id, type: "video", source: "local", category: "fx", fx: Fx.normalizeCue({ timecode, fps })
});

test("FX TXT uses seconds and frames at each clip's declared FPS, including rational rates", () => {
  assert.deepEqual(Fx.parseCue("03:15\nFPS=30"), { timecode: "03:15", fps: 30, seconds: 3.5 });
  assert.equal(Fx.parseCue("\uFEFF03:15\r\n fps = 60 \r\n").seconds, 3.25);
  assert.equal(Fx.parseCue("75:00\nFPS=25").seconds, 75);
  assert.equal(Fx.parseCue("03:15\nFPS=30000/1001").seconds, 3 + 15 / (30000 / 1001));
  for (const input of ["03:15", "03:30\nFPS=30", "03:15\nFPS=0", "03:15\nFPS=30000/0", "03:15\nFPS=241", "03:15\nFPS=30\nextra", "-1:15\nFPS=30", "03.15\nFPS=30", "86400:00\nFPS=30"]) assert.throws(() => Fx.parseCue(input), /TXT inválido/);
  assert.equal(Fx.normalizeCue({ timecode: "03:15", fps: 30, seconds: 999 }).seconds, 3.5);
});

function file(name, text = "", size = Buffer.byteLength(text)) {
  return [name, { kind: "file", async getFile() { return { name, size, lastModified: 1, async text() { return text; } }; } }];
}
function directory(name, children) {
  return { name, kind: "directory", async *entries() { yield* children; } };
}
test("Local scanner pairs same-name TXT only within FX folders and preserves ordinary media", async () => {
  const source = read("public/screen/screen.js");
  const c = vm.createContext({ window: { ImmersaAudiovisualFx: Fx } });
  vm.runInContext(source.slice(source.indexOf("const localVideoExtensions"), source.indexOf("function localResourceId"))
    + source.slice(source.indexOf("async function collectLocalFiles("), source.indexOf("function clearLocalObjectUrls(")), c);
  const handle = directory("Library", [file("ordinary.webm"), file("music.mp3"), ["FX", directory("FX", [
    file("Curtain.WEBM"), file("Curtain.TXT", "03:15\nFPS=30"),
    file("missing.webm"), file("broken.webm"), file("broken.txt", "03:99\nFPS=30"),
    file("ignore.mp4"), file("ignore.mp3"),
    ["nested", directory("nested", [file("other.webm"), file("other.txt", "00:15\nFPS=60")])]
  ])]]);
  const issues = [];
  const entries = await c.collectLocalFiles(handle, "", issues);
  assert.deepEqual(Array.from(entries, (entry) => [entry.relativePath, entry.fx?.seconds || null]), [
    ["ordinary.webm", null], ["music.mp3", null], ["FX/Curtain.WEBM", 3.5], ["FX/nested/other.webm", .25]
  ]);
  assert.equal(issues.length, 2);
  const selectedFxRoot = await c.collectLocalFiles(directory("fx", [file("root.webm"), file("root.txt", "01:00\nFPS=24")]));
  assert.equal(selectedFxRoot[0].fx.seconds, 1);
});

test("Server recomputes FX markers and rejects invalid/out-of-duration clips without creating playlists", () => {
  const source = read("server.js");
  const c = vm.createContext({ normalizeFxCue: Fx.normalizeCue });
  vm.runInContext(source.slice(source.indexOf("function normalizeLocalAudiovisualResources("), source.indexOf("function localPlaylistItems(")), c);
  const item = { ...resource(), name: "Curtain", duration: 6, fx: { ...resource().fx, seconds: 999 }, playlist: { id: "local-playlist:video:fake", name: "FX" } };
  const result = c.normalizeLocalAudiovisualResources({ resources: [item, { ...item, id: "local:bad", duration: 3 }, { ...item, id: "local:bad2", fx: null }, { id: "local:ordinary", type: "audio", name: "Music", duration: 20 }] });
  assert.equal(result.length, 2);
  assert.equal(result[0].fx.seconds, 3.5);
  assert.equal(result[0].playlist, null);
  assert.equal(result[1].category, undefined);
});

function monitorHarness(useFrames = true) {
  const events = new Map(), frames = new Map(), emitted = [];
  let nextFrame = 1, connected = true;
  const media = { dataset: { resourceId: "local:video:fx", fxPlaybackId: "play-1" }, currentTime: 0, paused: false, ended: false, seeking: false,
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); } };
  if (useFrames) {
    media.requestVideoFrameCallback = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
    media.cancelVideoFrameCallback = (id) => frames.delete(id);
  }
  const state = { resource: resource(), status: "playing", fxPlayback: { id: "play-1", consumed: false } };
  const monitor = Fx.createCueMonitor({ media, getPlayback: () => state, onCue: (payload) => { if (!connected) return false; emitted.push(payload); return true; } });
  return { media, state, monitor, emitted, frames,
    event(name) { for (const fn of events.get(name) || []) fn(); },
    frame(time) { const first = frames.entries().next().value; assert.ok(first); frames.delete(first[0]); first[1](0, { mediaTime: time }); },
    connected(value) { connected = value; } };
}
test("Decoded-frame marker advances once despite stalled clocks, duplicate events and reconnects", () => {
  const h = monitorHarness(); h.monitor.refresh();
  h.media.currentTime = 5; h.event("timeupdate");
  assert.equal(h.emitted.length, 0, "currentTime must not outrun a decoded frame");
  h.frame(3.49); assert.equal(h.emitted.length, 0);
  h.connected(false); h.frame(3.5); assert.equal(h.emitted.length, 0);
  h.connected(true); h.frame(3.6); h.monitor.observe(4); h.event("timeupdate");
  assert.equal(h.emitted.length, 1); assert.equal(h.emitted[0].playbackId, "play-1");
});
test("Paused, stopped, replaced and replayed FX cannot inherit an old frame or cue", () => {
  const h = monitorHarness(); h.monitor.refresh();
  h.state.status = "paused"; h.media.paused = true; h.monitor.refresh();
  assert.equal(h.frames.size, 0); h.monitor.observe(9); assert.equal(h.emitted.length, 0);
  h.state.status = "playing"; h.media.paused = false; h.monitor.refresh();
  const stale = h.frames.values().next().value;
  h.state.fxPlayback = { id: "play-2", consumed: false }; h.media.dataset.fxPlaybackId = "play-2"; h.monitor.refresh();
  stale(0, { mediaTime: 10 }); assert.equal(h.emitted.length, 0);
  h.frame(3.5); assert.equal(h.emitted.length, 1);
  h.state.status = "stopped"; h.monitor.refresh(); h.monitor.observe(10); assert.equal(h.emitted.length, 1);
});
test("Fallback uses playback time with pause protection and still fires only once", () => {
  const h = monitorHarness(false); h.media.currentTime = 4; h.media.paused = true; h.event("timeupdate");
  assert.equal(h.emitted.length, 0);
  h.media.paused = false; h.event("playing"); h.event("timeupdate"); h.event("ended");
  assert.equal(h.emitted.length, 1);
});

function runtimeHarness(navigate) {
  const publications = [], navigations = [];
  let count = 0;
  const runtime = createAudiovisualFxRuntime({ createId: () => "run-" + ++count, getChannel: (s) => s.audiovisual.video,
    navigate: async (ctx, session, nextIndex, when) => {
      if (navigate) await navigate(session);
      if (!when()) return false;
      session.presenterSlideIndex = Math.min(session.slideCount - 1, nextIndex);
      session.navigationRevision++;
      navigations.push(ctx.roomKey); return true;
    }, publish: (ctx) => publications.push(ctx.roomKey) });
  const session = { presenterSlideIndex: 0, navigationRevision: 0, slideCount: 4, transmissionPaused: false, audiovisual: { video: { resource: resource(), status: "playing" } } };
  session.audiovisual.video.fxPlayback = runtime.begin(session.audiovisual.video.resource, session);
  const context = { role: "screen", roomKey: "room-a", session };
  const cue = () => ({ resourceId: session.audiovisual.video.resource.id, playbackId: session.audiovisual.video.fxPlayback.id, mediaTime: 3.5 });
  return { runtime, session, context, cue, publications, navigations };
}
test("Two Screens advance one shared slide once; another room and ordinary videos are excluded", async () => {
  const h = runtimeHarness();
  assert.equal(await h.runtime.advance({ ...h.context, role: "audience" }, h.cue()), false);
  assert.equal(await h.runtime.advance(h.context, { ...h.cue(), mediaTime: 3.49 }), false);
  assert.equal(await h.runtime.advance(h.context, { ...h.cue(), playbackId: "other-room-run" }), false);
  const results = await Promise.all([h.runtime.advance(h.context, h.cue()), h.runtime.advance(h.context, h.cue())]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal(h.session.presenterSlideIndex, 1); assert.equal(h.navigations.length, 1);
  assert.equal(h.runtime.begin({ type: "video", source: "local" }, h.session), null);
});
test("Manual navigation, stop, replacement and pause during asynchronous deck refresh cancel the pending jump", async () => {
  for (const change of [
    (s) => { s.presenterSlideIndex = 2; s.navigationRevision++; },
    (s) => { s.navigationRevision += 2; },
    (s) => { s.audiovisual.video.status = "stopped"; s.audiovisual.video.lastAction = "stop"; },
    (s) => { s.audiovisual.video.fxPlayback = { id: "replacement", consumed: false }; },
    (s) => { s.transmissionPaused = true; }
  ]) {
    const h = runtimeHarness(change);
    assert.equal(await h.runtime.advance(h.context, h.cue()), false);
    assert.equal(h.navigations.length, 0);
  }
});
test("Natural end does not lose a reached marker; replay creates a fresh one-shot ID and last slide is clamped", async () => {
  const h = runtimeHarness((s) => { s.audiovisual.video.status = "stopped"; s.audiovisual.video.lastAction = "ended"; });
  assert.equal(await h.runtime.advance(h.context, h.cue()), true);
  const firstId = h.session.audiovisual.video.fxPlayback.id;
  h.session.presenterSlideIndex = 3; h.session.audiovisual.video.status = "playing";
  h.session.audiovisual.video.fxPlayback = h.runtime.begin(h.session.audiovisual.video.resource, h.session);
  assert.notEqual(h.session.audiovisual.video.fxPlayback.id, firstId);
  assert.equal(await h.runtime.advance(h.context, h.cue()), true);
  assert.equal(h.session.presenterSlideIndex, 3);
});

test("Beta serves the FX runtime before Screen and preserves the FX category alongside Audio and Video", () => {
  const html = read("public/screen/index.html"), presenter = read("public/presenter/presenter.js");
  assert.ok(html.indexOf('/shared/audiovisual-fx.js?v=1') < html.indexOf('/screen/screen.js?v=24'));
  assert.match(presenter, /\["audio", "video", "fx"\]/);
  assert.match(read("public/presenter/presenter.css"), /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
