const test = require('node:test');
const assert = require('node:assert/strict');
const { createView } = require('../public/events-v2/qna-page');
function harness(kind = 'PARTICIPANT') {
  class Element {
    constructor() { this.children = []; this.handlers = {}; this.value = ''; this.checked = false; this.open = false; }
    set innerHTML(_) { throw new Error('Unsafe HTML'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    addEventListener(key, fn) { this.handlers[key] = fn; }
    fire(key) { this.handlers[key]?.(); }
    showModal() { this.open = true; } close() { this.open = false; }
  }
  const ids = ['panel','controls','public','output','projected-text','projected-name','status','name','question','consent','submit','cooldown','list','open','intake','hide','new-round','project','delete','confirm-dialog','confirm-title','cancel','confirm'];
  const e = Object.fromEntries(ids.map(id => ['qna-' + id, new Element()])), sent = [], timers = new Map(); let sequence = 0, reads = 0;
  let state = { status: 'ready', kind, pending: false, code: null, snapshot: { roundId: 'one', questionsOpen: true, displayName: 'Saved name', hasSubmitted: false, questionId: null, cooldownRemainingMs: 0,
    screen: { visible: false, question: null }, questions: [{ id: 'q', text: '<script>literal?</script>', answered: false }], selectedQuestionId: 'q' } };
  const controller = { getState: () => state, operate: (action, input) => sent.push({ action, input }), refresh: () => { reads++; } };
  const view = createView({ document: { getElementById: id => e[id], createElement: () => new Element() }, controller,
    setTimeoutFn: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeoutFn: id => timers.delete(id) });
  return { e, sent, timers, reads: () => reads, snapshot: () => state.snapshot, render: extra => { state = { ...state, ...extra }; view.render(state); } };
}
test('public Q&A preserves an edited name and draft through updates, captures explicit consent and clears on canonical receipt', () => {
  const h = harness(), e = h.e; assert.equal(e['qna-name'].value, 'Saved name'); e['qna-name'].value = 'Correction'; e['qna-question'].value = '<img>Question?'; e['qna-consent'].checked = true;
  e['qna-question'].fire('input'); assert.equal(e['qna-submit'].disabled, false); h.render({ snapshot: { ...h.snapshot() } });
  assert.equal(e['qna-question'].value, '<img>Question?'); assert.equal(e['qna-name'].value, 'Correction'); e['qna-submit'].fire('click');
  assert.deepEqual(h.sent.at(-1), { action: 'submit', input: { question: '<img>Question?', name: 'Correction', allowNameOnScreen: true } });
  h.render({ snapshot: { ...h.snapshot(), displayName: 'Correction', questionId: 'receipt', hasSubmitted: true, cooldownRemainingMs: 9999 } });
  assert.equal(e['qna-question'].value, ''); assert.equal(e['qna-consent'].checked, false); assert.equal(e['qna-status'].textContent, 'Pregunta registrada.'); assert.equal(e['qna-submit'].disabled, true);
  assert.equal(e['qna-output'].hidden, true); assert.equal(e['qna-controls'].hidden, true);
});
test('cooldown schedules only an authorized read; round changes and disconnect clear drafts and pending timers', () => {
  const h = harness(); h.render({ snapshot: { ...h.snapshot(), hasSubmitted: true, questionId: 'q', cooldownRemainingMs: 5000 } });
  const callback = [...h.timers.values()][0]; assert.equal(callback.ms, 5100); h.timers.clear(); callback.fn(); assert.equal(h.reads(), 1); assert.equal(h.sent.length, 0);
  h.e['qna-question'].value = 'Old draft'; h.render({ snapshot: { ...h.snapshot(), roundId: 'two', hasSubmitted: false, questionId: null, cooldownRemainingMs: 0 } }); assert.equal(h.e['qna-question'].value, '');
  h.render({ status: 'waiting', kind: null, snapshot: null }); assert.equal(h.timers.size, 0); assert.equal(h.e['qna-name'].value, ''); assert.equal(h.e['qna-public'].hidden, true);
});
test('operator selection/project handlers use canonical IDs; deletion and new round require current confirmation', () => {
  const h = harness('STAGE'), e = h.e; assert.equal(e['qna-list'].children[1].textContent, '<script>literal?</script>');
  e['qna-list'].value = 'q'; e['qna-list'].fire('change'); e['qna-project'].fire('click'); assert.deepEqual(h.sent.map(r => r.action), ['select','project']);
  e['qna-delete'].fire('click'); assert.equal(e['qna-confirm-dialog'].open, true); e['qna-cancel'].fire('click'); assert.equal(h.sent.length, 2);
  e['qna-new-round'].fire('click'); h.render({ snapshot: { ...h.snapshot(), roundId: 'two' } }); e['qna-confirm'].fire('click'); assert.equal(h.sent.length, 2);
  e['qna-new-round'].fire('click'); e['qna-confirm'].fire('click'); assert.deepEqual(h.sent.at(-1), { action: 'new_round', input: { roundId: 'two' } });
});
test('Player displays only canonical projected text/name; denial hides and clears output and dialogs', () => {
  const h = harness('PLAYER'), e = h.e; assert.equal(e['qna-panel'].hidden, true);
  h.render({ snapshot: { ...h.snapshot(), screen: { visible: true, question: { text: '<img onerror=bad()>', name: '<script>Name</script>' } } } });
  assert.equal(e['qna-projected-text'].textContent, '<img onerror=bad()>'); assert.equal(e['qna-projected-name'].textContent, '<script>Name</script>'); assert.equal(e['qna-controls'].hidden, true);
  e['qna-new-round'].fire('click'); assert.equal(e['qna-confirm-dialog'].open, false);
  h.render({ status: 'waiting', kind: null, snapshot: null }); assert.equal(e['qna-projected-text'].textContent, ''); assert.equal(e['qna-output'].hidden, true);
});
