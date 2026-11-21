const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');
const code = readFileSync(require('node:path').resolve(__dirname, '../public/live-guests/camera.js'), 'utf8');

function mount(source = 'speaker', options = {}) {
  const handlers = new Map(), nodes = [], sent = [], tracks = [], senders = [];
  let state = { phase: 'live', audioSource: source }, voice = false;
  function element() {
    const children = new Map();
    const node = { hidden: false, style: {}, classList: { remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, append() {}, showModal() {}, close() {}, async play() {},
      querySelector(key) { if (!children.has(key)) children.set(key, element()); return children.get(key); } };
    nodes.push(node); return node;
  }
  const button = element();
  const socket = { connected: true, on: (event, fn) => handlers.set(event, fn), emit: (...args) => sent.push(args), timeout() { return this; },
    async emitWithAck() {
      state.camera = { id: 'camera', ready: false };
      const prepare = () => { for (const target of ['screen', 'guest']) handlers.get('guest-camera:prepare')({ id: 'camera', target, offer: true, rtc: {}, duration: 8000 }); };
      if (options.delayedPrepare) setImmediate(prepare); else prepare();
      return { ok: true, id: 'camera' };
    }
  };
  const window = { addEventListener() {} };
  runInNewContext(code, { window, document: { createElement: element, body: { append() {} }, querySelector: () => null, getElementById: () => null },
    navigator: { mediaDevices: { async getUserMedia(options) {
      assert.equal(options.audio, false);
      const track = { readyState: 'live', stop() { this.readyState = 'ended'; } }; tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    } } },
    performance: { now: () => 0 }, setInterval: () => 1, clearInterval() {},
    RTCPeerConnection: class {
      constructor() { if (options.peerError) throw Object.assign(new Error(), { name: 'NotSupportedError' }); }
      close() {} addTransceiver(track) { const sender = { track, async replaceTrack(next) { this.track = next; } }; senders.push(sender); return { sender }; }
      async createOffer() { return {}; } async setLocalDescription() { this.localDescription = { toJSON: () => ({}) }; }
    }
  });
  const api = window.ImmersaGuestCamera.create({ role: 'speaker', socket, getState: () => state, button,
    async toggleVoice() { voice = !voice; }, voiceActive: () => voice });
  return { api, state, tracks, sent, senders, voice: () => voice, panel: nodes[1] };
}

test('Speaker adds video to both destinations, changes lens, and returns to audio without stopping the microphone', async () => {
  const app = mount();
  await app.panel.querySelector('[data-video]').onclick(); await flush(); await flush();
  assert.equal(app.voice(), true);
  assert.equal(app.senders.length, 2);
  assert.equal(app.senders[0].track, app.senders[1].track);
  await app.panel.querySelector('[data-lens]').onclick();
  assert.equal(app.tracks[0].readyState, 'ended');
  assert.equal(app.senders[0].track, app.tracks[1]);
  await app.panel.querySelector('[data-audio]').onclick();
  assert.equal(app.tracks[1].readyState, 'ended');
  assert.equal(app.voice(), true);
  assert.ok(app.sent.some(([event]) => event === 'guest-camera:stop'));
});

test('console audio mode never opens a second microphone and ended camera state releases capture', async () => {
  const app = mount('screen');
  await app.panel.querySelector('[data-video]').onclick(); await flush();
  assert.equal(app.voice(), false);
  app.state.phase = 'ended'; app.state.camera = null; app.api.render();
  assert.equal(app.tracks[0].readyState, 'ended');
});

for (const source of ['speaker', 'screen']) {
  test(`Speaker can remove and rejoin their camera with ${source} audio while Guest stays live`, async () => {
    const app = mount(source);
    const cameraOff = app.panel.querySelector('[data-camera-off]');
    app.api.render();
    assert.equal(cameraOff.hidden, true);
    await app.panel.querySelector('[data-video]').onclick(); await flush(); await flush();
    assert.equal(cameraOff.hidden, false);
    assert.equal(cameraOff.disabled, false);
    const voice = app.voice();
    cameraOff.onclick();
    assert.equal(app.tracks[0].readyState, 'ended');
    assert.equal(cameraOff.hidden, true);
    assert.equal(app.voice(), voice);
    assert.equal(app.state.phase, 'live');
    assert.ok(app.sent.some(([event]) => event === 'guest-camera:stop'));
    assert.equal(app.sent.some(([event]) => ['guest:end', 'guest:failed', 'guest:media-ready'].includes(event)), false);
    app.state.camera = null; app.api.render();
    await app.panel.querySelector('[data-video]').onclick(); await flush(); await flush();
    assert.equal(app.tracks[1].readyState, 'live');
    assert.equal(app.voice(), voice);
    assert.equal(app.state.phase, 'live');
  });
}

test('Solo audio can remove console-mode video without activating a microphone', async () => {
  const app = mount('screen');
  const audioOnly = app.panel.querySelector('[data-audio]');
  app.api.render();
  assert.equal(audioOnly.disabled, true);
  await app.panel.querySelector('[data-video]').onclick(); await flush();
  assert.equal(audioOnly.disabled, false);
  // Even if the voice source changes meanwhile, removing video must not enable a microphone.
  app.state.audioSource = 'speaker';
  await audioOnly.onclick(); await flush();
  assert.equal(app.tracks[0].readyState, 'ended');
  assert.equal(app.voice(), false);
  assert.equal(app.state.phase, 'live');
});

test('Stage, Screen and Guest can remain on air with no optional camera, including older snapshots without that field', () => {
  for (const role of ['stage', 'screen', 'guest']) {
    let state;
    const element = () => ({ hidden: true, style: {}, classList: { remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, append() {} });
    const host = element();
    const window = { addEventListener() {} };
    runInNewContext(code, { window, document: { createElement: element, body: { append() {} }, querySelector: () => host, getElementById: () => host }, clearInterval() {} });
    const camera = window.ImmersaGuestCamera.create({ role, socket: { connected: true, on() {} }, getState: () => state });
    for (const phase of ['waiting', 'preparing', 'ready', 'starting', 'countdown', 'live', 'ended']) {
      for (const value of [undefined, null, { id: 'pending-camera', ready: false }]) {
        state = { phase, ...(value === undefined ? {} : { camera: value }) };
        assert.doesNotThrow(() => camera.render(), role + ' ' + phase);
      }
    }
  }
});

test('a start acknowledgment arriving before preparation keeps the captured camera alive', async () => {
  const app = mount('speaker', { delayedPrepare: true });
  app.panel.querySelector('[data-video]').onclick();
  await flush(); await flush();
  assert.equal(app.tracks[0].readyState, 'live');
  assert.equal(app.senders.length, 2);
  assert.equal(app.sent.some(([event]) => event === 'guest-camera:stop'), false);
});

test('a failed browser peer reports its stage and error without stopping the microphone', async () => {
  const app = mount('speaker', { peerError: true });
  app.panel.querySelector('[data-video]').onclick();
  await flush(); await flush();
  assert.equal(app.tracks[0].readyState, 'ended');
  assert.equal(app.voice(), true);
  assert.match(app.panel.querySelector('[data-status]').textContent, /prepare:NotSupportedError/);
});

function mountReceiver({ alwaysAbort = false, deferred = false } = {}) {
  const handlers = new Map(), sent = [], timers = [];
  let connection, clock = 100, plays = 0, rejectPending;
  const host = { append() {}, classList: { remove() {}, toggle() {} } };
  const events = new Map(), classes = new Set();
  const tile = { style: {}, setAttribute() {}, append() {}, classList: { toggle(k,v) { if(v) classes.add(k); else classes.delete(k); }, remove(k) { classes.delete(k); } } };
  const video = { hidden: true, paused: true, readyState: 0, style: {}, setAttribute() {},
    addEventListener(name, fn) { events.set(name, fn); }, removeEventListener() {},
    play() {
      plays++;
      if (deferred) return new Promise((resolve, reject) => { rejectPending = reject; });
      if (alwaysAbort || plays === 1) return Promise.reject(Object.assign(new Error(), { name: 'AbortError' }));
      this.paused = false; this.readyState = 2; return Promise.resolve();
    }
  };
  const state = { phase: 'live', camera: { id: 'receiver-camera', ready: false } };
  const window = { addEventListener() {} };
  const socket = { connected: true, on: (name, handler) => handlers.set(name, handler), emit: (...args) => sent.push(args) };
  runInNewContext(code, { window, document: { createElement: tag => tag === 'video' ? video : tag === 'section' ? tile : { setAttribute() {} }, querySelector: () => host, getElementById: () => host },
    performance: { now: () => clock }, setInterval(fn) { timers.push(fn); return timers.length; }, clearInterval() {},
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } },
    RTCPeerConnection: class { constructor() { connection = this; } close() {} }
  });
  const api = window.ImmersaGuestCamera.create({ role: 'guest', socket, getState: () => state });
  handlers.get('guest-camera:prepare')({ id: 'receiver-camera', target: 'guest', offer: false, rtc: {}, duration: 30000 });
  const track = { kind: 'video' };
  connection.ontrack({ track, receiver: { async getStats() { return new Map([['video', { type: 'inbound-rtp', framesDecoded: video.paused ? 0 : 1 }]]); } } });
  return { api, sent, video, state, tile, classes, events, plays: () => plays, advance: async ms => { clock += ms; for (const timer of timers) await timer(); }, rejectPending: () => rejectPending(Object.assign(new Error(), { name: 'AbortError' })) };
}

test('Guest retries an interrupted play without cancelling camera, and still confirms decoded frames', async () => {
  const app = mountReceiver();
  await flush();
  assert.equal(app.sent.some(([event]) => event === 'guest-camera:stop'), false);
  await app.advance(300); await flush(); await app.advance(300);
  assert.ok(app.plays() >= 2);
  assert.ok(app.sent.some(([event]) => event === 'guest-camera:ready'));
  assert.equal(app.video.hidden, false);
  assert.equal(app.sent.some(([event]) => event === 'guest-camera:stop'), false);
});

test('repeated AbortError still times out when no frames arrive', async () => {
  const app = mountReceiver({ alwaysAbort: true });
  await flush();
  await app.advance(13000); await flush();
  assert.ok(app.sent.some(([event, payload]) => event === 'guest-camera:stop' && payload.reason === 'frames'));
});

test('an interrupted old play cannot cancel a camera that has already been stopped', async () => {
  const app = mountReceiver({ deferred: true });
  app.api.stop(false);
  app.rejectPending(); await flush();
  assert.equal(app.sent.some(([event]) => event === 'guest-camera:stop'), false);
});

test('received camera orientation follows live dimensions and clears on stop without replacing media', () => {
  const app = mountReceiver(), media = app.video.srcObject;
  for (const [width,height,wide] of [[360,640,false],[640,360,true],[360,640,false]]) {
    app.video.videoWidth=width; app.video.videoHeight=height;
    app.events.get('resize')();
    assert.equal(app.classes.has('is-landscape'),wide);
    assert.equal(app.tile.style.aspectRatio,width+' / '+height);
    assert.equal(app.video.srcObject,media);
    assert.equal(app.sent.some(([event])=>event==='guest-camera:stop'),false);
  }
  app.api.stop(false);
  assert.equal(app.classes.has('is-landscape'),false);
});
