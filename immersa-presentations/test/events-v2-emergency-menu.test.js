const test = require('node:test');
const assert = require('node:assert/strict');
const { createView } = require('../public/events-v2/emergency-menu');
function harness() {
  const nodes = { 'interaction-emergency': {}, 'interaction-emergency-action': { addEventListener(_name, fn) { this.click = fn; } } }, sent = [];
  let listener; const document = { getElementById: id => nodes[id], addEventListener: (_name, fn) => { listener = fn; } };
  let poll = [{ title: 'Encuesta', action: 'launch', input: { interactionId: 'poll' } }], qna = [{ title: 'Nueva ronda Q&A', action: 'new_round', input: { roundId: 'one' }, confirm: true }];
  const view = createView({ document, controllers: [{ emergencyActions: () => poll, operate: (...args) => sent.push(['poll', ...args]) }, { emergencyActions: () => qna, operate: (...args) => sent.push(['qna', ...args]) }] });
  return { nodes, sent, render: view.render, set: (p, q) => { poll = p; qna = q; view.render(); }, key(key, extra = {}) { listener({ key, target: { tagName: 'BODY' }, preventDefault() {}, ...extra }); } };
}
test('one emergency menu coordinates poll and Q&A with one line and E/arrows/Enter/Escape', () => {
  const h = harness(); h.key('e'); assert.equal(h.nodes['interaction-emergency-action'].textContent, 'Encuesta');
  h.key('Enter'); assert.deepEqual(h.sent, [['poll', 'launch', { interactionId: 'poll' }]]); assert.equal(h.nodes['interaction-emergency'].hidden, true);
  h.key('e'); h.key('ArrowDown'); assert.equal(h.nodes['interaction-emergency-action'].textContent, 'Nueva ronda Q&A'); h.key('Escape'); assert.equal(h.nodes['interaction-emergency'].hidden, true);
});
test('destructive emergency actions require a second deliberate Enter and lose confirmation on round change', () => {
  const h = harness(); h.key('e'); h.key('ArrowDown'); h.key('Enter'); assert.equal(h.sent.length, 0);
  assert.equal(h.nodes['interaction-emergency-action'].textContent, 'Confirmar: Nueva ronda Q&A');
  h.set([], [{ title: 'Nueva ronda Q&A', action: 'new_round', input: { roundId: 'two' }, confirm: true }]); h.key('Enter'); assert.equal(h.sent.length, 0);
  h.key('e'); h.key('Enter'); h.key('Enter'); assert.deepEqual(h.sent, [['qna', 'new_round', { roundId: 'two' }]]);
});
test('emergency typing/modifier/repeat guards preserve slide keys; denial removes every pending menu action', () => {
  const h = harness();
  for (const extra of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { target: { tagName: 'INPUT' } }, { target: { tagName: 'SELECT' } }, { target: { tagName: 'TEXTAREA' } }, { target: { isContentEditable: true } }]) h.key('e', extra);
  assert.equal(h.nodes['interaction-emergency'].hidden, true); h.key('e'); h.key('ArrowRight'); assert.equal(h.sent.length, 0);
  h.set([], []); h.key('Enter'); assert.equal(h.sent.length, 0); assert.equal(h.nodes['interaction-emergency-action'].textContent, '');
});
