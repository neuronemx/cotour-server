const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const videoSlides = require('../public/shared/video-slide-runtime.js');

test('video slide manifest entries are detected and normalized', () => {
  assert.equal(videoSlides.isVideoSlide({ type: 'video', src: 'slides/clip.bin' }), true);
  assert.equal(videoSlides.isVideoSlide({ src: 'slides/slide-007.mp4' }), true);
  assert.equal(videoSlides.isVideoSlide({ src: 'slides/slide-007.jpg' }), false);
  assert.equal(videoSlides.isYouTubeSlide({ videoProvider: 'youtube', youtubeVideoId: 'M7lc1UVf-VE' }), true);
  assert.equal(videoSlides.isYouTubeSlide({ videoProvider: 'youtube', youtubeVideoId: 'invalid' }), false);
  assert.equal(videoSlides.posterPath({ poster: 'poster.jpg', thumb: 'thumb.jpg' }), 'poster.jpg');
  assert.equal(videoSlides.posterPath({ thumb: 'thumb.jpg' }), 'thumb.jpg');
  assert.equal(videoSlides.assetUrl('sales-deck', 'slides/slide-007.mp4'), '/decks/sales-deck/slides/slide-007.mp4');
  assert.equal(videoSlides.assetUrl('sales-deck', 'blob:local-video'), 'blob:local-video');
});

test('video media state follows the active role slide index', () => {
  const item = { type: 'video', autoplay: true, muted: false };
  const state = {
    presenterSlideIndex: 6,
    liveSlideIndex: 5,
    overlays: { videoMedia: { slideIndex: 6, playing: false, muted: true, command: 'pause', revision: 9 } }
  };
  assert.equal(videoSlides.currentIndex('presenter', state), 6);
  assert.equal(videoSlides.currentIndex('stage', state), 6);
  assert.equal(videoSlides.currentIndex('screen', state), 5);
  assert.equal(videoSlides.currentIndex('audience', state), 5);
  assert.deepEqual(videoSlides.effectiveMediaState(state, item, 6), {
    slideIndex: 6,
    playing: false,
    muted: true,
    command: 'pause',
    revision: 9
  });
  const forcedPlayback = { slide_index: 6, forced_muted: true };
  assert.equal(videoSlides.mediaControlMuted({ muted: false }, forcedPlayback, 6), true);
  assert.deepEqual(videoSlides.muteControlPatch({ muted: false }, forcedPlayback, 6), {
    command: 'unmute',
    muted: false
  });
  assert.deepEqual(videoSlides.muteControlPatch({ muted: false }, null, 6), {
    command: 'mute',
    muted: true
  });
});

test('all roles load the configured video bridge and shared runtime', () => {
  const screen = read('public/screen/index.html');
  const audience = read('public/audience/index.html');
  const sharedLoader = read('public/shared/slide-confirm.js');
  const runtime = read('public/shared/video-slide-runtime.js');
  const bridge = read('public/shared/video-deck-config-bridge.js');
  const css = read('public/shared/video-slide-runtime.css');

  assert.match(screen, /video-deck-config-bridge\.js\?v=111/);
  assert.match(audience, /video-deck-config-bridge\.js\?v=111/);
  assert.match(sharedLoader, /video-deck-config-bridge\.js\?v=111/);
  assert.match(sharedLoader, /readyState==='complete'/);
  assert.match(bridge, /video-slide-runtime\.js\?v=111/);
  assert.match(runtime, /videoMedia/);
  assert.match(runtime, /overlay_update/);
  assert.match(runtime, /Activar sonido/);
  assert.doesNotMatch(runtime, /Activar sonido y multimedia/);
  assert.match(runtime, /data-immersa-media-unlock/);
  assert.match(runtime, /media:playback_update/);
  assert.match(runtime, /media:playback/);
  assert.match(runtime, /playYouTubeWithAutoplayFallback/);
  assert.match(runtime, /ImmersaLocalMedia/);
  assert.match(runtime, /role === 'screen'/);
  assert.match(runtime, /youtube\.com\/iframe_api/);
  assert.match(runtime, /cueVideoById/);
  assert.match(runtime, /playVideo/);
  assert.match(runtime, /pauseVideo/);
  assert.match(runtime, /seekTo/);
  assert.match(css, /\.immersa-video-slide/);
  assert.match(css, /\.immersa-youtube-slide/);
  assert.match(css, /\.video-media-controls/);
  assert.match(css, /\.immersa-media-unlock/);
});
