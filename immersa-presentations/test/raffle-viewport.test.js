const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const source = fs.readFileSync('public/audience/audience.js', 'utf8');
  const start = source.indexOf('function createRaffleViewportRuntime(');
  const end = source.indexOf('const raffleViewportRuntime', start);
  const values = {}, classes = new Set(), viewportEvents = {}, documentEvents = {}, timers = new Map();
  let nextTimer = 0;
  const name = { matches: () => true };
  const document = { activeElement: null, addEventListener: (name, fn) => documentEvents[name] = fn };
  const window = { innerHeight: 800, visualViewport: { height: 650, offsetTop: 0, addEventListener: (name, fn) => viewportEvents[name] = fn }, addEventListener() {}, setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: (id) => timers.delete(id) };
  const viewer = { style: { setProperty: (name, value) => values[name] = value }, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  const runtime = context.createRaffleViewportRuntime({ viewer, window, document });
  return { values, classes, window, document,
    focus() { document.activeElement = name; documentEvents.focusin({ target: name }); },
    blur() { document.activeElement = null; documentEvents.focusout({ target: name }); },
    resize(height, top = 0) { window.visualViewport.height = height; window.visualViewport.offsetTop = top; viewportEvents.resize(); },
    settle() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    sync: runtime.sync };
}

test('Raffle follows Safari visible geometry and falls back when unavailable', () => {
  const f = fixture();
  assert.equal(f.values['--raffle-visible-height'], '650px');
  f.resize(620, 20);
  assert.equal(f.values['--raffle-visible-top'], '20px');
  f.window.visualViewport = undefined;
  f.sync();
  assert.equal(f.values['--raffle-visible-height'], '800px');
  assert.equal(f.values['--raffle-visible-top'], '0px');
});

test('OK blur retains form geometry until keyboard recovery settles, then restores atomically', () => {
  const f = fixture();
  f.focus(); f.resize(310, 180);
  f.blur();
  assert.equal(f.classes.has('is-raffle-name-editing'), true);
  f.resize(480, 100); f.settle();
  assert.equal(f.values['--raffle-visible-height'], '310px');
  assert.equal(f.values['--raffle-visible-top'], '180px');
  assert.equal(f.classes.has('is-raffle-name-editing'), true);
  f.resize(650);
  assert.equal(f.values['--raffle-visible-height'], '310px');
  f.settle();
  assert.equal(f.values['--raffle-visible-height'], '650px');
  assert.equal(f.values['--raffle-visible-top'], '0px');
  assert.equal(f.classes.has('is-raffle-name-editing'), false);
});

test('Enter keyboard closure while input stays focused does not leave the editing layout stuck', () => {
  const f = fixture();
  f.focus(); f.resize(310); f.resize(650); f.settle();
  assert.equal(f.classes.has('is-raffle-name-editing'), false);
  f.resize(310);
  assert.equal(f.classes.has('is-raffle-name-editing'), true);
  assert.equal(f.values['--raffle-visible-height'], '310px');
});

test('Refocusing during keyboard close cancels the pending layout restoration', () => {
  const f = fixture();
  f.focus(); f.resize(310); f.blur(); f.resize(650);
  f.resize(310); f.focus(); f.settle();
  assert.equal(f.classes.has('is-raffle-name-editing'), true);
  assert.equal(f.values['--raffle-visible-height'], '310px');
});
