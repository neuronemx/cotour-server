const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createView } = require('../public/events-v2/knowledge-page');
const html = fs.readFileSync(require.resolve('../events-v2/console.html'), 'utf8');
function harness(kind = 'PARTICIPANT') {
  class Element {
    constructor(tag = '') { this.tagName = tag; this.children = []; this.handlers = {}; this.value = ''; this.open = false; }
    set innerHTML(_) { throw new Error('Unsafe HTML'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; if (this.tagName === 'SELECT') this.value = ''; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(key, fn) { this.handlers[key] = fn; }
    fire(key) { this.handlers[key]?.(); }
    showModal() { this.open = true; } close() { this.open = false; }
  }
  const e = Object.fromEntries([...html.matchAll(/<(\w+)[^>]*id="(knowledge-[^"]+)"/g)].map(m => [m[2], new Element(m[1].toUpperCase())]));
  const sent = [], timers = new Map(); let sequence = 0, time = 1000000, reads = 0;
  let state = { status: 'ready', kind, pending: false, code: null, snapshot: { displayName: 'Saved name', available: [{ id: 'one', title: '<script>One</script>', category: 'contest' },{ id: 'two', title: 'Two', category: 'assessment' }],
    execution: { executionId: 'run', revision: 1, category: 'assessment', title: 'Evaluation', state: 'ACTIVE', substate: null, serverNow: new Date(time).toISOString(), deadlineAt: new Date(time + 30000).toISOString(),
      participantCount: 1, submittedCount: 0, participant: { label: 'Own', tabActive: true, submittedAt: null, currentQuestionIndex: 0 }, questionCount: 2, questionIndex: -1, answerCount: 0, answers: [],
      questions: [{ id: 'q2', prompt: '<img>Second?', options: [{ id: 'a', label: '<script>A</script>' },{ id: 'b', label: 'B' }] },{ id: 'q1', prompt: 'First?', options: [{ id: 'c', label: 'C' },{ id: 'd', label: 'D' }] }], personalResult: null, submissionReceipt: null, resultsVisible: false, top10: [] } } };
  const controller = { getState: () => state, operate: (action, input) => sent.push({ action, input }), refresh: () => { reads++; }, availableActions: () => ['STAGE','SPEAKER'].includes(state.kind) ? ['start','finalize','cancel'] : [] };
  const document = { getElementById: id => e[id], createElement: tag => new Element(tag.toUpperCase()) };
  const view = createView({ document, controller, now: () => time, setTimeoutFn: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeoutFn: id => timers.delete(id) });
  return { e, sent, timers, document, reads: () => reads, run: () => state.snapshot.execution, render(extra) { state = { ...state, ...extra }; view.render(state); },
    tick(ms) { time += ms; const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1].fn(); } } };
}
test('public Knowledge questions stay literal, preserve option elements, follow server order and display only confirmed own answers', () => {
  const h = harness(), e = h.e; assert.equal(e['knowledge-question'].textContent, '<img>Second?');
  const first = e['knowledge-options'].children[0]; assert.equal(first.textContent, '<script>A</script>'); first.fire('click');
  assert.deepEqual(h.sent.at(-1), { action: 'answer', input: { questionId: 'q2', optionId: 'a' } });
  h.render({ snapshot: { execution: { ...h.run(), answerCount: 1, answers: [{ questionId: 'q2', optionId: 'a' }] } } });
  assert.equal(e['knowledge-options'].children[0], first); assert.equal(first['aria-pressed'], 'true'); assert.equal(e['knowledge-answer-status'].textContent, 'Respuesta guardada.');
  e['knowledge-next'].fire('click'); assert.equal(e['knowledge-question'].textContent, 'First?'); assert.equal(e['knowledge-progress'].textContent, '2/2');
});
test('registration prefills and preserves corrections; inactive tabs offer explicit claim without submitting or claiming automatically', () => {
  const h = harness(), e = h.e; h.render({ snapshot: { displayName: 'Saved name', execution: { ...h.run(), state: 'LOBBY', participant: null, registrationOpen: true, identificationMode: 'required_name', questions: [] } } });
  assert.equal(e['knowledge-name'].value, 'Saved name'); e['knowledge-name'].value = 'Correction'; h.render({ pending: true }); h.render({ pending: false }); assert.equal(e['knowledge-name'].value, 'Correction');
  e['knowledge-join'].fire('click'); assert.deepEqual(h.sent.at(-1), { action: 'join', input: { name: 'Correction' } });
  h.render({ snapshot: { execution: { ...h.run(), participant: { label: 'Correction', tabActive: false, submittedAt: null } } } });
  assert.equal(e['knowledge-claim'].hidden, false); assert.equal(h.sent.length, 1); e['knowledge-claim'].fire('click'); assert.equal(h.sent.at(-1).action, 'claim_tab');
});
test('partial assessment submission needs a current confirmation and uses only the canonical receipt/grade after publication', () => {
  const h = harness(), e = h.e; h.render({ snapshot: { execution: { ...h.run(), answerCount: 1, answers: [{ questionId: 'q2', optionId: 'a' }] } } });
  e['knowledge-submit'].fire('click'); assert.equal(e['knowledge-confirm-dialog'].open, true); assert.match(e['knowledge-confirm-detail'].textContent, /1 de 2/); assert.equal(h.sent.length, 0);
  h.render({ snapshot: { execution: { ...h.run(), revision: 2 } } }); e['knowledge-confirm'].fire('click'); assert.equal(h.sent.length, 0);
  e['knowledge-submit'].fire('click'); e['knowledge-confirm'].fire('click'); assert.deepEqual(h.sent.at(-1), { action: 'submit', input: { executionId: 'run', expectedRevision: 2 } });
  const submittedAt = new Date(1000000).toISOString(); h.render({ snapshot: { execution: { ...h.run(), participant: { ...h.run().participant, submittedAt }, questions: [], submissionReceipt: { submittedAt, answeredCount: 1, totalQuestions: 2 } } } });
  assert.match(e['knowledge-receipt'].textContent, /1\/2/); assert.equal(e['knowledge-results'].children.length, 0);
  h.render({ snapshot: { execution: { ...h.run(), resultsVisible: true, personalResult: { grade: 50 } } } }); assert.equal(e['knowledge-results'].children[0].textContent, 'Tu calificación: 50/100');
});
test('operator catalog selection survives real select resets; irreversible actions require confirmation bound to execution/revision', () => {
  const h = harness('STAGE'), e = h.e; e['knowledge-catalog'].value = 'two'; h.render({ snapshot: { available: [{ id: 'one', title: 'One', category: 'contest' },{ id: 'two', title: 'Two', category: 'assessment' }], execution: null } });
  assert.equal(e['knowledge-catalog'].value, 'two'); e['knowledge-open'].fire('click'); assert.deepEqual(h.sent.at(-1), { action: 'open', input: { definitionId: 'two' } });
  h.render({ snapshot: { available: [], execution: { executionId: 'new', revision: 3, category: 'contest', title: 'Trivia', state: 'ACTIVE', serverNow: new Date(1000000).toISOString(), questionDeadlineAt: new Date(1005000).toISOString(), participantCount: 1, submittedCount: 0, currentQuestion: { prompt: 'Current?' } } } });
  e['knowledge-finalize'].fire('click'); e['knowledge-cancel-confirm'].fire('click'); assert.equal(h.sent.length, 1);
  e['knowledge-finalize'].fire('click'); h.render({ pending: true }); e['knowledge-confirm'].fire('click'); assert.equal(h.sent.length, 1);
});
test('Player uses projected text and ranking without a second emergency listener; countdown expiry reads instead of advancing the engine', () => {
  const h = harness('PLAYER'), e = h.e; h.render({ snapshot: { available: [], execution: { ...h.run(), category: 'contest', state: 'COUNTDOWN', participant: undefined, currentQuestion: null, countdownDeadlineAt: new Date(1004700).toISOString() } } });
  assert.equal(e['knowledge-controls'].hidden, true); assert.equal(h.document.addEventListener, undefined); h.tick(5000); h.tick(1000); assert.equal(h.reads(), 1); assert.equal(h.run().state, 'COUNTDOWN'); assert.equal(h.sent.length, 0);
  h.render({ snapshot: { execution: { ...h.run(), state: 'RESULTS_VISIBLE', resultsVisible: true, countdownDeadlineAt: null, top10: [{ position: 1, label: '<script>Name</script>', correctCount: 1, totalQuestions: 2, correctTimeMs: 1000 }] } } });
  assert.equal(e['knowledge-results'].children[0].textContent, '1. <script>Name</script> · 1/2 · 1.00 s');
  h.render({ status: 'waiting', kind: null, snapshot: null }); assert.equal(h.timers.size, 0); assert.equal(e['knowledge-question'].textContent, ''); assert.equal(e['knowledge-results'].children.length, 0);
});
