const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/screen/screen.js'), 'utf8');

function harness() {
  function media() {
    const classes = new Set(), listeners = new Map();
    return { dataset: {}, style: {}, paused: true, currentTime: 0, opacity: 1, removed: 0,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
      addEventListener(name, fn, options = {}) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add({ fn, once: options.once }); },
      removeEventListener(name, fn) { for (const entry of listeners.get(name) || []) if (entry.fn === fn) listeners.get(name).delete(entry); },
      fire(name) { for (const entry of [...(listeners.get(name) || [])]) { if (entry.once) listeners.get(name).delete(entry); entry.fn({ propertyName: 'opacity' }); } },
      pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() {},
      removeAttribute(name) { if (name === 'src') { this.src = ''; this.removed++; } }
    };
  }
  const slots = [media(), media()], timers = new Map(), scheduled = []; let timerId = 0, fades = 0;
  const context = vm.createContext({ audiovisualMedia: { video: slots }, activeVideoSlot: 0, videoTransitionToken: 0,
    audiovisualState: { video: {} }, audiovisualFxMonitors: new WeakMap(),
    audiovisualVideoFade: { cancel() {}, apply() { fades++; } },
    resolveAudiovisualMediaUrl: r => 'blob:' + r.id, isWebMAudiovisualResource: r => r.id.includes('alpha'),
    clearVideoPlaylistAdvance() {}, scheduleVideoPlaylistAdvance: m => scheduled.push(m.dataset.resourceId),
    window: { ImmersaAudiovisualFx: { isFx: r => r.category === 'fx' }, getComputedStyle: m => ({ opacity: m.classList.contains('is-swap-base') && m.classList.contains('is-visible') ? '1' : String(m.opacity) }),
      setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } }, console
  });
  vm.runInContext(source.slice(source.indexOf('function stopVideoSlots()'), source.indexOf('function applyAudioState(state)')), context);
  function select(id, extra = {}) {
    context.audiovisualState.video = { resource: { id, source: 'local', ...extra }, status: 'playing', volume: .7 };
    context.applyVideoState(context.audiovisualState.video);
  }
  function state(status) { context.audiovisualState.video = { ...context.audiovisualState.video, status, ...(status === 'fading' ? { fadeOut: { id: 'stop', durationMs: 1000 } } : {}) }; context.applyVideoState(context.audiovisualState.video); }
  function timer() { const next = timers.entries().next().value; assert.ok(next); timers.delete(next[0]); next[1](); }
  function start() { select('one'); slots[1].fire('canplay'); return slots[1]; }
  return { context, slots, timers, scheduled, select, state, timer, start, fades: () => fades };
}
test('incoming starts opaque underneath while only outgoing fades, in both slot directions', () => {
  const h = harness(); let outgoing = h.start();
  for (const id of ['two', 'three']) {
    h.select(id); const incoming = h.slots.find(m => m !== outgoing);
    assert.equal(outgoing.classList.contains('is-swap-base'), true);
    assert.equal(outgoing.classList.contains('is-visible'), true);
    assert.equal(incoming.classList.contains('is-visible'), false);
    incoming.fire('canplay'); outgoing.opacity = .5; h.timer();
    assert.equal(incoming.classList.contains('is-visible'), true);
    assert.equal(incoming.classList.contains('is-swap-base'), true, 'incoming must have no opacity transition');
    assert.equal(outgoing.classList.contains('is-swap-top'), true);
    assert.equal(outgoing.paused, false, 'outgoing stays decoded while fading');
    outgoing.opacity = 0; outgoing.fire('transitionend');
    assert.equal(outgoing.classList.contains('is-visible'), false); assert.equal(outgoing.paused, true);
    assert.equal(incoming.classList.contains('is-visible'), true); outgoing = incoming;
  }
});
test('a paused or ended outgoing clip keeps its last frame while the next clip loads', () => {
  for (const kind of ['paused', 'ended']) { const h = harness(), old = h.start(); old.paused = true; old.ended = kind === 'ended'; h.select('two'); assert.equal(old.classList.contains('is-visible'), true); h.slots[0].fire('canplay'); assert.equal(old.classList.contains('is-swap-top'), true); assert.equal(h.slots[0].classList.contains('is-swap-base'), true); }
});
test('rapid third selection promotes its current picture before reusing the other slot', () => {
  const h = harness(); h.start(); h.select('two'); h.slots[0].fire('canplay'); h.slots[0].opacity = .2;
  h.select('three'); assert.equal(h.slots[0].classList.contains('is-swap-base'), true);
  assert.equal(h.slots[0].classList.contains('is-visible'), true);
  h.slots[1].fire('canplay'); h.timer();
  assert.equal(h.slots[1].dataset.resourceId, 'three'); assert.equal(h.slots[1].removed, 0, 'old cleanup cannot erase a reused slot');
});
test('reselecting the current video rejects a late canplay from an obsolete pending selection', () => {
  const h = harness(); h.start(); h.select('two'); h.select('one'); h.slots[0].fire('canplay');
  assert.equal(h.context.activeVideoSlot, 1); assert.equal(h.slots[0].classList.contains('is-visible'), false);
});
test('stop during loading cancels reveal and clears both swap roles', () => {
  const h = harness(); h.start(); h.select('two'); h.state('stopped'); h.slots[0].fire('canplay');
  for (const m of h.slots) { assert.equal(m.paused, true); for (const c of ['is-visible', 'is-swap-base', 'is-swap-top']) assert.equal(m.classList.contains(c), false); }
});
test('global fade invalidates pending cleanup and retains both layers for the shared fade', () => {
  const h = harness(); h.start(); h.select('two'); h.slots[0].fire('canplay'); h.state('fading'); h.timer();
  assert.equal(h.fades(), 1); assert.equal(h.slots[0].classList.contains('is-visible'), true); assert.equal(h.slots[1].classList.contains('is-swap-top'), true);
  h.state('stopped'); assert.ok(h.slots.every(m => m.paused && !m.classList.contains('is-visible')));
});
test('playlist scheduling still starts only after the selected clip can play', () => {
  const h = harness(); h.start(); h.select('two', { playlist: { id: 'own-list' } }); assert.deepEqual(h.scheduled, ['one']);
  h.slots[0].fire('canplay'); assert.deepEqual(h.scheduled, ['one', 'two']); assert.equal(h.slots[0].loop, false);
});
test('swap stacking preserves WebM transparency and suppresses outgoing opacity transitions', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/screen/screen.css'), 'utf8');
  assert.match(css, /\.is-swap-base \{ z-index:1; transition:none; \}/);
  assert.match(css, /\.is-swap-top \{ z-index:2; \}/);
  assert.match(css, /\.is-webm \{ background:transparent; \}/);
});
