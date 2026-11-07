const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/shared/audiovisual-fade.js'), 'utf8');

function harness(video = false) {
  let time = 0, id = 0, rafCalls = 0;
  const timers = new Map();
  const context = vm.createContext({
    performance: { now: () => time },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); },
    requestAnimationFrame() { rafCalls++; return ++id; }, cancelAnimationFrame() {}
  });
  vm.runInContext(source, context);
  const state = { status: 'fading', volume: .8, fadeOut: { id: 'own-stop', durationMs: 1000 } };
  const media = { volume: .8, style: { opacity: '', removeProperty(name) { this[name] = ''; } }, classList: { contains: () => true } };
  const fade = context.ImmersaAudiovisualFade.create({ getState: () => state, getMedia: () => [media], video });
  return { state, media, fade, timers, rafCalls: () => rafCalls, tick(t) {
    time = t; const next = timers.entries().next().value;
    assert.ok(next, 'fade schedules a timer even when no animation frames are delivered');
    timers.delete(next[0]); next[1]();
  } };
}
test('audio fades progressively to zero with all animation frames suspended', () => {
  const h = harness(); h.fade.apply();
  h.tick(250); assert.ok(Math.abs(h.media.volume - .6) < 1e-9);
  h.tick(500); assert.equal(h.media.volume, .4);
  h.tick(1000); assert.equal(h.media.volume, 0);
  assert.equal(h.rafCalls(), 0); assert.equal(h.timers.size, 0);
});
test('Video/FX soundtrack and picture use the same fade without animation frames', () => {
  const h = harness(true); h.fade.apply(); h.tick(500);
  assert.equal(h.media.volume, .4); assert.equal(h.media.style.opacity, '0.5');
  h.tick(1000); assert.equal(h.media.volume, 0); assert.equal(h.media.style.opacity, '0');
});
test('repeated snapshots and volume changes retain the original stop deadline', () => {
  const h = harness(); h.fade.apply(); h.tick(250); h.state.volume = .4; h.fade.apply();
  assert.equal(h.timers.size, 1); h.tick(500); assert.equal(h.media.volume, .2);
  h.state.volume = 0; h.fade.apply(); h.tick(750); assert.equal(h.media.volume, 0);
  h.tick(1000); assert.equal(h.media.volume, 0); assert.equal(h.timers.size, 0);
});
test('cancelling the fade clears the timer before a newly selected clip plays', () => {
  const h = harness(); h.fade.apply(); h.tick(250); h.fade.cancel();
  h.state.status = 'playing'; h.state.fadeOut = null; h.media.volume = .8;
  assert.equal(h.timers.size, 0); assert.equal(h.media.volume, .8);
});
