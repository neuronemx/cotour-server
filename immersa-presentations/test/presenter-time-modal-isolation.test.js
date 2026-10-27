const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/presenter/presenter.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/presenter/presenter.css'), 'utf8');
function source(name) {
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = script.indexOf('\nfunction ', start + 1);
  return script.slice(start, end < 0 ? script.length : end);
}
function node() {
  const classes = new Set();
  const attributes = {};
  const children = new Map();
  return {
    attributes, children,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, value) { const enabled = value ?? !classes.has(name); if (enabled) classes.add(name); else classes.delete(name); return enabled; }
    },
    setAttribute: (name, value) => { attributes[name] = value; },
    appendChild(child) { child.parent = this; },
    addEventListener(type, handler) { this[type] = handler; },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector); },
    querySelectorAll() { return []; }
  };
}
function harness(mode) {
  const body = node();
  const commands = [];
  let tick;
  const context = vm.createContext({
    window: {}, document: { body, createElement: node },
    presenterShell: node(), streamArea: node(), timeToggle: node(), audiovisualPanel: node(),
    immersaTimePanel: null, immersaTimeState: null, immersaTimeTick: null, interactionPanelOpen: false,
    socket: { emit: (...args) => commands.push(args) },
    updateImmersaTimeReadouts() {}, syncAudiovisualToggle() {}, ensureAudiovisualUi() {},
    setInteractionPanelOpen() {},
    setTimeout(callback) { tick = callback; return 1; }, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/shared/immersa-time.js'), 'utf8'), context);
  for (const name of ['defaultImmersaTimeState', 'currentImmersaTimeState', 'screenTimeValue', 'screenTimeIsRunning', 'clearImmersaTimeTick', 'syncImmersaTimeUi', 'ensureImmersaTimePanel', 'screenTimeControls', 'renderImmersaTimePanel', 'openImmersaTimePanel', 'closeImmersaTimePanel', 'toggleImmersaTimePanel', 'applyImmersaTime', 'toggleAudiovisualPanel']) vm.runInContext(source(name), context);
  context.applyImmersaTime({ serverNow: Date.now(), speaker: { running: false }, screen: { mode, visible: true, running: mode !== 'clock', remainingMs: 300000, elapsedMs: 1000 } });
  return { context, commands, body, tick: () => tick() };
}

test('closing Tiempo while a timer runs preserves playback and remains closed after ticks and state updates', () => {
  for (const mode of ['countdown', 'stopwatch', 'clock']) {
    const h = harness(mode), c = h.context;
    c.audiovisualPanel.classList.add('is-open');
    c.openImmersaTimePanel();
    assert.equal(c.immersaTimePanel.parent, h.body);
    assert.equal(c.streamArea.classList.contains('is-time-open'), true);
    assert.equal(c.audiovisualPanel.classList.contains('is-open'), false);
    const state = JSON.stringify(c.immersaTimeState);
    c.immersaTimePanel.querySelector('[data-time-close]').click();
    assert.equal(c.immersaTimePanel.classList.contains('is-open'), false);
    assert.equal(c.streamArea.classList.contains('is-time-open'), false);
    assert.equal(JSON.stringify(c.immersaTimeState), state);
    h.tick();
    c.applyImmersaTime(c.immersaTimeState);
    assert.equal(c.immersaTimePanel.classList.contains('is-open'), false);
    assert.equal(c.timeToggle.attributes['aria-expanded'], 'false');
    assert.equal(c.timeToggle.classList.contains('is-active'), true);
    assert.deepEqual(h.commands, []); // No timer stop/hide or audiovisual volume command.
    c.toggleImmersaTimePanel();
    assert.equal(c.immersaTimePanel.classList.contains('is-open'), true);
    c.toggleImmersaTimePanel();
    assert.equal(c.immersaTimePanel.classList.contains('is-open'), false);
  }
});

test('opening Audiovisual closes Tiempo without changing either playback state', () => {
  const h = harness('countdown'), c = h.context;
  c.openImmersaTimePanel();
  const state = JSON.stringify(c.immersaTimeState);
  c.toggleAudiovisualPanel();
  assert.equal(c.audiovisualPanel.classList.contains('is-open'), true);
  assert.equal(c.immersaTimePanel.classList.contains('is-open'), false);
  assert.equal(c.streamArea.classList.contains('is-time-open'), false);
  assert.equal(JSON.stringify(c.immersaTimeState), state);
  assert.deepEqual(h.commands, []);
});

test('closed audiovisual descendants and video previews cannot intercept Tiempo input', () => {
  assert.match(css, /\.audiovisual-panel:not\(\.is-open\),\s*\.audiovisual-panel:not\(\.is-open\) \*\s*\{\s*pointer-events: none !important;/);
  assert.match(css, /\.audiovisual-layer \{[^}]*pointer-events:none/);
  assert.match(css, /\.audiovisual-layer video \{[^}]*pointer-events:none/);
  assert.match(css, /\.stream-area\.is-time-open > \.immersa-video-slide,[\s\S]*?iframe \{ pointer-events: none !important;/);
  assert.match(css, /\.time-panel \{\s*position: fixed;\s*z-index: 2147483000;/);
});
