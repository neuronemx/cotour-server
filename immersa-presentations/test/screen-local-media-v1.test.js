const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const bridge = require('../public/shared/video-deck-config-bridge.js');
const localMedia = require('../public/screen/screen-local-media.js');
const mediaSockets = require('../media-sockets.js');

test('deck video configuration augments stable slides without replacing the poster', () => {
  const manifest = {
    slides: [
      { id: 'intro', src: 'slides/slide-001.jpg' },
      { id: 'demo', src: 'slides/slide-002.jpg' }
    ]
  };
  const config = {
    hidden_slide_ids: [],
    videos: [{
      slide_id: 'demo',
      file: { name: 'demo.mp4', size: 20 },
      playback: { autoplay: false, end_behavior: 'loop', muted: false }
    }]
  };
  const augmented = bridge.augmentManifest(manifest, config);
  assert.equal(augmented.slides[1].type, 'video');
  assert.equal(augmented.slides[1].poster, 'slides/slide-002.jpg');
  assert.equal(augmented.slides[1].src, '');
  assert.equal(augmented.slides[1].autoplay, false);
  assert.equal(augmented.slides[1].loop, true);
});

test('hidden videos are excluded from Screen preparation', () => {
  const config = {
    hidden_slide_ids: ['demo'],
    videos: [{ slide_id: 'demo' }, { slide_id: 'closing' }]
  };
  assert.deepEqual(localMedia.activeVideos(config).map((video) => video.slide_id), ['closing']);
});

test('Screen matches local files by name and exact size', () => {
  const expected = [
    { slide_id: 'demo', file: { name: 'Demo.mp4', size: 20 } },
    { slide_id: 'closing', file: { name: 'closing.mp4', size: 30 } }
  ];
  const records = localMedia.matchFiles(expected, [
    { name: 'demo.mp4', size: 20 },
    { name: 'closing.mp4', size: 31 }
  ]);
  assert.equal(records[0].status, 'selected');
  assert.equal(records[1].status, 'mismatched');
  assert.equal(localMedia.escapeHtml('<clip>.mp4'), '&lt;clip&gt;.mp4');
});

test('media status is normalized before broadcasting to control roles', () => {
  const status = mediaSockets.normalizeStatus({
    items: [
      { slide_id: 'demo', file_name: 'demo.mp4', status: 'ready' },
      { slide_id: 'closing', file_name: 'closing.mp4', status: 'missing' }
    ]
  }, { sessionId: 's1', deckId: 'd1' });
  assert.equal(status.total, 2);
  assert.equal(status.ready, 1);
  assert.equal(status.missing, 1);
});

test('Screen and control roles load local multimedia preparation', () => {
  const screen = read('public/screen/index.html');
  const audience = read('public/audience/index.html');
  const loader = read('public/shared/slide-confirm.js');
  const runtime = read('public/shared/video-slide-runtime.js');
  const bridgeSource = read('public/shared/video-deck-config-bridge.js');
  const unlockHost = read('public/screen/screen-media-unlock-host.js');
  const socketSource = read('media-sockets.js');

  assert.match(screen, /screen-local-media\.js\?v=107/);
  assert.match(screen, /screen-media-unlock-host\.js\?v=107/);
  assert.doesNotMatch(screen, /screen-local-media-session-sync/);
  assert.match(screen, /video-deck-config-bridge\.js\?v=107/);
  assert.match(audience, /video-deck-config-bridge\.js\?v=107/);
  assert.match(loader, /video-deck-config-bridge\.js\?v=107/);
  assert.match(runtime, /ImmersaLocalMedia/);
  assert.match(runtime, /handleEnded/);
  assert.match(bridgeSource, /Multimedia lista/);
  assert.match(bridgeSource, /media:advance_request/);
  assert.match(unlockHost, /data-immersa-media-unlock/);
  assert.match(unlockHost, /fullscreenchange/);
  assert.match(socketSource, /media:status_update/);
  assert.match(socketSource, /media:advance_request/);
});
