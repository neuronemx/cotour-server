const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

function mount(role = "stage", getUserMedia, camera = false, guestCamera = false) {
  const listeners = new Map();
  const created = [], handlers = new Map(), sent = [];
  function element(tag = "div") {
    const children = new Map();
    const node = { tag, hidden: false, attributes: {}, children: [], classList: { values:new Set(), toggle(k,v) { if(v) this.values.add(k); else this.values.delete(k); }, remove(k) { this.values.delete(k); } },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector(selector) { if (!children.has(selector)) children.set(selector, element(selector)); return children.get(selector); },
      append(...nodes) { this.children.push(...nodes); },
      prepend(...nodes) { this.children.unshift(...nodes); },
      closest(selector) { return selector === ".stream-area" ? streamArea : shell; },
      querySelectorAll() { return []; },
      insertBefore(node) { node.parentElement = this; },
      before(node) { this.insertedBefore = node; },
      addEventListener() {}, showModal() {}, close() {}
    };
    created.push(node);
    return node;
  }
  const streamArea = element(), shell = element();
  const toolbar = element();
  const body = element(); body.dataset = {};
  const socket = { connected: true, on: (name, fn) => handlers.set(name, fn), emit: (...args) => sent.push(args),
    timeout() { return this; }, async emitWithAck(...args) { sent.push(args); return { ok: true }; } };
  const track = { readyState: "live", stop() { this.readyState = "ended"; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const window = { IMMERSA_ROLE_OPEN: { role, access_token: "a_stage00001" }, AudioContext: class { async resume() {} },
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(handler); },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); } };
  const instrumented = client.replace("  render();\n})();", `  window.audioTest = { peers, updateReturn, setProduction(stream) { productionAudio = stream; }, setTaking(value) { taking = value; } };\n  render();\n})();`);
  const environment = {
    window,
    document: { body, createElement: element, querySelector: () => toolbar, getElementById: () => null, addEventListener() {} }, io: () => socket,
    Event: class { constructor(type) { this.type = type; } },
    navigator: { mediaDevices: { async getUserMedia(options) { assert.equal(options.video, false); return getUserMedia ? getUserMedia(stream) : stream; } } }
  };
  if (camera) runInNewContext(readFileSync(resolve(__dirname, "../public/live-camera/pilot.js"), "utf8"), environment);
  if (guestCamera) runInNewContext(readFileSync(resolve(__dirname, "../public/live-guests/camera.js"), "utf8"), environment);
  runInNewContext(instrumented, environment);
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


test("Speaker can arm voice before a guest arrives and receives waiting and countdown cues", async () => {
  const { toolbar, handlers, sent, track, socket } = mount("speaker");
  const button = toolbar.children[0];
  assert.equal(button.hidden, true);
  assert.equal(button.textContent, "Activar voz invitado");
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: false });
  assert.equal(button.hidden, false);
  handlers.get("guest:state")({ phase: "waiting", audioSource: "screen", guestConnected: true, guestInWaitingRoom: true });
  assert.equal(button.hidden, false);
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
  assert.equal(button.hidden, false);
  await button.onclick();
  assert.equal(button.textContent, "Invitado en sala de espera");
  assert.equal(button.classList.values.has("guest-waiting-alert"), true);
  assert.equal(track.enabled, false);
  assert.equal(button.attributes["aria-pressed"], "true");
  assert.ok(sent.some(([event]) => event === "guest:media-ready"));
  for (const phase of ["preparing", "ready", "starting", "countdown", "live"]) {
    handlers.get("guest:state")({ phase, audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
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

test("Speaker capture stops only when its source is deselected", async () => {
  for (const next of [{ audioSource: "screen", guestConnected: true, guestInWaitingRoom: true }]) {
    const { toolbar, handlers, sent, track } = mount("speaker");
    const button = toolbar.children[0];
    handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
    await button.onclick();
    handlers.get("guest:state")({ phase: "waiting", ...next });
    assert.equal(button.hidden, false);
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
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
  const button = toolbar.children[0];
  const entering = button.onclick();
  await flush();
  handlers.get("guest:state")({ phase: "waiting", audioSource: "screen", guestConnected: true, guestInWaitingRoom: true });
  allow();
  await entering;
  assert.equal(track.readyState, "ended");
  assert.equal(button.hidden, false);
  assert.equal(sent.some(([event]) => event === "guest:media-ready"), false);
});

test("Speaker keeps one toolbar slot and retains armed voice after an invitation ends", async () => {
  const { toolbar, handlers, track } = mount("speaker", undefined, true);
  const camera = toolbar.children.find(node => node.className === "live-camera-toggle");
  const voice = toolbar.children.find(node => node.className === "guest-open guest-speaker-voice");
  assert.ok(camera);
  assert.equal(camera.hidden, false);
  assert.equal(voice.hidden, true);
  handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
  assert.equal(camera.hidden, true);
  assert.equal(voice.hidden, false);
  await voice.onclick();
  handlers.get("live:status")({ phase: "idle", screenReady: true });
  assert.equal(camera.hidden, true, "a camera status refresh must not reveal a second button");
  handlers.get("guest:state")({ phase: "live", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
  assert.equal(camera.hidden, true);
  assert.equal(voice.hidden, false);
  handlers.get("guest:state")({ phase: "ended", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
  assert.equal(voice.hidden, false);
  assert.equal(camera.hidden, true);
  assert.equal(track.readyState, "live");
  assert.equal(track.enabled, false);
  assert.equal(voice.textContent, "Voz preparada");
});

test("the real guest camera panel arms voice while Stage can prepare waiting independently", async () => {
  const speaker = mount("speaker", undefined, false, true);
  speaker.handlers.get("guest:state")({ phase: "waiting", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true });
  const panel = speaker.created.find(node => node.tag === "dialog");
  assert.ok(panel);
  panel.querySelector("[data-audio]").onclick();
  await flush(); await flush();
  assert.ok(speaker.sent.some(([event, value]) => event === "guest:media-ready" && value !== false));
  assert.equal(speaker.track.readyState, "live");
  const stage = mount("stage", undefined, false, true);
  const controls = stage.created.find(node => node.tag === "aside");
  const waiting = { phase: "waiting", audioSource: "speaker", guestConnected: true, guestInWaitingRoom: true, stageReady: true, screenReady: true };
  stage.handlers.get("guest:state")(waiting);
  assert.equal(controls.querySelector("[data-connect]").disabled, false);
  assert.match(controls.querySelector("[data-status]").textContent, /Falta activar voz/);
  stage.handlers.get("guest:state")({ ...waiting, speakerConnected: true });
  assert.equal(controls.querySelector("[data-connect]").disabled, false);
  assert.doesNotThrow(() => stage.handlers.get("guest:state")({ ...waiting, phase: "live", speakerConnected: true, camera: null }));
  assert.equal(controls.querySelector("[data-status]").textContent, "EN VIVO");
});

test("armed Speaker voice survives guest replacement, pulses only in waiting and opens at the entry cue", async () => {
  const { toolbar, handlers, track } = mount("speaker");
  const button=toolbar.children[0];
  handlers.get("guest:state")({ phase:"waiting", audioSource:"speaker", guestConnected:false });
  await button.onclick();
  assert.equal(track.enabled,false);
  for (const phase of ["waiting","ready","countdown","live","ended","waiting"]) {
    const connected=phase!=="ended";
    handlers.get("guest:state")({ phase, audioSource:"speaker", guestConnected:connected, guestInWaitingRoom:connected, countdown:3 });
    assert.equal(track.readyState,"live");
    assert.equal(track.enabled,["countdown","live"].includes(phase));
    assert.equal(button.classList.values.has("guest-waiting-alert"),connected&&["waiting","ready"].includes(phase));
    if(phase==="countdown") assert.equal(button.textContent,"EN VIVO en 3");
  }
});

test("the waiting alert requires explicit entry and clears on disconnect", () => {
  const { toolbar, handlers } = mount("speaker");
  const button=toolbar.children[0];
  for (const value of [undefined,false]) {
    handlers.get("guest:state")({ phase:"waiting",audioSource:"speaker",guestConnected:true,guestInWaitingRoom:value });
    assert.equal(button.classList.values.has("guest-waiting-alert"),false);
    assert.notEqual(button.textContent,"Invitado en sala de espera");
  }
  handlers.get("guest:state")({ phase:"waiting",audioSource:"speaker",guestConnected:true,guestInWaitingRoom:true });
  assert.equal(button.classList.values.has("guest-waiting-alert"),true);
  handlers.get("disconnect")();
  assert.equal(button.classList.values.has("guest-waiting-alert"),false);
});
