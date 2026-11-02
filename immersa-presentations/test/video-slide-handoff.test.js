const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { waitForSlideImage, createRuntime } = require('../public/shared/video-slide-runtime');

function node(tag = 'div') {
  const events = new Map(), attrs = {};
  return {
    tagName: tag.toUpperCase(), dataset: {}, style: {}, children: [], hidden: false,
    complete: false, naturalWidth: 0, paused: true, ended: false,
    get src() { return attrs.src || ''; }, set src(value) { attrs.src = value; this.complete = false; this.naturalWidth = 0; },
    getAttribute: key => attrs[key] || null,
    setAttribute(key, value) { attrs[key] = value; }, removeAttribute(key) { delete attrs[key]; },
    addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
    fire(name) { for (const fn of [...(events.get(name) || [])]) fn({ target: this }); },
    listenerCount(name) { return events.get(name)?.size || 0; },
    appendChild(child) { child.parentElement = this; this.children.push(child); },
    remove() {}, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {},
    dispatchEvent() {}, decode: async () => {}
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function loaded(image, source) { image.setAttribute('src', source); image.complete = true; image.naturalWidth = 1920; image.fire('load'); }

test('waits for the target source and its decode, never the outgoing poster', async () => {
  const image = node('img'); loaded(image, '/slide-6.jpg');
  const wait = waitForSlideImage(image, '/locales/en/slide-7.jpg'); let done = false;
  wait.ready.then(() => { done = true; }); await tick(); assert.equal(done, false);
  let decode; image.decode = () => new Promise(resolve => { decode = resolve; });
  loaded(image, '/locales/en/slide-7.jpg'); await tick(); assert.equal(done, false);
  decode(); assert.equal(await wait.ready, true); assert.equal(image.listenerCount('load'), 0);
});
test('cached target image resolves without requiring another load', async () => {
  const image = node('img'); loaded(image, '/next.jpg');
  assert.equal(await waitForSlideImage(image, '/next.jpg').ready, true);
});
test('a failed target resolves and removes listeners so the existing loader can retry', async () => {
  const image = node('img'), wait = waitForSlideImage(image, '/missing.jpg');
  image.src = '/missing.jpg'; image.fire('error'); assert.equal(await wait.ready, false);
  assert.equal(image.listenerCount('error'), 0); assert.equal(image.listenerCount('load'), 0);
});
test('cancelled decode cannot complete a stale handoff', async () => {
  const image = node('img'); let decode; image.decode = () => new Promise(resolve => { decode = resolve; });
  loaded(image, '/next.jpg'); const wait = waitForSlideImage(image, '/next.jpg');
  wait.cancel(); decode(); assert.equal(await wait.ready, false); assert.equal(image.listenerCount('load'), 0);
});

async function harness(endBehavior = 'next') {
  const image = node('img'), host = node(), document = {
    head: node(), body: node(), documentElement: { contains: () => true },
    getElementById: id => id === 'slide' ? image : id === 'screen' ? host : null,
    querySelector: () => null, querySelectorAll: () => [], createElement: tag => node(tag), dispatchEvent() {}
  };
  const runtime = createRuntime({ document, role: 'screen', location: { search: '?session=own&deck=own' },
    socket: { on() {}, emit() {} }, fetch: async () => ({ ok: true, json: async () => ({ slides: [
      { id: 'video', src: 'clip.mp4', type: 'video', poster: 'slide-6.jpg', endBehavior, loop: endBehavior === 'loop', muted: true },
      { id: 'next', src: 'slide-7.jpg' }, { id: 'other', src: 'slide-8.jpg' }
    ] }) }) });
  await tick(); runtime.render({ slideIndex: 0 }); await tick();
  const video = host.children.find(child => child.tagName === 'VIDEO');
  return { image, video, runtime };
}
test('ended video remains visible across the state change until the English next image is decoded', async () => {
  const { image, video, runtime } = await harness();
  loaded(image, '/decks/own/slide-6.jpg'); video.ended = true; video.fire('ended');
  assert.equal(video.hidden, false);
  image.dataset.presentationSlideIndex = '1'; image.dataset.presentationSlideSource = '/decks/own/locales/en/slide-7.jpg';
  runtime.render({ slideIndex: 1 }); await tick();
  assert.equal(video.hidden, false); assert.equal(image.style.visibility, 'hidden'); assert.equal(video.paused, true);
  let decode; image.decode = () => new Promise(resolve => { decode = resolve; });
  loaded(image, image.dataset.presentationSlideSource); await tick(); assert.equal(video.hidden, false);
  decode(); await tick(); assert.equal(video.hidden, true); assert.equal(image.style.visibility, '');
});
test('a rapid second navigation cancels the first handoff', async () => {
  const { image, video, runtime } = await harness();
  image.dataset.presentationSlideIndex = '1'; image.dataset.presentationSlideSource = '/slide-7.jpg';
  runtime.render({ slideIndex: 1 }); let decode; image.decode = () => new Promise(resolve => { decode = resolve; });
  loaded(image, '/slide-7.jpg');
  image.dataset.presentationSlideIndex = '2'; image.dataset.presentationSlideSource = '/slide-8.jpg';
  runtime.render({ slideIndex: 2 }); decode(); await tick(); assert.equal(video.hidden, false);
  image.decode = async () => {}; loaded(image, '/slide-8.jpg'); await tick(); assert.equal(video.hidden, true);
});
test('returning to video cancels pending image cleanup', async () => {
  const { image, video, runtime } = await harness();
  image.dataset.presentationSlideIndex = '1'; image.dataset.presentationSlideSource = '/slide-7.jpg';
  runtime.render({ slideIndex: 1 }); runtime.render({ slideIndex: 0 }); await tick();
  assert.equal(video.hidden, false); assert.equal(image.style.visibility, 'hidden'); assert.equal(image.listenerCount('load'), 0);
});
test('stay and loop retain their player behavior when the video ends', async () => {
  for (const behavior of ['stay', 'loop']) {
    const { video, runtime } = await harness(behavior); video.ended = true; video.fire('ended');
    assert.equal(video.hidden, false); assert.equal(runtime.getActiveItem().endBehavior, behavior);
    assert.equal(video.loop, behavior === 'loop');
  }
});
test('Screen supplies the localized target before the asynchronous image swap', () => {
  const code = fs.readFileSync(path.join(__dirname, '../public/screen/screen.js'), 'utf8');
  assert.ok(code.indexOf('slide.dataset.presentationSlideSource = src;') < code.indexOf('window.ImmersaSlideTransitions.swap(slide, src'));
  assert.match(code, /operationalLocale === 'en' \? 'locales\/en\/'/);
});
