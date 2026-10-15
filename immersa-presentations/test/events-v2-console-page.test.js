const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const consoleModule = require('../public/events-v2/live-console');
const pollModule = require('../public/events-v2/poll-console');
const knowledgeModule = require('../public/events-v2/knowledge-console');
const knowledgePage = require('../public/events-v2/knowledge-page');
const qnaModule = require('../public/events-v2/qna-console');
const qnaPage = require('../public/events-v2/qna-page');
const emergencyMenu = require('../public/events-v2/emergency-menu');
const pollPage = require('../public/events-v2/poll-page');
const source = fs.readFileSync(require.resolve('../public/events-v2/console-page.js'), 'utf8');
const html = fs.readFileSync(require.resolve('../events-v2/console.html'), 'utf8');
const eventId = '00000000-0000-4000-8000-000000000001', activityId = '00000000-0000-4000-8000-000000000002';
const stageId = '00000000-0000-4000-8000-000000000003', liveSessionId = '00000000-0000-4000-8000-000000000004';
const target = { eventId, activityId, stageId, liveSessionId, title: '<img onerror=bad()>', stageTitle: '<script>bad()</script>', status: 'LIVE', canStart: false };
const projection = { eventId, liveSessionId, revision: 1, slideIndex: 0, presenterSlideIndex: 0, liveSlideIndex: 0, slideCount: 5, transmissionPaused: false, transmissionPausedBy: null };
async function settle() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
// A deliberately small DOM model executes the shipped page handlers. Physical
// browser rendering, secure-cookie behavior and operator acceptance are separate.
function page(kind = 'STAGE', purpose = 'live') {
  class Element {
    constructor(id = '') { this.id = id; this.listeners = {}; this.hidden = false; this.disabled = false; this.value = ''; this.open = false; this.children = []; }
    set innerHTML(_) { throw new Error('Unsafe HTML assignment'); }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    fire(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
    append(...items) { this.children.push(...items); }
    setAttribute(name, value) { this[name] = value; }
    replaceChildren() { this.children = []; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const document = new Element(); document.getElementById = id => elements[id]; document.createElement = () => new Element();
  const window = new Element(), sent = []; let options, controller, generation = 0, resumes = 0;
  window.history = { replaceState() {} }; window.location = { pathname: '/generic', reload() {} }; window.fetch = async () => {}; window.io = () => {};
  window.ImmersaEventLiveConsole = { ...consoleModule, createController: args => (controller = consoleModule.createController(args)) };
  window.ImmersaEventKnowledgeConsole = knowledgeModule; window.ImmersaEventKnowledgePage = knowledgePage;
  window.ImmersaEventQnaConsole = qnaModule; window.ImmersaEventQnaPage = qnaPage; window.ImmersaEventEmergencyMenu = emergencyMenu;
  window.ImmersaEventPollConsole = pollModule; window.ImmersaEventPollPage = pollPage;
  const access = { start() { options.onState({ status: 'connecting' }); }, close() { options.onState({ status: 'closed' }); }, resume() { resumes++; options.onState({ status: 'connecting' }); },
    command: async (name, payload) => { sent.push({ name, payload }); return name === 'events:lifecycle:finish'
      ? { ok: true, liveSession: { eventId, liveSessionId, status: 'FINISHED' } }
      : name === 'events:poll:snapshot' ? { ok: true, snapshot: { eventId, liveSessionId, revision: 0, pollRunId: null, active: null, resultsVisible: false, available: [], results: null, response: null } }
        : name === 'events:qna:snapshot' ? { ok: true, snapshot: { eventId, liveSessionId, revision: 0, roundId: null, roundNumber: 0, questionsOpen: false, displayName: 'Own', hasSubmitted: false, questionId: null, cooldownRemainingMs: 0, screen: { visible: false, question: null }, questions: [], selectedQuestionId: null, availableQuestions: [] } }
        : name === 'events:knowledge:snapshot' ? { ok: true, snapshot: { eventId, liveSessionId, execution: null, available: [], displayName: 'Own' } }
        : { ok: true, snapshot: projection }; } };
  window.ImmersaEventAccess = { consumeLink: () => ({ binding: { view: { STAGE: 'stage', SPEAKER: 'speaker', PLAYER: 'screen', PARTICIPANT: 'audience' }[kind] } }), createClient: args => { options = args; return access; } };
  vm.runInNewContext(source, { window, document, setTimeout, clearTimeout }, { filename: 'console-page.js' });
  return { elements, document, sent, resumes: () => resumes,
    ready: (targets = [target]) => options.onState({ status: 'ready', generation: ++generation, eventName: '<script>Event</script>', targets, context: { eventId, stageId, kind, purpose } }),
    deny: () => options.onState({ status: 'denied' }), controller: () => controller };
}

test('page hides and clears operations before authority or after denial; authorized names stay literal text', async () => {
  const h = page(); assert.equal(h.elements.operation.hidden, true); assert.equal(h.elements.next.disabled, true);
  h.ready(); await h.controller().select(consoleModule.targetKey(target));
  assert.equal(h.elements.operation.hidden, false); assert.equal(h.elements['event-name'].textContent, '<script>Event</script>');
  assert.equal(h.elements.activity.children[1].textContent, target.title + ' · ' + target.stageTitle + ' · En vivo');
  await settle(); const reads = h.sent.filter(row => row.name === 'events:qna:snapshot').length;
  h.elements.refresh.fire('click'); await settle(); assert.equal(h.resumes(), 1); assert.equal(h.elements.operation.hidden, true);
  h.ready(); await settle(); assert.equal(h.sent.filter(row => row.name === 'events:qna:snapshot').length, reads + 1);
  assert.equal(h.elements.position.hidden, false); h.deny();
  assert.equal(h.elements.operation.hidden, true); assert.equal(h.elements.position.hidden, true); assert.equal(h.elements.activity.children.length, 1);
  assert.equal(h.elements.next.disabled, true);
});

test('Stage finalization requires the actual confirmation dialog; cancel and revoked dialog cannot emit a finish', async () => {
  const h = page(); h.ready(); await h.controller().select(consoleModule.targetKey(target));
  h.elements.finish.fire('click'); assert.equal(h.elements['finish-dialog'].open, true);
  assert.equal(h.sent.some(row => row.name === 'events:lifecycle:finish'), false);
  h.elements['cancel-finish'].fire('click'); assert.equal(h.elements['finish-dialog'].open, false);
  h.elements.finish.fire('click'); h.deny(); assert.equal(h.elements['finish-dialog'].open, false);
  h.elements['confirm-finish'].fire('click'); await settle(); assert.equal(h.sent.some(row => row.name === 'events:lifecycle:finish'), false);
  h.ready(); await settle(); h.elements.finish.fire('click'); h.elements['confirm-finish'].fire('click'); await settle();
  assert.equal(h.sent.filter(row => row.name === 'events:lifecycle:finish').length, 1);
});

test('real page handlers expose controller navigation only to Stage/Speaker; Participant buttons cannot mutate', async () => {
  for (const kind of ['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT']) {
    const h = page(kind, kind === 'PLAYER' ? 'player' : kind === 'PARTICIPANT' ? 'public' : 'live');
    h.ready(); if (['STAGE', 'PARTICIPANT'].includes(kind)) await h.controller().select(consoleModule.targetKey(target)); await settle();
    assert.equal(h.elements.navigation.hidden, !['STAGE', 'SPEAKER'].includes(kind));
    assert.equal(h.elements['stage-lifecycle'].hidden, kind !== 'STAGE');
    h.elements['slide-number'].value = '3'; h.elements.go.fire('click'); await settle();
    assert.equal(h.sent.some(row => row.name === 'events:slide:go'), ['STAGE', 'SPEAKER'].includes(kind));
    h.elements.pause.fire('click'); await settle();
    assert.equal(h.sent.some(row => row.name === 'events:presentation:pause'), ['STAGE', 'SPEAKER'].includes(kind));
    if (kind === 'PARTICIPANT') { h.elements.next.fire('click'); await settle(); assert.equal(h.sent.filter(row => !/^events:(poll|qna|knowledge):/.test(row.name)).length, 1); }
  }
});

test('Player emergency keyboard excludes typing, modifiers and repeats; unavailable rehearsal never exposes controls', async () => {
  const h = page('PLAYER', 'player'); h.ready(); await settle();
  let prevented = 0; const key = { key: 'ArrowRight', target: { tagName: 'BODY' }, preventDefault() { prevented++; } };
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { target: { tagName: 'INPUT' } }, { target: { tagName: 'SELECT' } }]) h.document.fire('keydown', { ...key, ...extra });
  assert.equal(h.sent.filter(row => !/^events:(poll|qna|knowledge):/.test(row.name)).length, 1); h.document.fire('keydown', key); await settle();
  assert.equal(h.sent.at(-1).name, 'events:slide:next'); assert.equal(prevented, 1);
  h.deny(); h.document.fire('keydown', key); await settle(); assert.equal(h.sent.filter(row => row.name === 'events:slide:next').length, 1);
  const rehearsal = page('SPEAKER', 'rehearsal'); rehearsal.ready([]); await settle();
  assert.equal(rehearsal.elements.navigation.hidden, true); assert.equal(rehearsal.elements['access-detail'].textContent, 'El ensayo todavía no está disponible.');
});
