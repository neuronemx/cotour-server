const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

function mount(role = "stage", getUserMedia) {
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
  const track = { readyState: "live", stop() { this.readyState = "ended"; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const window = { IMMERSA_ROLE_OPEN: { role, access_token: "a_stage00001" }, AudioContext: class { async resume() {} }, addEventListener() {} };
  const instrumented = client.replace("  render();\n})();", `  window.audioTest = { peers, updateReturn, setProduction(stream) { productionAudio = stream; }, setTaking(value) { taking = value; } };\n  render();\n})();`);
  runInNewContext(instrumented, {
    window,
    document: { body, createElement: element, querySelector: () => toolbar }, io: () => socket,
    navigator: { mediaDevices: { async getUserMedia(options) { assert.equal(options.video, false); return getUserMedia ? getUserMedia(stream) : stream; } } }
  });
  return { created, toolbar, handlers, sent, audio: window.audioTest, track, socket };
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
  const production = { id: "private", enabled: true };
  const event = { id: "event" };
  const sender = { track: null, async replaceTrack(track) { this.track = track; } };
  audio.peers.set("monitor", { sender });
  audio.setProduction({ getAudioTracks: () => [production] });
  handlers.get("guest:state")({ phase: "ready" });
  await flush();
  assert.equal(sender.track, production);
  assert.equal(production.enabled, true);
  audio.setTaking(true);
  await audio.updateReturn();
  assert.equal(sender.track, null);
  assert.equal(production.enabled, false);
  audio.peers.set("program", { remote: { getAudioTracks: () => [event] } });
  await audio.updateReturn();
  assert.equal(sender.track, event);
  for (const phase of ["starting", "countdown", "live"]) {
    handlers.get("guest:state")({ phase });
    await flush();
    assert.equal(sender.track, event, phase);
    assert.equal(production.enabled, false, phase);
  }
  handlers.get("guest:state")({ phase: "ready" });
  await flush();
  assert.equal(sender.track, production);
  assert.equal(production.enabled, true);
  audio.setTaking(true);
  await audio.updateReturn();
  assert.equal(sender.track, event);
  audio.setTaking(false);
  await audio.updateReturn();
  assert.equal(sender.track, production);
});


test("Speaker voice appears only for a selected source and a guest in waiting, and stays accessible while live", async () => {
  const { toolbar, handlers, sent, track, socket } = mount("speaker");
  const button = toolbar.children[0];
  assert.equal(button.hidden, true);
  assert.equal(button.textContent, "Activar voz invitado");
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: false });
  assert.equal(button.hidden, true);
  handlers.get("guest:state")({ phase: "waiting", audioSource: "screen", guestConnected: true });
  assert.equal(button.hidden, true);
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true });
  assert.equal(button.hidden, false);
  await button.onclick();
  assert.equal(button.textContent, "Apagar voz invitado");
  assert.equal(button.attributes["aria-pressed"], "true");
  assert.ok(sent.some(([event]) => event === "guest:media-ready"));
  for (const phase of ["preparing", "ready", "starting", "countdown", "live"]) {
    handlers.get("guest:state")({ phase, audioSource: "speaker", guestConnected: true });
    assert.equal(button.hidden, false, phase);
    assert.equal(track.readyState, "live", phase);
  }
  socket.connected = false;
  handlers.get("disconnect")();
  assert.equal(button.disabled, false);
  await button.onclick();
  assert.equal(track.readyState, "ended");
  assert.equal(button.attributes["aria-pressed"], "false");
});

test("Speaker capture stops when its source is deselected or the guest leaves", async () => {
  for (const next of [{ audioSource: "screen", guestConnected: true }, { audioSource: "speaker", guestConnected: false }]) {
    const { toolbar, handlers, sent, track } = mount("speaker");
    const button = toolbar.children[0];
    handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true });
    await button.onclick();
    handlers.get("guest:state")({ phase: "waiting", ...next });
    assert.equal(button.hidden, true);
    assert.equal(track.readyState, "ended");
    assert.equal(sent.some(([event]) => event === "guest:failed"), false);
  }
});

test("sending to Screen silences private audio immediately despite delayed replacement and a repeated waiting state", async () => {
  const { audio, handlers, created, socket } = mount();
  const privateTrack = { id: "private", enabled: true };
  const eventTrack = { id: "event" };
  let release;
  const sender = { track: privateTrack, async replaceTrack(track) {
    if (track === null) await new Promise(resolve => { release = resolve; });
    this.track = track;
  } };
  const gain = { gain: { value: 1 } };
  audio.setProduction({ getAudioTracks: () => [privateTrack] });
  audio.peers.set("monitor", { sender, gain, channel: "monitor" });
  handlers.get("guest:state")({ phase: "ready" });
  await flush();
  socket.emitWithAck = async () => {
    handlers.get("guest:state")({ phase: "starting" });
    handlers.get("guest:state")({ phase: "countdown", countdown: 3 });
    return { ok: true };
  };
  const panel = created.find(node => node.tag === "aside");
  const sending = panel.querySelector("[data-take]").onclick();
  assert.equal(privateTrack.enabled, false);
  assert.equal(gain.gain.value, 0);
  await flush();
  handlers.get("guest:state")({ phase: "ready" });
  assert.equal(privateTrack.enabled, false);
  audio.peers.set("program", { remote: { getAudioTracks: () => [eventTrack] } });
  const updating = audio.updateReturn();
  release();
  await Promise.all([sending, updating]);
  await flush();
  assert.equal(sender.track, eventTrack);
  assert.equal(privateTrack.enabled, false);
  assert.equal(gain.gain.value, 0);
  handlers.get("guest:state")({ phase: "ready" });
  await flush();
  assert.equal(sender.track, privateTrack);
  assert.equal(privateTrack.enabled, true);
  assert.equal(gain.gain.value, 1);
});

test("a delayed microphone permission cannot start hidden Speaker capture after the source changed", async () => {
  let allow;
  const { toolbar, handlers, track, sent } = mount("speaker", stream => new Promise(resolve => { allow = () => resolve(stream); }));
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true });
  const button = toolbar.children[0];
  const entering = button.onclick();
  await flush();
  handlers.get("guest:state")({ phase: "waiting", audioSource: "screen", guestConnected: true });
  allow();
  await entering;
  assert.equal(track.readyState, "ended");
  assert.equal(button.hidden, true);
  assert.equal(sent.some(([event]) => event === "guest:media-ready"), false);
});
