const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Fx = require("../public/shared/audiovisual-fx");

test("FX retains its foreground layer through playback/fade and releases it on stop or ordinary video", () => {
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
  assert.deepEqual(videoCalls, ["playing", "fading", "stopped", "playing"]);
});
