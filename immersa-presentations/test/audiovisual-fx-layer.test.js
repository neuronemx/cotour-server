const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Fx = require("../public/shared/audiovisual-fx");

test("Audiovisual Video and FX retain their visible layer through playback/fade and release it on stop", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/screen/screen.js"), "utf8");
  const start = source.indexOf("function applyAudiovisualState("), end = source.indexOf("\nfunction clearImmersaTimeTick", start);
  const classes = new Set(), videoCalls = [];
  const context = vm.createContext({
    audiovisualState: {}, normalizeAudiovisualChannels: (n) => n,
    ensureAudiovisualLayer() {}, applyAudioState() {}, applyVideoState: (state) => videoCalls.push(state.status),
    emptyAudiovisualChannel: () => ({}), window: { ImmersaAudiovisualFx: Fx },
    audiovisualLayer: { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } },
    screenRoot: { classList: { toggle() {} } }
  });
  vm.runInContext(source.slice(start, end), context);
  const resource = { id: "local:video:fx", type: "video", source: "local", category: "fx", fx: Fx.parseCue("03:15\nFPS=30") };
  for (const status of ["playing", "fading"]) {
    context.applyAudiovisualState({ video: { resource, status } });
    assert.equal(classes.has("is-fx"), true);
  }
  context.applyAudiovisualState({ video: { resource, status: "stopped" } });
  assert.equal(classes.has("is-fx"), false);
  context.applyAudiovisualState({ video: { resource: { type: "video" }, status: "playing" } });
  assert.equal(classes.has("is-fx"), false);
  assert.equal(classes.has("is-video"), true);
  for (const status of ["paused", "fading", "stopped"]) {
    context.applyAudiovisualState({ video: { resource: { type: "video" }, status } });
    assert.equal(classes.has("is-video"), status !== "stopped");
    assert.equal(classes.has("is-fx"), false);
  }
  context.applyAudiovisualState({ audio: { resource: { type: "audio" }, status: "playing" } });
  assert.equal(classes.has("is-video"), false);
  assert.deepEqual(videoCalls, ["playing", "fading", "stopped", "playing", "paused", "fading", "stopped", undefined]);
});


test("Audiovisual Video and FX share foreground priority above linked slide video while Time stays above both", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/screen/screen.css"), "utf8");
  const linkedCss = fs.readFileSync(path.join(__dirname, "../public/shared/video-slide-runtime.css"), "utf8");
  const foreground = css.match(/\.audiovisual-screen-layer\.is-video,\s*\.audiovisual-screen-layer\.is-fx\s*\{([^}]+)\}/);
  assert.ok(foreground, "Video and FX must both receive the foreground rule");
  const z = Number(foreground[1].match(/z-index:\s*(\d+)/)[1]);
  const linkedZ = Number(linkedCss.match(/\.immersa-video-slide,\s*\.immersa-youtube-slide\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  const timeZ = Number(css.match(/\.time-overlay\s*\{[^}]*z-index:\s*(\d+)/)[1]);
  assert.ok(z > linkedZ, "Audiovisual must remain visible over linked slide video");
  assert.ok(timeZ > z, "Time must retain its priority");
  assert.match(foreground[1], /pointer-events:\s*none/);
});
