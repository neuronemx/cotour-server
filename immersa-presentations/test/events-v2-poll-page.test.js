const test = require('node:test');
const assert = require('node:assert/strict');
const { createView } = require('../public/events-v2/poll-page');
function harness(kind) {
  class Element {
    constructor() { this.children = []; this.handlers = {}; this.hidden = false; this.value = ''; }
    set innerHTML(_) { throw new Error('Unsafe HTML'); }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(key, fn) { this.handlers[key] = fn; }
    fire(key, event = {}) { this.handlers[key]?.(event); }
  }
  const ids = ['panel','controls','options','results','catalog','status','question','launch','show','hide','close','submit','emergency','emergency-action'];
  const elements = Object.fromEntries(ids.map(id => ['poll-' + id, new Element()])); const document = new Element();
  document.getElementById = id => elements[id]; document.createElement = () => new Element(); const sent = [];
  let state = { status: 'ready', kind, pending: false, snapshot: { pollRunId: 'run', active: { prompt: '<img onerror=bad()>', options: [{ id: 'a', label: '<script>A</script>' }, { id: 'b', label: 'B' }] },
    response: null, available: [{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }], results: kind === 'PARTICIPANT' ? null : { totalResponses: 1, options: [{ id: 'a', label: 'A', count: 1, percentage: 100 }] } } };
  const controller = { getState: () => state, operate: (action, input) => sent.push({ action, input }), emergencyActions: () => state.kind === 'PLAYER' && state.status === 'ready' && !state.pending ? [{ title: 'First', action: 'launch', input: { interactionId: 'first' } }, { title: 'Close', action: 'close', input: {} }] : [] };
  const view = createView({ document, controller }); return { elements, document, sent, state: () => state, render: extra => { state = { ...state, ...extra }; view.render(state); } };
}
test('poll page writes questions/options as literal text and retains radio elements while updating the receipt', () => {
  const h = harness('PARTICIPANT'), e = h.elements; assert.equal(e['poll-question'].textContent, '<img onerror=bad()>');
  const first = e['poll-options'].children[0].children[0]; first.fire('change'); assert.equal(first.checked, true); assert.equal(e['poll-submit'].disabled, false);
  h.render({ snapshot: { ...h.state().snapshot, response: { optionId: 'a' } } }); assert.equal(e['poll-options'].children[0].children[0], first); assert.equal(first.disabled, true);
  assert.equal(e['poll-status'].textContent, 'Respuesta registrada.'); assert.equal(e['poll-results'].children.length, 0);
  h.render({ status: 'waiting', snapshot: null, kind: null }); assert.equal(e['poll-question'].textContent, ''); assert.equal(e['poll-options'].children.length, 0);
});
test('operator catalog choice survives renders; submit and control handlers use only selected canonical inputs', () => {
  const h = harness('STAGE'), e = h.elements; e['poll-catalog'].value = 'second'; h.render({ snapshot: { ...h.state().snapshot, active: null } });
  assert.equal(e['poll-catalog'].value, 'second'); e['poll-launch'].fire('click'); assert.deepEqual(h.sent.at(-1), { action: 'launch', input: { interactionId: 'second' } });
  e['poll-close'].fire('click'); assert.equal(h.sent.at(-1).action, 'close');
});
