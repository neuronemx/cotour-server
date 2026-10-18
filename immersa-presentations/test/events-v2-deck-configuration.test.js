const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfiguration, MAX_CONFIGURATION_BYTES } = require('../events-v2/deck-configuration');
const { configurationFixture } = require('./helpers/events-v2-configuration-fixture');
const { normalizePolls } = require('../events-v2/poll-runtime');
const { normalizeKnowledge } = require('../events-v2/knowledge-runtime');
const { normalizeRaffles } = require('../events-v2/raffle-runtime');
const { normalizeGames } = require('../events-v2/game-runtime');
test('authored text catalogs reuse runtime normalization and preserve private notes and slide references', () => {
  const input = configurationFixture(), before = structuredClone(input), out = normalizeConfiguration(input, 2);
  assert.deepEqual(out.polls, normalizePolls(input.polls)); assert.deepEqual(out.knowledge, normalizeKnowledge(input.knowledge));
  assert.deepEqual(out.raffles, normalizeRaffles(input.raffles)); assert.deepEqual(out.games, normalizeGames(input.games));
  assert.deepEqual(out.slides[0].notes, input.slides[0].notes); assert.deepEqual(out.slides[0].knowledgeIds, ['quiz-a']);
  assert.deepEqual(out.slides[1].pollIds, []); assert.deepEqual(input, before);
  assert.deepEqual(normalizeConfiguration(input, 2), out);
});
test('configuration rejects paths, runtime state, unsupported binary media and translated slide images at every input boundary', () => {
  const edits = [x => { x.av = []; }, x => { x.approved = true; }, x => { x.slides[0].full = '/decks/public'; },
    x => { x.slides[0].notes.fr = 'unsupported'; }, x => { x.polls[0].source = 'personal'; }, x => { x.polls[0].options[0].image = '/private'; },
    x => { x.knowledge[0].questions[0].image = { url: '/decks/other' }; }, x => { x.knowledge[0].createdAt = 'forged'; },
    x => { x.raffles[0].options = [{ id: 'a', label: 'A', image: 'https://foreign' }]; }, x => { x.games[0].state = {}; }];
  for (const edit of edits) { const input = configurationFixture(); edit(input); assert.throws(() => normalizeConfiguration(input, 2), { code: 'INVALID_CONFIGURATION' }); }
});
test('configuration refuses missing, duplicate or reordered slides and dangling or duplicate interaction references', () => {
  const edits = [x => x.slides.pop(), x => x.slides.reverse(), x => { x.slides[1].id = 'slide-001'; },
    x => { x.slides[0].pollIds = ['foreign']; }, x => { x.slides[0].pollIds = ['poll-a', 'poll-a']; },
    x => { x.knowledge[0].id = 'poll-a'; }, x => { x.polls[0].en.options.foreign = 'Unknown'; }];
  for (const edit of edits) { const input = configurationFixture(); edit(input); assert.throws(() => normalizeConfiguration(input, 2), { code: 'INVALID_CONFIGURATION' }); }
});
test('invalid engine definitions, coercible durations and unbounded text fail instead of being repaired silently', () => {
  const edits = [x => { x.polls[0].options = []; }, x => { x.knowledge[0].questions[0].options[0].correct = 'true'; },
    x => { x.knowledge[0].questionDurationSeconds = '15'; }, x => { x.knowledge[0].questionDurationSeconds = 301; },
    x => { x.knowledge[0].questions[0].correctOptionId = 'missing'; }, x => { x.games[0].durationMs = 0; },
    x => { x.slides[0].notes.es = 'a'.repeat(8001); }, x => { x.polls[0].title = 'bad\u0000text'; },
    x => { x.polls[0].en.prompt = 'a'.repeat(2001); }];
  for (const edit of edits) { const input = configurationFixture(); edit(input); assert.throws(() => normalizeConfiguration(input, 2), { code: 'INVALID_CONFIGURATION' }); }
});
test('configuration byte limit applies before normalizing the resource graph', () => {
  const input = configurationFixture(); input.slides[0].notes.es = 'a'.repeat(MAX_CONFIGURATION_BYTES);
  assert.throws(() => normalizeConfiguration(input, 2), { code: 'CONFIGURATION_TOO_LARGE', statusCode: 413 });
});
