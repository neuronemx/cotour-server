const { randomUUID } = require('node:crypto');
const { QNA_SUBMISSION_COOLDOWN_MS, requiredText, optionalText } = require('../qna-values');
const { EventAccessError } = require('./authorization');
const MAX_QUESTIONS = 20;
const fail = (code, status = 409) => { throw new EventAccessError(code, status); };
function initial(number = 1, open = true) {
  return { roundId: randomUUID(), roundNumber: number, questionsOpen: open, questions: [],
    selectedQuestionId: null, projectedQuestionId: null, lastSubmittedAt: null };
}
// Private practice state only. It never constructs a SQL Q&A session,
// participant, projection or history record, nor calls the live adapter.
function operate(previous, input, now) {
  if (input.command === 'open') return previous ? structuredClone(previous) : initial();
  if (!previous || input.roundId !== previous.roundId) fail('REHEARSAL_QNA_STALE_ROUND');
  const next = structuredClone(previous);
  if (input.command === 'submit') {
    if (typeof input.question !== 'string' || typeof input.name !== 'string' || typeof input.allowNameOnScreen !== 'boolean') fail('INVALID_INPUT', 400);
    let question, name;
    try { question = requiredText(input.question, 'question', 1000); name = optionalText(input.name, 120) || ''; }
    catch (_) { fail('INVALID_INPUT', 400); }
    if (!next.questionsOpen) fail('REHEARSAL_QNA_CLOSED');
    if (next.questions.length >= MAX_QUESTIONS) fail('REHEARSAL_QNA_LIMIT');
    if (next.lastSubmittedAt !== null && now - next.lastSubmittedAt < QNA_SUBMISSION_COOLDOWN_MS) fail('REHEARSAL_QNA_COOLDOWN', 429);
    next.questions.push({ id: randomUUID(), text: question, name, allowNameOnScreen: input.allowNameOnScreen,
      status: 'new', answered: false, createdAt: now });
    next.lastSubmittedAt = now;
  } else if (input.command === 'set_open') {
    if (typeof input.open !== 'boolean') fail('INVALID_INPUT', 400);
    next.questionsOpen = input.open;
  } else if (input.command === 'new_round') {
    if (next.roundNumber >= 1000000) fail('REHEARSAL_QNA_LIMIT');
    return initial(next.roundNumber + 1, next.questionsOpen);
  } else if (input.command === 'panel_close') next.projectedQuestionId = null;
  else if (['select', 'project', 'delete'].includes(input.command)) {
    const question = next.questions.find(q => q.id === input.questionId);
    if (!question) fail('REHEARSAL_QNA_QUESTION_NOT_FOUND');
    if (input.command === 'delete') {
      if (question.answered) fail('REHEARSAL_QNA_ALREADY_PROJECTED');
      next.questions = next.questions.filter(q => q.id !== question.id);
      if (next.selectedQuestionId === question.id) next.selectedQuestionId = null;
    } else {
      for (const q of next.questions) q.status = q.id === question.id ? 'selected' : 'new';
      next.selectedQuestionId = question.id;
      if (input.command === 'project') { question.answered = true; next.projectedQuestionId = question.id; }
    }
  } else fail('INVALID_INPUT', 400);
  return next;
}
function projection(state, now) {
  const q = state?.questions.find(q => q.id === state.projectedQuestionId);
  return { roundId: state?.roundId || null, roundNumber: state?.roundNumber || 0, questionsOpen: state?.questionsOpen || false,
    questions: state ? structuredClone(state.questions) : [], selectedQuestionId: state?.selectedQuestionId || null,
    screen: { visible: !!q, question: q ? { id: q.id, text: q.text, name: q.allowNameOnScreen ? q.name : '' } : null },
    cooldownRemainingMs: state?.lastSubmittedAt === null || !state ? 0 : Math.min(QNA_SUBMISSION_COOLDOWN_MS, Math.max(0, QNA_SUBMISSION_COOLDOWN_MS - (now - state.lastSubmittedAt))),
    maxQuestions: MAX_QUESTIONS };
}
module.exports = { operate, projection, MAX_QUESTIONS };
