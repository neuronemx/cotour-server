const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'public/presenter/presenter.js'), 'utf8');
function source(name) {
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const end = script.indexOf('\nfunction ', start + 1);
  return script.slice(start, end < 0 ? script.length : end);
}
function button() {
  const classes = new Set();
  return {
    hidden: false, disabled: false, textContent: '', attributes: {},
    classList: { contains: key => classes.has(key), toggle(key, value) { if (value) classes.add(key); else classes.delete(key); } },
    setAttribute(key, value) { this.attributes[key] = value; }
  };
}
function harness(enabled = true) {
  const commands = [], errors = [];
  let now = 100000, confirmed = true, timer;
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({
    Date: Clock, window: { confirm: () => confirmed },
    alert: message => errors.push(message), document: { querySelectorAll: () => [] },
    socket: { emit: (...args) => commands.push(args) },
    speakerTimer: button(), speakerTimerValue: button(), speakerTimerActions: button(),
    speakerTimerResume: button(), speakerTimerFinish: button(), timeToggle: button(),
    immersaTimePanel: null, immersaTimeState: null, immersaTimeTick: null,
    speakerTimerState: { running: false, elapsedMs: 0, startedAt: 0 },
    presentationLifecycleEnabled: enabled,
    presentationLifecycleState: { available: enabled, mode: 'test', startedAt: null },
    presentationLifecyclePending: false,
    setTimeout(callback) { timer = callback; return 1; }, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'public/shared/immersa-time.js'), 'utf8'), context);
  for (const name of ['defaultImmersaTimeState', 'currentImmersaTimeState', 'speakerTimeValue', 'speakerElapsedMs', 'screenTimeValue', 'screenTimeIsRunning', 'clearImmersaTimeTick', 'presentationIsLive', 'speakerTimerCanReset', 'updateImmersaTimeReadouts', 'syncImmersaTimeUi', 'toggleSpeakerTimer', 'resumeSpeakerTimer', 'finishPresentationFromSpeaker', 'applyPresentationLifecycle', 'rejectPresentationLifecycle', 'applyPresentationLifecycleFeature']) vm.runInContext(source(name), context);
  context.syncImmersaTimeUi();
  return { c: context, commands, errors, advance(ms) { now += ms; }, confirm(value) { confirmed = value; }, tick() { timer(); }, acknowledgeLive() { context.applyPresentationLifecycle({ available: true, mode: 'live', startedAt: new Clock(now).toISOString() }); } };
}

test('Speaker starts one real session then exposes Continuar/Finalizar when its local timer is paused', () => {
  const h = harness(), c = h.c;
  assert.equal(c.speakerTimerValue.textContent, 'Iniciar');
  c.toggleSpeakerTimer(); c.toggleSpeakerTimer();
  assert.deepEqual(h.commands, [['presentation:lifecycle:start']]);
  assert.equal(c.speakerTimer.disabled, true);
  assert.equal(c.speakerTimerState.running, false); // Wait for server acknowledgement.
  h.acknowledgeLive(); h.advance(5000); h.tick();
  assert.equal(c.speakerTimerValue.textContent, '00:00:05');
  c.toggleSpeakerTimer();
  assert.equal(c.speakerTimerActions.hidden, false);
  assert.equal(c.speakerTimerFinish.textContent, 'Finalizar');
  c.applyPresentationLifecycle(c.presentationLifecycleState); // Repeated live state must not resume a paused timer.
  h.advance(4000);
  assert.equal(c.speakerTimeValue(), '00:00:05');
  c.resumeSpeakerTimer(); h.advance(2000); h.tick();
  assert.equal(c.speakerTimerValue.textContent, '00:00:07');
  assert.equal(c.speakerTimerActions.hidden, true);
  assert.deepEqual(h.commands, [['presentation:lifecycle:start']]);
});

test('Finishing requires confirmation, is not duplicated while pending and resets after server acknowledgement', () => {
  const h = harness(), c = h.c;
  h.acknowledgeLive(); c.toggleSpeakerTimer();
  h.confirm(false); c.finishPresentationFromSpeaker();
  assert.deepEqual(h.commands, []);
  h.confirm(true); c.finishPresentationFromSpeaker(); c.finishPresentationFromSpeaker(); c.resumeSpeakerTimer();
  assert.deepEqual(h.commands, [['presentation:lifecycle:finish']]);
  assert.equal(c.speakerTimerFinish.disabled, true);
  c.applyPresentationLifecycle({ available: true, mode: 'test' });
  assert.equal(c.speakerTimerValue.textContent, 'Iniciar');
  assert.equal(c.speakerTimerActions.hidden, true);
  assert.equal(c.speakerTimerState.elapsedMs, 0);
});

test('Rejected start and finish unlock controls and preserve an ongoing session', () => {
  const h = harness(), c = h.c;
  c.toggleSpeakerTimer(); c.rejectPresentationLifecycle({ message: 'Servicio no disponible' });
  assert.equal(c.speakerTimer.disabled, false);
  assert.equal(c.speakerTimerValue.textContent, 'Iniciar');
  c.toggleSpeakerTimer(); h.acknowledgeLive(); h.advance(3000); c.toggleSpeakerTimer();
  c.finishPresentationFromSpeaker(); c.rejectPresentationLifecycle({ message: 'Cierra la interacción activa antes de finalizar' });
  assert.equal(c.presentationIsLive(), true);
  assert.equal(c.speakerTimerFinish.disabled, false);
  assert.equal(c.speakerTimerActions.hidden, false);
  assert.equal(c.speakerTimeValue(), '00:00:03');
  c.resumeSpeakerTimer(); assert.equal(c.speakerTimerState.running, true);
  assert.equal(h.errors.length, 2);
});

test('Clients without the lifecycle capability retain their local timer', () => {
  const h = harness(false), c = h.c;
  c.applyPresentationLifecycleFeature({ capabilities: { 'presentation.lifecycle': false } });
  c.toggleSpeakerTimer(); h.advance(3000); c.toggleSpeakerTimer();
  assert.equal(c.speakerTimeValue(), '00:00:03');
  assert.equal(c.speakerTimerFinish.textContent, 'Restablecer');
  c.finishPresentationFromSpeaker();
  assert.equal(c.speakerTimeValue(), '00:00:00');
  assert.deepEqual(h.commands, []);
});

test('FREE can start and finish while its metrics capability remains disabled', () => {
  const h = harness(false), c = h.c;
  c.applyPresentationLifecycleFeature({ capabilities: { 'presentation.lifecycle': true, 'metrics.basic': false } });
  c.toggleSpeakerTimer(); h.acknowledgeLive(); c.toggleSpeakerTimer();
  assert.equal(c.speakerTimerActions.hidden, false);
  assert.equal(c.speakerTimerFinish.textContent, 'Finalizar');
  c.finishPresentationFromSpeaker();
  assert.deepEqual(h.commands, [['presentation:lifecycle:start'], ['presentation:lifecycle:finish']]);
});

test('FREE completion sends Público directly to the site and saves no completion or metrics record', () => {
  const completion = fs.readFileSync(path.join(root, 'public/shared/presentation-completion.js'), 'utf8');
  for (const [role, destination] of Object.entries({ presenter: '/presentacion-finalizada', audience: 'https://www.immersalive.com/', screen: '/presentacion-finalizada' })) {
    const handlers = new Map(), removed = [], destinations = [], tasks = [];
    const ctx = vm.createContext({
      window: { sessionStorage: { setItem() { assert.fail('FREE must not store metrics'); }, removeItem: key => removed.push(key) }, location: { replace: value => destinations.push(value) }, setTimeout: fn => tasks.push(fn) },
      document: { createElement: () => ({ setAttribute() {}, style: {} }), body: { appendChild() {} } }
    });
    vm.runInContext(completion, ctx);
    ctx.window.ImmersaPresentationCompletion.create({ socket: { on: (event, fn) => handlers.set(event, fn), disconnect() {} }, role });
    handlers.get('presentation:closed')({ recorded: false, deckId: 'free-test' });
    tasks[0](); assert.deepEqual(destinations, [destination]); assert.equal(removed.length, 1);
  }
});

test('Pausing the Speaker timer never stops or resets the independently running screen countdown', () => {
  const h = harness(), c = h.c;
  h.acknowledgeLive();
  c.immersaTimeState = c.window.ImmersaTime.normalize({ serverNow: 100000, screen: { mode: 'countdown', visible: true, running: true, remainingMs: 60000 } });
  const before = JSON.stringify(c.immersaTimeState);
  h.advance(5000); c.toggleSpeakerTimer(); h.advance(3000); h.tick();
  assert.equal(c.speakerTimeValue(), '00:00:05');
  assert.equal(c.screenTimeValue(), '00:00:52');
  assert.equal(JSON.stringify(c.immersaTimeState), before);
  assert.deepEqual(h.commands, []);
});

test('Speaker registers the lifecycle events and preserves the Main action labels and recent modal fixes', () => {
  const html = fs.readFileSync(path.join(root, 'public/presenter/index.html'), 'utf8');
  assert.match(html, /id="speakerTimerValue">Iniciar<\/span>/);
  assert.match(html, /id="speakerTimerResume" type="button">Continuar<\/button>/);
  assert.match(html, /id="speakerTimerFinish"[^>]*>Finalizar<\/button>/);
  assert.doesNotMatch(script, /time:control", \{ target: "speaker"/);
  assert.match(script, /socket\.on\("presentation:lifecycle:state", applyPresentationLifecycle\)/);
  assert.match(script, /socket\.on\("presentation:lifecycle:rejected", rejectPresentationLifecycle\)/);
  assert.match(script, /socket\.on\("plan:features", applyPresentationLifecycleFeature\)/);
  assert.match(script, /document\.body\.appendChild\(immersaTimePanel\)/);
  assert.match(script, /const target = document\.documentElement;/);
});

test('The existing completion client closes each role only once and preserves its destination', () => {
  const completion = fs.readFileSync(path.join(root, 'public/shared/presentation-completion.js'), 'utf8');
  for (const [role, destination] of Object.entries({ presenter: '/presentacion-completada', audience: '/gracias-por-participar', screen: '/presentacion-finalizada', stage: '/operacion-finalizada' })) {
    const callbacks = new Map(), redirected = [], overlays = [], saved = [], scheduled = [];
    let disconnected = 0;
    const context = vm.createContext({
      window: { sessionStorage: { setItem: (...args) => saved.push(args) }, location: { replace: url => redirected.push(url) }, setTimeout: callback => scheduled.push(callback) },
      document: { createElement: () => ({ setAttribute() {}, style: {} }), body: { appendChild: item => overlays.push(item) } }
    });
    vm.runInContext(completion, context);
    context.window.ImmersaPresentationCompletion.create({ socket: { on: (event, handler) => callbacks.set(event, handler), disconnect: () => disconnected++ }, role, context: { deck: 'isolated-test' } });
    callbacks.get('presentation:closed')({ reason: 'FINISHED' }); callbacks.get('presentation:closed')({ reason: 'FINISHED' });
    assert.equal(scheduled.length, 1); scheduled[0]();
    assert.deepEqual(redirected, [destination]);
    assert.equal(disconnected, 1); assert.equal(saved.length, 1);
    assert.equal(overlays.length, role === 'screen' ? 1 : 0);
  }
});
