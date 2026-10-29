const engine = require('../knowledge-activity-engine');
const { normalizeKnowledge } = require('./knowledge-runtime');
const { EventAccessError } = require('./authorization');
const sample = 'private-rehearsal-sample', tab = 'private-rehearsal-tab';
const fail = (code, status = 409) => { throw new EventAccessError(code, status); };
const actions = { start: engine.startExecution, finalize: engine.finalizeExecution,
  show_results: engine.showResults, retry_processing: engine.retryProcessing,
  force_results: (run, now) => engine.forceResults(run, { nowMs: now }) };
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 96 && value.trim() === value;
function nextDeadline(run) {
  const key = run.state === 'COUNTDOWN' ? 'countdownDeadlineAt' : run.state === 'PROCESSING' ? 'processingReadyAt'
    : run.state === 'ACTIVE' ? (run.category === 'assessment' ? 'deadlineAt' : run.substate === 'REVEAL' ? 'revealDeadlineAt' : 'questionDeadlineAt') : null;
  const value = key ? Date.parse(run[key]) : NaN; return Number.isFinite(value) ? value : null;
}
function definitions(candidate) { return normalizeKnowledge(candidate.configuration?.knowledge || []); }
function active(run) { return !!run && !engine.TERMINAL_STATES.has(run.state); }
function advance(previous, now) {
  if (!active(previous)) return previous;
  const next = structuredClone(previous);
  engine.tickExecution(next, now);
  return next.revision === previous.revision ? previous : next;
}
// Only the pure engine is reused. No live adapter, SQL repository, real
// participant, recovery token, history or background timer is constructed.
function operate(previous, catalog, input, now) {
  let next = previous ? structuredClone(previous) : null;
  try {
    if (input.command === 'open') {
      if (active(next)) fail('REHEARSAL_INTERACTION_BUSY');
      const definition = catalog.find(d => d.id === input.definitionId);
      if (!definition) fail('REHEARSAL_KNOWLEDGE_NOT_FOUND');
      next = engine.createExecution({ presentationSessionId: 'private-rehearsal', sourceSessionId: 'private-rehearsal',
        deckId: 'private-rehearsal', definition, nowMs: now });
      engine.joinParticipant(next, { participantId: sample, name: definition.identificationMode === 'anonymous' ? '' : 'Persona de prueba', tabId: tab, nowMs: now });
    } else {
      if (!active(next) || input.executionId !== next.id) fail('REHEARSAL_KNOWLEDGE_STALE_EXECUTION');
      if (input.command === 'answer') {
        if (!token(input.questionId) || !token(input.optionId)) fail('INVALID_INPUT', 400);
        engine.submitAnswer(next, { participantId: sample, tabId: tab, questionId: input.questionId, optionId: input.optionId, nowMs: now });
      } else if (input.command === 'submit') engine.submitAssessment(next, { participantId: sample, tabId: tab, nowMs: now });
      else if (input.command === 'close' || input.command === 'cancel') {
        (input.command === 'close' ? engine.closeExecution : engine.cancelExecution)(next, now);
        return null; // Discard the sample, answers, result and engine command log.
      } else if (Object.hasOwn(actions, input.command)) actions[input.command](next, now);
      else fail('INVALID_INPUT', 400);
    }
  } catch (error) {
    if (error instanceof engine.KnowledgeActivityError) fail('REHEARSAL_KNOWLEDGE_' + error.code);
    throw error;
  }
  return next;
}
function projection(candidate, run, root, rehearsalRunId, now) {
  const available = definitions(candidate).map(({ id, title, titleEn, category }) => ({ id, title, titleEn, category }));
  if (!active(run)) return { available, executionId: null, definitionId: null, screen: null, sample: null, nextDeadlineAt: null };
  const screen = structuredClone(engine.stateForRole(run, { role: 'screen', nowMs: now }));
  const audience = engine.stateForRole(run, { role: 'audience', participantId: sample, tabId: tab, nowMs: now });
  // Keep the sample view's established reveal/grade timing. No definition or
  // answer key is serialized before the engine authorizes its display.
  const sampleView = Object.fromEntries(['currentQuestion', 'questions', 'answers', 'answerCount', 'questionCount',
    'reveal', 'personalResult', 'submissionReceipt'].map(key => [key, structuredClone(audience[key] ?? null)]));
  sampleView.submitted = !!audience.participant?.submittedAt;
  const originals = candidate.configuration.knowledge.find(d => d.id === run.definitionId).questions;
  const attach = question => {
    const id = originals.find(q => q.id === question?.id)?.imageAssetId;
    if (!question || !id) return question;
    const row = candidate.rehearsalImages?.find(r => r.id === id);
    if (!row) fail('INTERACTION_IMAGE_NOT_PREPARED', 403);
    return { ...question, image: { url: root + '/question-images/' + rehearsalRunId + '/' + candidate.snapshot.bundleDigest + '/' + run.id + '/' + id,
      width: row.width, height: row.height } };
  };
  screen.currentQuestion = attach(screen.currentQuestion);
  sampleView.currentQuestion = attach(sampleView.currentQuestion);
  if (sampleView.questions) sampleView.questions = sampleView.questions.map(attach);
  return { available, executionId: run.id, definitionId: run.definitionId, screen, sample: sampleView, nextDeadlineAt: nextDeadline(run) };
}
function visibleAssetIds(candidate, run, now) {
  if (!active(run)) return [];
  const view = projection(candidate, run, '', '', now);
  const visible = [view.screen.currentQuestion, view.sample.currentQuestion, ...(view.sample.questions || [])].filter(Boolean).map(q => q.id);
  return candidate.configuration.knowledge.find(d => d.id === run.definitionId).questions.filter(q => visible.includes(q.id)).map(q => q.imageAssetId).filter(Boolean);
}
module.exports = { definitions, active, advance, operate, projection, visibleAssetIds };
