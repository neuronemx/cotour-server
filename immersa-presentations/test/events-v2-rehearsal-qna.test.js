const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { operate, projection, MAX_QUESTIONS } = require('../events-v2/rehearsal-qna');
const { QnaError, QNA_SUBMISSION_COOLDOWN_MS } = require('../qna-values');
test('Q&A shares established value validation and cooldown without changing repository exports', () => {
  const repository = require('../db/qna-repository');
  assert.equal(repository.QnaError, QnaError); assert.equal(repository.QNA_SUBMISSION_COOLDOWN_MS, QNA_SUBMISSION_COOLDOWN_MS);
  const q = operate(null, { command: 'open' }, 0);
  for (const input of [{ question: '' }, { question: 'x'.repeat(1001) }, { name: 'x'.repeat(121) }, { allowNameOnScreen: 'yes' }])
    assert.throws(() => operate(q, { command: 'submit', roundId: q.roundId, question: 'Own', name: '', allowNameOnScreen: false, ...input }, 0), { code: 'INVALID_INPUT' });
});
test('private Q&A opens intake, selects/projects with explicit name consent and preserves answered questions', () => {
  let q = operate(null, { command: 'open' }, 0);
  const apply = input => { q = operate(q, { roundId: q.roundId, ...input }, 0); return projection(q, 0); };
  apply({ command: 'submit', question: '  <Private question>  ', name: ' Hidden name ', allowNameOnScreen: false });
  const id = q.questions[0].id;
  apply({ command: 'select', questionId: id }); assert.equal(q.selectedQuestionId, id);
  const screen = apply({ command: 'project', questionId: id }).screen;
  assert.equal(screen.question.text, '<Private question>'); assert.equal(screen.question.name, '');
  assert.throws(() => apply({ command: 'delete', questionId: id }), { code: 'REHEARSAL_QNA_ALREADY_PROJECTED' });
  apply({ command: 'panel_close' }); assert.equal(projection(q, 0).screen.visible, false); assert.equal(q.questions.length, 1); assert.equal(q.questionsOpen, true);
  apply({ command: 'new_round' });
  apply({ command: 'submit', question: 'Another', name: 'Visible sample', allowNameOnScreen: true });
  assert.equal(apply({ command: 'project', questionId: q.questions[0].id }).screen.question.name, 'Visible sample');
});
test('copy-on-write preserves previous state on errors, stale rounds and foreign question IDs', () => {
  const q = operate(null, { command: 'open' }, 1), before = structuredClone(q);
  const next = operate(q, { command: 'submit', roundId: q.roundId, question: 'Own', name: '', allowNameOnScreen: false }, 1);
  assert.deepEqual(q, before); assert.equal(next.questions.length, 1);
  assert.throws(() => operate(next, { command: 'project', roundId: crypto.randomUUID(), questionId: next.questions[0].id }, 2), { code: 'REHEARSAL_QNA_STALE_ROUND' });
  assert.throws(() => operate(next, { command: 'project', roundId: next.roundId, questionId: crypto.randomUUID() }, 2), { code: 'REHEARSAL_QNA_QUESTION_NOT_FOUND' });
});
test('cooldown, closure and bounded rounds prevent unbounded rehearsal questions or archives', () => {
  let now = 0, q = operate(null, { command: 'open' }, now);
  const submit = () => { q = operate(q, { command: 'submit', roundId: q.roundId, question: 'Sample', name: '', allowNameOnScreen: false }, now); };
  submit(); assert.throws(submit, { code: 'REHEARSAL_QNA_COOLDOWN' });
  assert.equal(projection(q, -100).cooldownRemainingMs, 10000);
  q = operate(q, { command: 'set_open', roundId: q.roundId, open: false }, now); now += QNA_SUBMISSION_COOLDOWN_MS;
  assert.throws(submit, { code: 'REHEARSAL_QNA_CLOSED' });
  const oldRound = q.roundId; q = operate(q, { command: 'new_round', roundId: oldRound }, now);
  assert.notEqual(q.roundId, oldRound); assert.equal(q.questionsOpen, false); assert.equal(q.questions.length, 0);
  q = operate(q, { command: 'set_open', roundId: q.roundId, open: true }, now);
  for (let n = 0; n < MAX_QUESTIONS; n++) { submit(); now += QNA_SUBMISSION_COOLDOWN_MS; }
  assert.throws(submit, { code: 'REHEARSAL_QNA_LIMIT' });
  const next = operate(q, { command: 'new_round', roundId: q.roundId }, now); assert.equal(next.questions.length, 0); assert.equal(next.history, undefined);
});
