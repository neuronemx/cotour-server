const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/screen/screen.js'), 'utf8');
const helper = source.slice(source.indexOf('function isWebMAudiovisualResource('), source.indexOf('async function scanAndPublishLocalLibrary('));

test('WebM alpha detection uses original local files and ignores URL query extensions', () => {
  const context = vm.createContext({ localLibrary: { files: new Map([
    ['alpha', { name: 'Transición.WEBM', type: '' }],
    ['mime', { name: 'video', type: 'video/webm; codecs="vp9"' }],
    ['mp4', { name: 'video.mp4', type: 'video/mp4' }]
  ]) } });
  vm.runInContext(helper, context);
  for (const id of ['alpha', 'mime']) assert.equal(context.isWebMAudiovisualResource({ id, source: 'local' }), true);
  for (const id of ['mp4', 'missing']) assert.equal(context.isWebMAudiovisualResource({ id, source: 'local' }), false);
  assert.equal(context.isWebMAudiovisualResource({ media_url: 'https://media.example/overlay.WEBM?v=2#frame' }), true);
  assert.equal(context.isWebMAudiovisualResource({ media_url: 'https://media.example/video.mp4?v=overlay.webm' }), false);
  assert.equal(context.isWebMAudiovisualResource(null), false);
});

test('Local Audiovisual scanning includes WebM with empty MIME alongside MP4 and audio', async () => {
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('const localVideoExtensions'), source.indexOf('function localResourceId'))
    + source.slice(source.indexOf('async function collectLocalFiles('), source.indexOf('function clearLocalObjectUrls(')), context);
  const file = (name) => [name, { kind: 'file', async getFile() { return { name, type: '' }; } }];
  const directory = { async *entries() {
    yield file('clip.mp4'); yield file('music.mp3'); yield file('ignore.txt');
    yield ['Transiciones', { kind: 'directory', async *entries() { yield file('Overlay.WEBM'); } }];
  } };
  const result = await context.collectLocalFiles(directory);
  assert.deepEqual(Array.from(result, ({ type, relativePath, folder }) => ({ type, relativePath, folder })), [
    { type: 'video', relativePath: 'clip.mp4', folder: '' },
    { type: 'audio', relativePath: 'music.mp3', folder: '' },
    { type: 'video', relativePath: 'Transiciones/Overlay.WEBM', folder: 'Transiciones' }
  ]);
});

test('Beta playback preserves WebM alpha across pause and restores black when a slot is reused for MP4', () => {
  const makeMedia = () => {
    const classes = new Set(), listeners = new Map();
    return {
      dataset: {}, style: {}, currentTime: 0, paused: true,
      classList: { add: (v) => classes.add(v), remove: (v) => classes.delete(v), contains: (v) => classes.has(v),
        toggle: (v, enabled) => enabled ? classes.add(v) : classes.delete(v) },
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); },
      load() {}, removeAttribute() {},
      addEventListener(event, cb) { listeners.set(event, cb); },
      canplay() { const cb = listeners.get('canplay'); listeners.delete('canplay'); cb(); }
    };
  };
  const slots = [makeMedia(), makeMedia()];
  const context = vm.createContext({ audiovisualMedia: { video: slots }, activeVideoSlot: 0,
    videoTransitionToken: 0, audiovisualState: { video: {} }, audiovisualFxMonitors: new WeakMap(),
    localLibrary: { files: new Map([['alpha', { name: 'overlay.WEBM', type: '' }]]) },
    resolveAudiovisualMediaUrl: (r) => 'blob:' + r.id,
    clearVideoPlaylistAdvance() {}, scheduleVideoPlaylistAdvance() {}, window: { setTimeout() {}, ImmersaAudiovisualFx: require("../public/shared/audiovisual-fx") }, console
  });
  vm.runInContext(helper + source.slice(source.indexOf('function stopVideoSlots()'), source.indexOf('function applyAudioState(state)')), context);
  const apply = (id, status = 'playing') => {
    context.audiovisualState.video = { resource: { id, source: 'local' }, status, lastAction: 'play', position: 0 };
    context.applyVideoState(context.audiovisualState.video);
  };
  apply('alpha');
  assert.equal(slots[1].classList.contains('is-webm'), true);
  assert.equal(slots[1].classList.contains('is-visible'), false);
  slots[1].canplay();
  assert.equal(slots[1].classList.contains('is-visible'), true);
  apply('alpha', 'paused');
  assert.equal(slots[1].paused, true);
  assert.equal(slots[1].classList.contains('is-webm'), true);
  apply('alpha');
  assert.equal(slots[1].paused, false);
  apply('mp4-a'); slots[0].canplay();
  assert.equal(slots[1].classList.contains('is-visible'), false);
  apply('mp4-b');
  assert.equal(slots[1].classList.contains('is-webm'), false);
  slots[1].canplay();
  assert.equal(slots[1].classList.contains('is-visible'), true);
  apply('mp4-b', 'stopped');
  assert.ok(slots.every((media) => media.paused && !media.classList.contains('is-visible')));
});

test('Only WebM clears the video background and Screen loads fresh assets', () => {
  const css = fs.readFileSync(path.join(root, 'public/screen/screen.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/screen/index.html'), 'utf8');
  assert.match(css, /\.audiovisual-screen-layer \{[^}]*background:transparent/);
  assert.match(css, /\.audiovisual-video-slot \{[^}]*background:#000/);
  assert.match(css, /\.audiovisual-video-slot\.is-webm \{ background:transparent; \}/);
  assert.match(html, /screen\.css\?v=23/);
  assert.match(html, /screen\.js\?v=23/);
});
