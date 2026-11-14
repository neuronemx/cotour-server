const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

function mount() {
  const created = [], handlers = new Map(), sent = [];
  function element(tag = "div") {
    const children = new Map();
    const node = { tag, hidden: false, attributes: {}, children: [], classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector(selector) { if (!children.has(selector)) children.set(selector, element(selector)); return children.get(selector); },
      append(...nodes) { this.children.push(...nodes); },
      before(node) { this.insertedBefore = node; },
      addEventListener() {}
    };
    created.push(node);
    return node;
  }
  const toolbar = element();
  const body = element(); body.dataset = {};
  const socket = { connected: true, on: (name, fn) => handlers.set(name, fn), emit: (...args) => sent.push(args),
    timeout() { return this; }, async emitWithAck(...args) { sent.push(args); return { ok: true }; } };
  const window = { IMMERSA_ROLE_OPEN: { role: "stage", access_token: "a_stage00001" }, addEventListener() {} };
  const instrumented = client.replace("  render();\n})();", `  window.audioTest = { peers, updateReturn, setProduction(stream) { productionAudio = stream; }, setTaking(value) { taking = value; } };\n  render();\n})();`);
  runInNewContext(instrumented, {
    window,
    document: { body, createElement: element, querySelector: () => toolbar }, io: () => socket
  });
  return { created, toolbar, handlers, sent, audio: window.audioTest };
}

test("Stage uses a nonmodal folding panel, retains its video and keeps live actions accessible", async () => {
  const { created, toolbar, handlers, sent } = mount();
  const panel = created.find(node => node.tag === "aside");
  const compact = created.find(node => node.className === "guest-stage-compact");
  const open = toolbar.children[0];
  assert.ok(panel);
  assert.equal(created.some(node => node.tag === "dialog"), false);
  assert.equal(panel.hidden, true);
  open.onclick();
  assert.equal(panel.hidden, false);
  const video = panel.querySelector("video");
  const stream = {}; video.srcObject = stream;
  handlers.get("guest:state")({ phase: "live", guestName: "Arquitecto", id: undefined });
  assert.equal(panel.hidden, true);
  assert.equal(video.srcObject, stream);
  assert.equal(compact.querySelector("[data-status]").textContent, "Arquitecto · LIVE");
  compact.querySelector("[data-wait]").onclick();
  await flush();
  assert.ok(sent.some(([event]) => event === "guest:wait"));
  compact.querySelector("[data-mute]").onclick();
  assert.ok(sent.some(([event]) => event === "guest:mute"));
  compact.querySelector("[data-expand]").onclick();
  assert.equal(panel.hidden, false);
  assert.equal(video.srcObject, stream);
  panel.querySelector("[data-close]").onclick();
  assert.equal(panel.hidden, true);
  assert.equal(video.srcObject, stream);
  assert.equal(sent.some(([event]) => event === "guest:end"), false);
});


test("event return starts on take, follows preparation/countdown and restores private audio on waiting", async () => {
  const { audio, handlers } = mount();
  const production = { id: "private" };
  const event = { id: "event" };
  const sender = { track: null, async replaceTrack(track) { this.track = track; } };
  audio.peers.set("monitor", { sender });
  audio.setProduction({ getAudioTracks: () => [production] });
  handlers.get("guest:state")({ phase: "ready" });
  await flush();
  assert.equal(sender.track, production);
  audio.setTaking(true);
  await audio.updateReturn();
  assert.equal(sender.track, null);
  audio.peers.set("program", { remote: { getAudioTracks: () => [event] } });
  await audio.updateReturn();
  assert.equal(sender.track, event);
  for (const phase of ["starting", "countdown", "live"]) {
    handlers.get("guest:state")({ phase });
    await flush();
    assert.equal(sender.track, event, phase);
  }
  handlers.get("guest:state")({ phase: "ready" });
  await flush();
  assert.equal(sender.track, production);
  audio.setTaking(true);
  await audio.updateReturn();
  assert.equal(sender.track, event);
  audio.setTaking(false);
  await audio.updateReturn();
  assert.equal(sender.track, production);
});
