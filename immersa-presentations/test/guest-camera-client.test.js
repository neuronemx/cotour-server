const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const { setImmediate: flush } = require('node:timers/promises');
const code = readFileSync(require('node:path').resolve(__dirname, '../public/live-guests/camera.js'), 'utf8');

function mount(source = 'speaker') {
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
      for (const target of ['screen', 'guest']) handlers.get('guest-camera:prepare')({ id: 'camera', target, offer: true, rtc: {}, duration: 8000 });
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
