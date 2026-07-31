const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../public/shared/stage-game-audio.js"),
  "utf8",
);

test("Stage renders one shared mute and volume control for Pong and Breakout", () => {
  const handlers = new Map();
  const emitted = [];
  const muteHandlers = {};
  const volumeHandlers = {};
  const mute = {
    innerHTML: "",
    setAttribute() {},
    addEventListener(name, handler) { muteHandlers[name] = handler; },
  };
  const volume = {
    value: "70",
    addEventListener(name, handler) { volumeHandlers[name] = handler; },
  };
  const controls = {
    className: "",
    innerHTML: "",
    querySelector(selector) {
      return selector.includes("mute") ? mute : volume;
    },
  };
  const host = {
    replaceChildren(child) { this.child = child; },
  };
  const document = {
    getElementById(id) { return id === "stageAudioControls" ? host : null; },
    createElement() { return controls; },
  };
  const socket = {
    on(name, handler) { handlers.set(name, handler); },
    emit(name, payload) { emitted.push({ name, payload }); },
  };
  const window = { location: { pathname: "/stage/demo" }, document, socket };

  vm.runInNewContext(source, { window, socket });

  assert.equal(host.child, controls);
  assert.equal((controls.innerHTML.match(/<button/g) || []).length, 1);
  assert.equal((controls.innerHTML.match(/<input/g) || []).length, 1);
  assert.doesNotMatch(controls.innerHTML, /select|Arcade|Paquete/);

  emitted.length = 0;
  muteHandlers.click();
  assert.deepEqual(
    emitted.map(({ name }) => name),
    ["breakout:audio:set", "pong:audio:set"],
  );
  assert.equal(emitted[0].payload.muted, true);

  emitted.length = 0;
  volume.value = "35";
  volumeHandlers.input();
  assert.deepEqual(
    emitted.map(({ name }) => name),
    ["breakout:audio:set", "pong:audio:set"],
  );
  assert.equal(emitted[0].payload.volume, 0.35);
  assert.equal(emitted[0].payload.muted, false);
});
