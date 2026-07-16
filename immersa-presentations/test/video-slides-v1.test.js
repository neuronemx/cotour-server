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
  assert.equal(videoSlides.posterPath({ poster: 'poster.jpg', thumb: 'thumb.jpg' }), 'poster.jpg');
  assert.equal(videoSlides.posterPath({ thumb: 'thumb.jpg' }), 'thumb.jpg');
  assert.equal(videoSlides.assetUrl('sales-deck', 'slides/slide-007.mp4'), '/decks/sales-deck/slides/slide-007.mp4');
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
});

test('all roles load the shared video slide runtime', () => {
  const screen = read('public/screen/index.html');
  const audience = read('public/audience/index.html');
  const sharedLoader = read('public/shared/slide-confirm.js');
  const runtime = read('public/shared/video-slide-runtime.js');
  const css = read('public/shared/video-slide-runtime.css');

  assert.match(screen, /video-slide-runtime\.js\?v=103/);
  assert.match(audience, /video-slide-runtime\.js\?v=103/);
  assert.match(sharedLoader, /video-slide-runtime\.js\?v=103/);
  assert.match(sharedLoader, /readyState==='complete'/);
  assert.match(runtime, /videoMedia/);
  assert.match(runtime, /overlay_update/);
  assert.match(runtime, /Activar sonido y multimedia/);
  assert.match(runtime, /role === 'screen'/);
  assert.match(css, /\.immersa-video-slide/);
  assert.match(css, /\.video-media-controls/);
  assert.match(css, /\.immersa-media-unlock/);
});
