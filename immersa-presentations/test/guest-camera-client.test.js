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
    const node = { hidden: false, style: {}, classList: { remove() {}, toggle() {} }, setAttribute() {}, append() {}, showModal() {}, close() {}, async play() {},
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

test('Stage, Screen and Guest can remain on air with no optional camera, including older snapshots without that field', () => {
  for (const role of ['stage', 'screen', 'guest']) {
    let state;
    const element = () => ({ hidden: true, style: {}, classList: { remove() {}, toggle() {} }, setAttribute() {}, append() {} });
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
  const video = { hidden: true, paused: true, readyState: 0, style: {}, setAttribute() {},
    addEventListener() {}, removeEventListener() {},
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
  runInNewContext(code, { window, document: { createElement: () => video, querySelector: () => host, getElementById: () => host },
    performance: { now: () => clock }, setInterval(fn) { timers.push(fn); return timers.length; }, clearInterval() {},
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } },
    RTCPeerConnection: class { constructor() { connection = this; } close() {} }
  });
  const api = window.ImmersaGuestCamera.create({ role: 'guest', socket, getState: () => state });
  handlers.get('guest-camera:prepare')({ id: 'receiver-camera', target: 'guest', offer: false, rtc: {}, duration: 30000 });
  const track = { kind: 'video' };
  connection.ontrack({ track, receiver: { async getStats() { return new Map([['video', { type: 'inbound-rtp', framesDecoded: video.paused ? 0 : 1 }]]); } } });
  return { api, sent, video, state, plays: () => plays, advance: async ms => { clock += ms; for (const timer of timers) await timer(); }, rejectPending: () => rejectPending(Object.assign(new Error(), { name: 'AbortError' })) };
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
