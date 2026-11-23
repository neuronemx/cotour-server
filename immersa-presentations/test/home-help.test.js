const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(portrait = false) {
  const listeners = new Map();
  let focused = null;
  class Element {
    constructor(tag) {
      this.tag = tag; this.hidden = false; this.attrs = {}; this.children = new Map();
      this.events = {}; this.open = false; this.src = ''; this.paused = 0; this.loaded = 0;
      this.classes = new Set();
      this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; if (name === 'src') this.src = ''; }
    querySelector(selector) {
      if (!this.children.has(selector)) this.children.set(selector, new Element(selector));
      return this.children.get(selector);
    }
    addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
    emit(name, event = {}) { for (const callback of this.events[name] || []) callback(event); }
    focus() { focused = this; }
    contains(target) { return target === this || [...this.children.values()].includes(target); }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    pause() { this.paused++; }
    load() { this.loaded++; }
  }
  const appended = [];
  const document = {
    createElement: (tag) => new Element(tag),
    body: { appendChild: (element) => appended.push(element) },
    addEventListener: (name, callback) => listeners.set(name, callback)
  };
  const window = { matchMedia: () => ({ matches: portrait }) };
  const source = fs.readFileSync(path.join(__dirname, '../public/home/home-help.js'), 'utf8');
  vm.runInNewContext(source, { window, document });
  const button = new Element('button');
  let tours = 0;
  window.ImmersaHomeHelp.mount(button, () => tours++);
  const [menu, dialog] = appended;
  return { button, menu, dialog, video: dialog.querySelector('video'), listeners,
    get tours() { return tours; }, get focused() { return focused; } };
}

test('help opens on request without loading a video or restarting the tour', () => {
  const f = fixture();
  assert.equal(f.menu.hidden, true);
  assert.equal(f.video.src, '');
  f.button.emit('click');
  assert.equal(f.menu.hidden, false);
  assert.equal(f.button.attrs['aria-expanded'], 'true');
  assert.equal(f.tours, 0);
  assert.equal(f.focused, f.menu.querySelector('[data-help-tour]'));
});

for (const portrait of [false, true]) {
  test(`help selects the final ${portrait ? 'vertical' : 'horizontal'} source without autoplay`, () => {
    const f = fixture(portrait);
    f.menu.querySelector('[data-help-video]').emit('click');
    assert.equal(f.video.src, `https://media.immersalive.com/spots/Spot_2_${portrait ? 'V' : 'H'}.mp4`);
    assert.equal(f.dialog.open, true);
    assert.equal(f.menu.hidden, true);
    assert.equal(f.dialog.classes.has('is-portrait'), portrait);
    assert.equal(f.dialog.innerHTML.includes('autoplay'), false);
    assert.match(f.dialog.innerHTML, /controls playsinline preload="none"/);
    f.dialog.querySelector('[data-help-close]').emit('click');
    assert.equal(f.dialog.open, false);
    assert.equal(f.video.paused, 1);
    assert.equal(f.video.loaded, 1);
    assert.equal(f.video.src, '');
    assert.equal(f.focused, f.button);
    assert.equal(f.tours, 0);
  });
}

test('guided tour still runs through the original restart callback', () => {
  const f = fixture();
  f.button.emit('click');
  f.menu.querySelector('[data-help-tour]').emit('click');
  assert.equal(f.menu.hidden, true);
  assert.equal(f.tours, 1);
});

test('Escape in the help layers does not reach underlying Deck handlers', () => {
  const f = fixture();
  let stopped = 0;
  f.button.emit('click');
  f.menu.emit('keydown', { key: 'Escape', stopPropagation: () => stopped++ });
  assert.equal(f.menu.hidden, true);
  assert.equal(f.focused, f.button);
  f.dialog.emit('keydown', { key: 'Escape', stopPropagation: () => stopped++ });
  assert.equal(stopped, 2);
});

test('video failures offer the same final source in another tab', () => {
  const f = fixture();
  f.menu.querySelector('[data-help-video]').emit('click');
  f.video.emit('error');
  const error = f.dialog.querySelector('[data-help-error]');
  assert.equal(error.hidden, false);
  assert.equal(error.querySelector('a').href, f.video.src);
});
