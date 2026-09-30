const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('../public/shared/poll-locale');

test('an active poll switches question and answers together without mutating its base content', () => {
  const poll = {
    id: 'poll-1',
    prompt: 'Pregunta en Español',
    options: [{ id: 'a', label: 'Uno' }, { id: 'b', label: 'Dos' }],
    en: { prompt: 'Question in English', options: { a: 'One', b: 'Two' } }
  };
  const english = resolve(poll, 'en');
  assert.equal(english.prompt, 'Question in English');
  assert.deepEqual(english.options.map((option) => option.label), ['One', 'Two']);
  const spanish = resolve(poll, 'es');
  assert.equal(spanish.prompt, 'Pregunta en Español');
  assert.deepEqual(spanish.options.map((option) => option.label), ['Uno', 'Dos']);
  assert.deepEqual(poll.options.map((option) => option.label), ['Uno', 'Dos']);
});
