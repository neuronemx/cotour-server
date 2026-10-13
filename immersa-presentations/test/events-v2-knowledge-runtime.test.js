const test = require('node:test');
const assert = require('node:assert/strict');
const { EventKnowledgeRuntime, normalizeKnowledge } = require('../events-v2/knowledge-runtime');
const { KnowledgeActivityRepository } = require('../db/knowledge-activity-repository');
const engine = require('../knowledge-activity-engine');
const { definitions } = require('./helpers/events-v2-knowledge-suite');

test('knowledge preparation rejects ambiguous keys and legacy assets; normalization drops arbitrary private fields', () => {
  const definition = definitions()[0], question = definition.questions[0];
  assert.equal(normalizeKnowledge([{ ...definition, script: 'PRIVATE' }])[0].script, undefined);
  for (const input of [[definition, definition], [{ ...definition, questions: [{ ...question, image: { url: '/decks/private/knowledge-assets/question-a.png' } }] }],
    [{ ...definition, questions: [{ ...question, options: [{ ...question.options[0], correct: false }, { ...question.options[1], correct: true }] }] }],
    [{ ...definition, questions: [{ ...question, correctOptionId: 'missing' }] }]]) {
    assert.throws(() => normalizeKnowledge(input), { code: 'KNOWLEDGE_CONTENT_NOT_PREPARED' });
  }
});
test('Events knowledge repository requires a caller transaction and blocks legacy creation, restoration and history', async () => {
  const pool = { getConnection: async () => { throw new Error('nested connection'); }, execute: async () => { throw new Error('legacy pool'); } };
  assert.throws(() => new KnowledgeActivityRepository(pool, { storage: 'events-v2' }), /authorized transaction/);
  const statements = [];
  const db = { execute: async (sql, values) => { statements.push([sql, values]); return [[], []]; } };
  const repository = new KnowledgeActivityRepository(pool, { storage: 'events-v2', executor: db, transactionExecutor: operation => operation(db) });
  for (const operation of [() => repository.ensurePresentationSession({ deckId: 'private', sourceSessionId: 'run' }), () => repository.listHistory('private'), () => repository.listActiveExecutions()]) {
    await assert.rejects(operation(), { code: 'KNOWLEDGE_EVENTS_LIFECYCLE_NOT_ENABLED' });
  }
  assert.equal(statements.length, 0); await repository.loadActiveExecution({ deckId: 'private', sourceSessionId: 'scoped' });
  assert.match(statements[0][0], /event_v2_knowledge_executions/); assert.match(statements[0][0], /event_v2_knowledge_sessions/);
});
test('participant projection binds own answers and withholds grading; Player never receives private definition or assessment rows', async () => {
  const definition = definitions()[1], now = 100000;
  const run = engine.createExecution({ presentationSessionId: 'live', sourceSessionId: 'scoped', deckId: 'private', definition, nowMs: now });
  engine.joinParticipant(run, { participantId: 'self', name: 'Alice', tabId: 'self-tab', nowMs: now });
  engine.joinParticipant(run, { participantId: 'other', name: 'Other', tabId: 'other-tab', nowMs: now });
  engine.startExecution(run, now); engine.tickExecution(run, now + 4800);
  engine.submitAnswer(run, { participantId: 'self', tabId: 'self-tab', questionId: 'question', optionId: 'right', nowMs: now + 4900 });
  const runtime = new EventKnowledgeRuntime({ liveRuntime: {}, pool: {}, now: () => now + 5000 });
  runtime.scope = async () => ({ run, definitions: [definition] }); runtime.participantName = async () => 'Alice';
  const own = await runtime.projection({ kind: 'PARTICIPANT', eventId: 'event', participantId: 'self' }, {}, 'live', null, 'other-tab');
  assert.equal(own.execution.participant.tabActive, false); assert.equal(own.execution.answers.length, 1); assert.equal(JSON.stringify(own).includes('correctOptionId'), false);
  const other = await runtime.projection({ kind: 'PARTICIPANT', eventId: 'event', participantId: 'other' }, {}, 'live'); assert.equal(other.execution.answers.length, 0);
  engine.finalizeExecution(run, now + 5000); engine.tickExecution(run, now + 8100);
  const screen = await runtime.projection({ kind: 'PLAYER', eventId: 'event' }, {}, 'live');
  assert.equal(screen.execution.result, undefined); assert.equal(screen.execution.definitionsSnapshot, undefined); assert.equal(screen.execution.participants, undefined);
  const hidden = await runtime.projection({ kind: 'PARTICIPANT', eventId: 'event', participantId: 'self' }, {}, 'live'); assert.equal(hidden.execution.personalResult, null);
});
test('an unauthorized deadline cannot notify or mutate through a timer', async () => {
  let fire, notifications = 0;
  const runtime = new EventKnowledgeRuntime({ liveRuntime: { serial: async (_key, operation) => operation() }, pool: {}, now: () => 0,
    setTimeoutFn: callback => { fire = callback; return 1; }, clearTimeoutFn: () => {} });
  runtime.notify = async () => { notifications++; };
  runtime.schedule('event:live', { state: 'COUNTDOWN', countdownDeadlineAt: new Date(10).toISOString() }, { withSession: async () => { throw new Error('revoked'); } }, { eventId: 'event' }, 'live');
  await fire(); assert.equal(notifications, 0); assert.equal(runtime.timers.size, 0);
});

test('deadline witnesses prefer a scoped controller and reauthorize fallback after revocation', async () => {
  let fire, notifications = 0; const attempted = [];
  const runtime = new EventKnowledgeRuntime({ liveRuntime: {}, pool: {}, now: () => 0,
    setTimeoutFn: callback => { fire = callback; return 1; }, clearTimeoutFn: () => {} });
  runtime.notify = async () => { notifications++; };
  runtime.operate = async (_grants, credentials) => { attempted.push(credentials.grantId); if (credentials.grantId === 'revoked') throw new Error('revoked'); };
  const run = { state: 'COUNTDOWN', countdownDeadlineAt: new Date(10).toISOString() };
  runtime.schedule('event:live', run, {}, { grantId: 'valid' }, 'live', 'PLAYER');
  runtime.schedule('event:live', run, {}, { grantId: 'revoked' }, 'live', 'STAGE');
  runtime.schedule('event:live', run, {}, { grantId: 'public' }, 'live', 'PARTICIPANT');
  await fire(); assert.deepEqual(attempted, ['revoked', 'valid']); assert.equal(notifications, 1);
});
