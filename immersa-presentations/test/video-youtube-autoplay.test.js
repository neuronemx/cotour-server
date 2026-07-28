const test = require('node:test');
const assert = require('node:assert/strict');

const videoSlides = require('../public/shared/video-slide-runtime.js');

function createNode(tagName = 'div') {
  const listeners = new Map();
  return {
    tagName: String(tagName).toUpperCase(),
    dataset: {},
    style: {},
    hidden: false,
    children: [],
    isConnected: false,
    appendChild(child) {
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
      return child;
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    remove() {
      this.isConnected = false;
      this.parentElement = null;
    },
    setAttribute() {},
    removeAttribute() {},
    dispatch(name) {
      return listeners.get(name)?.({ target: this });
    }
  };
}

function createHarness({ autoplay = true, sharedUnlock = null } = {}) {
  const slide = createNode('img');
  const screen = createNode('main');
  const head = createNode('head');
  const body = createNode('body');
  const documentElement = createNode('html');
  documentElement.contains = (node) => Boolean(node?.isConnected);
  const createdUnlocks = [];
  const document = {
    head,
    body,
    documentElement,
    getElementById(id) {
      if (id === 'screen') return screen;
      if (id === 'slide') return slide;
      return null;
    },
    querySelector(selector) {
      if (selector.includes('data-immersa-media-unlock')) return sharedUnlock?.isConnected ? sharedUnlock : null;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      const node = createNode(tagName);
      if (tagName === 'button') createdUnlocks.push(node);
      return node;
    }
  };
  body.appendChild = (node) => {
    node.parentElement = body;
    node.isConnected = true;
    body.children.push(node);
    return node;
  };

  const handlers = {};
  const socket = {
    on(name, listener) {
      handlers[name] = listener;
    },
    emit() {}
  };
  const manifest = {
    slides: [{
      id: 'youtube',
      slide_id: 'youtube',
      type: 'video',
      src: 'https://www.youtube.com/watch?v=M7lc1UVf-VE',
      poster: 'slides/slide-001.jpg',
      autoplay,
      muted: false,
      videoProvider: 'youtube',
      youtubeVideoId: 'M7lc1UVf-VE',
      youtubeStartSeconds: 0
    }]
  };
  const fetch = async () => ({
    ok: true,
    json: async () => manifest
  });
  return {
    document,
    socket,
    fetch,
    handlers,
    createdUnlocks,
    location: {
      pathname: '/screen',
      search: '?session=demo&deck=demo',
      origin: 'https://show.immersa.mx'
    }
  };
}

test('YouTube autoplay falls back to muted playback and reuses the existing media unlock', async (t) => {
  const sharedUnlock = createNode('button');
  sharedUnlock.dataset.immersaMediaUnlock = '1';
  sharedUnlock.isConnected = true;
  const harness = createHarness({ autoplay: true, sharedUnlock });
  const calls = [];
  const previousYT = globalThis.YT;
  globalThis.YT = {
    PlayerState: { PLAYING: 1, BUFFERING: 3, ENDED: 0 },
    Player: function (_target, options) {
      const player = {
        cueVideoById: () => calls.push('cue'),
        seekTo: () => calls.push('seek'),
        unMute: () => calls.push('unmute'),
        mute: () => calls.push('mute'),
        playVideo: () => calls.push('play'),
        pauseVideo: () => calls.push('pause'),
        getPlayerState: () => -1
      };
      queueMicrotask(() => options.events.onReady({ target: player }));
      return player;
    }
  };
  t.after(() => {
    if (previousYT === undefined) delete globalThis.YT;
    else globalThis.YT = previousYT;
  });

  const runtime = videoSlides.createRuntime(harness);
  await new Promise((resolve) => setImmediate(resolve));
  runtime.render({ liveSlideIndex: 0, overlays: {} });
  await new Promise((resolve) => setTimeout(resolve, 760));

  assert.ok(calls.includes('unmute'), 'first attempts the configured sound state');
  assert.ok(calls.includes('mute'), 'blocked autoplay retries muted');
  assert.ok(calls.filter((call) => call === 'play').length >= 2, 'play is retried automatically');
  assert.equal(harness.createdUnlocks.length, 0, 'no duplicate unlock button is created');
  assert.equal(sharedUnlock.dataset.videoMediaUnlockBound, '1', 'YouTube binds to the shared unlock');
});

test('manual YouTube playback still waits for Play', async (t) => {
  const harness = createHarness({ autoplay: false });
  const calls = [];
  const previousYT = globalThis.YT;
  globalThis.YT = {
    PlayerState: { PLAYING: 1, BUFFERING: 3, ENDED: 0 },
    Player: function (_target, options) {
      const player = {
        cueVideoById: () => calls.push('cue'),
        seekTo: () => calls.push('seek'),
        unMute: () => calls.push('unmute'),
        mute: () => calls.push('mute'),
        playVideo: () => calls.push('play'),
        pauseVideo: () => calls.push('pause'),
        getPlayerState: () => -1
      };
      queueMicrotask(() => options.events.onReady({ target: player }));
      return player;
    }
  };
  t.after(() => {
    if (previousYT === undefined) delete globalThis.YT;
    else globalThis.YT = previousYT;
  });

  const runtime = videoSlides.createRuntime(harness);
  await new Promise((resolve) => setImmediate(resolve));
  runtime.render({ liveSlideIndex: 0, overlays: {} });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.includes('play'), false);
  assert.ok(calls.includes('pause'));
});
