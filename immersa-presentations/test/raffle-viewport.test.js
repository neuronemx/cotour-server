const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Raffle uses Safari visible height through keyboard resize and falls back when unavailable', () => {
  const source = fs.readFileSync('public/audience/audience.js', 'utf8');
  const start = source.indexOf('function syncRaffleVisibleHeight()');
  const end = source.indexOf('const viewport =', start);
  const values = {};
  const events = {};
  const window = { innerHeight: 800, visualViewport: { height: 650, offsetTop: 0, addEventListener: (name, handler) => events[name] = handler }, addEventListener() {} };
  vm.runInNewContext(source.slice(start, end), { window, viewer: { style: { setProperty: (name, height) => { values[name] = height; } } } });
  assert.equal(values['--raffle-visible-height'], '650px');
  assert.equal(values['--raffle-visible-top'], '0px');
  window.visualViewport.height = 310;
  events.resize();
  assert.equal(values['--raffle-visible-height'], '310px');
  window.visualViewport.offsetTop = 180;
  events.scroll();
  assert.equal(values['--raffle-visible-top'], '180px');
  window.visualViewport = undefined;
  events.resize();
  assert.equal(values['--raffle-visible-height'], '800px');
  assert.equal(values['--raffle-visible-top'], '0px');
});
