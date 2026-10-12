const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Raffle uses Safari visible height through keyboard resize and falls back when unavailable', () => {
  const source = fs.readFileSync('public/audience/audience.js', 'utf8');
  const start = source.indexOf('function syncRaffleVisibleHeight()');
  const end = source.indexOf('const viewport =', start);
  let value;
  const events = {};
  const window = { innerHeight: 800, visualViewport: { height: 650, addEventListener: (name, handler) => events[name] = handler }, addEventListener() {} };
  vm.runInNewContext(source.slice(start, end), { window, viewer: { style: { setProperty: (name, height) => { value = height; } } } });
  assert.equal(value, '650px');
  window.visualViewport.height = 310;
  events.resize();
  assert.equal(value, '310px');
  window.visualViewport = undefined;
  events.resize();
  assert.equal(value, '800px');
});
