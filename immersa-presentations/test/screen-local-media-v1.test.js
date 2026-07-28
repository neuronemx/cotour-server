const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const bridge = require('../public/shared/video-deck-config-bridge.js');
const localMedia = require('../public/screen/screen-local-media.js');
const handleStore = require('../public/screen/screen-local-media-persistence-fix.js');
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

test('YouTube videos do not enter Screen local-file preparation', () => {
  const config = {
    hidden_slide_ids: [],
    videos: [
      { slide_id: 'local', source: { type: 'local' }, file: { name: 'local.mp4' } },
      { slide_id: 'youtube', source: { type: 'youtube', video_id: 'M7lc1UVf-VE' } }
    ]
  };
  assert.deepEqual(localMedia.activeVideos(config).map((video) => video.slide_id), ['local']);
  assert.deepEqual(bridge.activeLocalVideoConfigs(config).map((video) => video.slide_id), ['local']);
});

test('YouTube configuration augments the slide with a normalized remote provider', () => {
  const augmented = bridge.augmentManifest({
    slides: [{ id: 'demo', src: 'slides/slide-001.jpg' }]
  }, {
    videos: [{
      slide_id: 'demo',
      source: {
        type: 'youtube',
        video_id: 'M7lc1UVf-VE',
        url: 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=62s',
        start_seconds: 62
      },
      playback: { autoplay: true, end_behavior: 'next' }
    }]
  });
  assert.equal(augmented.slides[0].videoProvider, 'youtube');
  assert.equal(augmented.slides[0].youtubeVideoId, 'M7lc1UVf-VE');
  assert.equal(augmented.slides[0].youtubeStartSeconds, 62);
  assert.equal(augmented.slides[0].localOnly, false);
  assert.equal(augmented.slides[0].src, 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=62s');
});

test('Screen matches official files but accepts a local replacement', () => {
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
  assert.equal(localMedia.sameFile({ name: 'Demo.mp4', size: 20 }, { name: 'demo.mp4', size: 20 }), true);
  assert.equal(localMedia.sameFile({ name: 'new-version.mp4', size: 20 }, expected[0].file), false);
  assert.equal(localMedia.escapeHtml('<clip>.mp4'), '&lt;clip&gt;.mp4');
  assert.equal(localMedia.summarize([{ status: 'ready_override' }]).ready, 1);
});

test('persistent media keys remain stable per deck and slide', () => {
  assert.equal(handleStore.bindingKey('sales', 'demo'), 'sales::demo');
  assert.equal(handleStore.sameFileMetadata(
    { name: 'Demo.mp4', size: 200 },
    { name: 'demo.mp4', size: 200 }
  ), true);
  assert.deepEqual(handleStore.fileMetadata({ name: 'v2.mp4', size: 400, type: 'video/mp4', lastModified: 9 }), {
    name: 'v2.mp4',
    size: 400,
    type: 'video/mp4',
    last_modified: 9
  });
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

test('Screen playback state is forwarded only to Speaker and Stage', () => {
  const emitted = [];
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        }
      };
    }
  };
  const handlers = {};
  const socket = {
    on(event, handler) {
      handlers[event] = handler;
    },
    emit(event, payload) {
      emitted.push({ room: 'socket', event, payload });
    }
  };
  const context = { roomKey: 'room', sessionId: 's1', deckId: 'd1', role: 'screen' };
  const media = mediaSockets.createMediaSocketHandlers({
    io,
    getRoleRoomKey: (room, role) => room + ':' + role
  });
  media.attach(socket, () => context);
  handlers['media:playback_update']({
    slide_index: 4,
    provider: 'youtube',
    forced_muted: true
  });

  assert.deepEqual(
    emitted.filter(({ event }) => event === 'media:playback').map(({ room }) => room),
    ['room:presenter', 'room:stage']
  );
  assert.equal(emitted[0].payload.slide_index, 4);
  assert.equal(emitted[0].payload.forced_muted, true);

  emitted.length = 0;
  context.role = 'audience';
  handlers['media:playback_update']({
    slide_index: 4,
    provider: 'youtube',
    forced_muted: false
  });
  assert.equal(emitted.length, 0);

  media.sendCurrentState(socket, { ...context, role: 'presenter' });
  assert.equal(emitted[0].event, 'media:playback');
  assert.equal(emitted[0].payload.forced_muted, true);
});

test('Screen loads persistent local multimedia preparation and simplified replacement controls', () => {
  const screen = read('public/screen/index.html');
  const audience = read('public/audience/index.html');
  const loader = read('public/shared/slide-confirm.js');
  const runtime = read('public/shared/video-slide-runtime.js');
  const bridgeSource = read('public/shared/video-deck-config-bridge.js');
  const localSource = read('public/screen/screen-local-media.js');
  const storeSource = read('public/screen/screen-local-media-persistence-fix.js');
  const pickerAdapter = read('public/screen/screen-local-file-picker-adapter.js');
  const modalPolish = read('public/screen/screen-multimedia-modal-polish.js');
  const unlockHost = read('public/screen/screen-media-unlock-host.js');
  const socketSource = read('media-sockets.js');

  const adapterPosition = screen.indexOf('screen-local-file-picker-adapter.js?v=113');
  const storePosition = screen.indexOf('screen-local-media-persistence-fix.js?v=111');
  const managerPosition = screen.indexOf('screen-local-media.js?v=112');
  const polishPosition = screen.indexOf('screen-multimedia-modal-polish.js?v=113');
  assert.ok(adapterPosition >= 0);
  assert.ok(storePosition > adapterPosition);
  assert.ok(managerPosition > storePosition);
  assert.ok(polishPosition > managerPosition);
  assert.doesNotMatch(screen, /screen-local-media-handle-store\.js/);
  assert.match(screen, /Cache-Control/);
  assert.match(screen, /screen-media-unlock-host\.js\?v=107/);
  assert.doesNotMatch(screen, /screen-local-media-session-sync/);
  assert.match(screen, /video-deck-config-bridge\.js\?v=110/);
  assert.match(audience, /video-deck-config-bridge\.js\?v=110/);
  assert.match(loader, /video-deck-config-bridge\.js\?v=110/);
  assert.match(runtime, /ImmersaLocalMedia/);
  assert.match(runtime, /handleEnded/);
  assert.match(bridgeSource, /Multimedia lista/);
  assert.match(bridgeSource, /media:advance_request/);
  assert.match(localSource, /showOpenFilePicker/);
  assert.match(localSource, /Autorizar archivo/);
  assert.match(localSource, /Cambiar MP4/);
  assert.match(localSource, /ready_override/);
  assert.match(storeSource, /discoverOpfs/);
  assert.match(storeSource, /deckDirectory\.entries/);
  assert.match(storeSource, /requestPermission/);
  assert.doesNotMatch(pickerAdapter, /Persistencia/);
  assert.match(pickerAdapter, /v113/);
  assert.match(pickerAdapter, /__immersaTransientHandle/);
  assert.match(pickerAdapter, /showOpenFilePicker/);
  assert.match(modalPolish, /Archivo distinto al registrado en la presentación/);
  assert.match(modalPolish, /\[data-pick\]/);
  assert.match(modalPolish, /\[data-multi-input\]/);
  assert.match(unlockHost, /data-immersa-media-unlock/);
  assert.match(unlockHost, /fullscreenchange/);
  assert.match(socketSource, /media:status_update/);
  assert.match(socketSource, /media:advance_request/);
  assert.match(socketSource, /media:playback_update/);
  assert.match(socketSource, /media:playback/);
});
