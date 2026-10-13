const test = require('node:test');
const assert = require('node:assert/strict');
const { QnaRepository } = require('../db/qna-repository');
test('Events Q&A SQL reuses the granted transaction and isolated fixed tables', async () => {
  const pool = { getConnection() { throw new Error('nested connection'); } };
  const statements = [];
  const db = { async execute(sql, values) { statements.push({ sql, values }); return sql.includes('SELECT') ? [[{ id: 'round', round_number: 1, questions_open: 1 }]] : [{ affectedRows: 1 }]; } };
  const repository = new QnaRepository(pool, { storage: 'events-v2', executor: db, transactionExecutor: operation => operation(db) });
  await repository.setQuestionsOpen({ presentationSessionId: 'live', open: false });
  assert.equal(statements.length, 2); assert.ok(statements.every(({ sql }) => sql.includes('event_v2_qna_rounds')));
  await assert.rejects(repository.startPresentationSession({ deckId: 'deck', sourceSessionId: 'live' }), { code: 'QNA_EVENTS_LIFECYCLE_NOT_ENABLED' });
  await assert.rejects(repository.listExportQuestionsByDeck('deck'), { code: 'QNA_EVENTS_LIFECYCLE_NOT_ENABLED' });
  assert.equal(statements.length, 2);
});
test('Events Q&A cannot construct a standalone ungranted storage executor', () => {
  assert.throws(() => new QnaRepository({ getConnection() {} }, { storage: 'events-v2' }), /authorized transaction/);
  assert.throws(() => new QnaRepository({ getConnection() {} }, { storage: 'client-table' }), /Invalid Q&A storage/);
});
