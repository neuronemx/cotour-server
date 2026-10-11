const test = require('node:test');
const assert = require('node:assert/strict');
const { InteractionStore } = require('../interaction-store');

test('ES and EN use stable poll IDs and one result with complete fallback data', () => {
  const store = new InteractionStore();
  const poll = store.launch({ sessionId: 'live-1', interaction: {
    id: 'poll-1', type: 'poll', prompt: '¿Cuál?',
    options: [{ id: 'a', label: 'Uno' }, { id: 'b', label: 'Dos' }],
    en: { prompt: 'Which?', options: { a: 'One', b: 'Two' } }
  } });
  assert.equal(poll.en.prompt, 'Which?');
  assert.deepEqual(store.getState('live-1', 'aud-en').active.en.options, { a: 'One', b: 'Two' });
  assert.equal(store.submitResponse({ sessionId: 'live-1', interactionId: 'poll-1', audienceId: 'aud-es', optionId: 'a' }).ok, true);
  assert.equal(store.submitResponse({ sessionId: 'live-1', interactionId: 'poll-1', audienceId: 'aud-en', optionId: 'a' }).ok, true);
  assert.equal(store.getResults('live-1').options.find((option) => option.id === 'a').count, 2);

  const incomplete = store.launch({ sessionId: 'live-1', interaction: {
    ...poll, en: { prompt: 'Which?', options: { a: 'One' } }
  } });
  assert.equal(incomplete.en.options.b, undefined);
  assert.equal(incomplete.options.find((option) => option.id === 'b').label, 'Dos');
});
