const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const k = require('../events-v2/rehearsal-knowledge');
const ui = require('../public/events-v2/rehearsal-knowledge');
const engine = require('../knowledge-activity-engine');
const now = Date.parse('2026-10-29T12:00:00Z');
const definition = category => ({ id: category, title: '<Prueba>', titleEn: 'Practice', category, identificationMode: 'required_name', questionDurationSeconds: 5, durationSeconds: 30,
  questions: ['one', 'two'].map(id => ({ id, prompt: 'Pregunta ' + id, en: { prompt: 'Question ' + id, options: { a: 'First', b: 'Second' } },
    correctOptionId: 'a', options: [{ id: 'a', label: 'Primera' }, { id: 'b', label: 'Segunda' }] })) });
function fixture(category = 'contest') {
  const candidate = { configuration: { knowledge: [definition(category)] }, snapshot: { bundleDigest: 'a'.repeat(64), images: [] } };
  const runId = crypto.randomUUID(), root = '/api/events-v2/rehearsal/' + crypto.randomUUID() + '/' + crypto.randomUUID();
  const catalog = k.definitions(candidate); let run, clock = now;
  return { candidate, runId, root, catalog, get run() { return run; }, set run(value) { run = value; },
    command(input) { run = k.operate(run, catalog, { executionId: run?.id, ...input }, clock); return run; },
    advance(ms) { clock += ms; run = k.advance(run, clock); },
    view() { const view = { runId, tools: { knowledge: k.projection(candidate, run, root, runId, clock) } }; ui.validate(view, root); return view.tools.knowledge; } };
}
test('contest rehearsal uses the pure engine, accepts one sample answer and reveals only after its deadline', () => {
  const f = fixture(); f.command({ command: 'open', definitionId: 'contest' });
  assert.equal(f.run.participants.length, 1); assert.equal(f.view().screen.state, 'LOBBY');
  assert.equal(f.view().sample.currentQuestion, null); f.command({ command: 'start' });
  f.advance(engine.COUNTDOWN_MS); let v = f.view(); assert.equal(v.screen.state, 'ACTIVE');
  const questionId = v.sample.currentQuestion.id;
  assert.equal(JSON.stringify(v).includes('correctOptionId'), false);
  f.command({ command: 'answer', questionId, optionId: 'a' });
  assert.throws(() => f.command({ command: 'answer', questionId, optionId: 'b' }), { code: 'REHEARSAL_KNOWLEDGE_DUPLICATE' });
  f.advance(5000); v = f.view(); assert.equal(v.sample.reveal.correctOptionId, 'a'); assert.equal(v.screen.reveal.correctLabel, 'Primera');
  f.advance(engine.REVEAL_MS); v = f.view(); assert.notEqual(v.sample.currentQuestion.id, questionId);
  f.command({ command: 'answer', questionId: v.sample.currentQuestion.id, optionId: 'b' });
  f.advance(5000); f.advance(engine.REVEAL_MS); f.advance(engine.RECONCILIATION_MS);
  v = f.view(); assert.equal(v.screen.state, 'RESULTS_VISIBLE'); assert.equal(v.sample.personalResult.correctCount, 1); assert.equal(v.nextDeadlineAt, null);
  f.command({ command: 'close' }); assert.equal(f.run, null); assert.equal(f.view().screen, null);
});
test('assessment answers can change until delivery; the receipt hides its grade until results are shown', () => {
  const f = fixture('assessment'); f.command({ command: 'open', definitionId: 'assessment' }); f.command({ command: 'start' }); f.advance(engine.COUNTDOWN_MS);
  assert.equal(f.view().sample.questions.length, 2);
  f.command({ command: 'answer', questionId: 'one', optionId: 'b' }); f.command({ command: 'answer', questionId: 'one', optionId: 'a' });
  f.command({ command: 'submit' }); let v = f.view(); assert.equal(v.sample.submissionReceipt.answeredCount, 1); assert.equal(v.sample.submissionReceipt.grade, undefined);
  assert.equal(v.sample.questions.length, 0);
  assert.throws(() => f.command({ command: 'answer', questionId: 'two', optionId: 'a' }), { code: 'REHEARSAL_KNOWLEDGE_INVALID_STATE' });
  f.command({ command: 'finalize' }); f.advance(engine.RECONCILIATION_MS); v = f.view();
  assert.equal(v.screen.state, 'RESULTS_READY'); assert.equal(v.sample.personalResult, null); assert.equal(v.nextDeadlineAt, null);
  f.command({ command: 'show_results' }); v = f.view(); assert.equal(v.sample.personalResult.grade, 50); assert.equal(v.sample.submissionReceipt.grade, 50);
  f.command({ command: 'close' }); assert.equal(f.view().executionId, null);
});
test('copy-on-write, stale execution and invalid fields never alter an admitted run', () => {
  const f = fixture(); f.command({ command: 'open', definitionId: 'contest' }); const before = structuredClone(f.run);
  assert.throws(() => f.command({ command: 'open', definitionId: 'contest' }), { code: 'REHEARSAL_INTERACTION_BUSY' });
  assert.throws(() => f.command({ command: 'cancel', executionId: crypto.randomUUID() }), { code: 'REHEARSAL_KNOWLEDGE_STALE_EXECUTION' });
  assert.throws(() => f.command({ command: 'answer', questionId: {}, optionId: 'a' }), { code: 'INVALID_INPUT' });
  assert.deepEqual(f.run, before); f.command({ command: 'start' });
  f.command({ command: 'finalize' }); f.advance(engine.RECONCILIATION_MS);
  assert.equal(f.view().nextDeadlineAt, null, 'finalizing during countdown cannot retain a stale refresh deadline');
  f.command({ command: 'close' }); f.command({ command: 'open', definitionId: 'contest' }); assert.notEqual(f.run.id, before.id);
  f.command({ command: 'cancel' }); assert.equal(f.run, null);
});
test('assessment deadlines complete without delivery; no sample history survives cancel', () => {
  const f = fixture('assessment'); f.command({ command: 'open', definitionId: 'assessment' }); f.command({ command: 'start' }); f.advance(engine.COUNTDOWN_MS);
  f.command({ command: 'answer', questionId: 'one', optionId: 'a' }); f.advance(30000); f.advance(engine.RECONCILIATION_MS);
  assert.equal(f.view().screen.state, 'RESULTS_READY'); assert.equal(f.view().sample.personalResult, null);
  f.command({ command: 'show_results' }); assert.equal(f.view().sample.personalResult.grade, 50);
  f.command({ command: 'cancel' }); assert.equal(f.run, null);
});
test('question images are tied to the rehearsal run, execution and visible question; foreign image destinations fail closed', () => {
  const f = fixture('assessment'), assetId = crypto.randomUUID();
  f.candidate.configuration.knowledge[0].questions[0].imageAssetId = assetId;
  f.candidate.rehearsalImages = [{ id: assetId, width: 64, height: 32 }];
  f.command({ command: 'open', definitionId: 'assessment' }); assert.deepEqual(k.visibleAssetIds(f.candidate, f.run, now), []);
  f.command({ command: 'start' }); f.advance(engine.COUNTDOWN_MS);
  const view = f.view(), image = view.sample.questions.find(q => q.id === 'one').image;
  assert.ok(image.url.includes(f.runId + '/' + 'a'.repeat(64) + '/' + f.run.id + '/' + assetId)); assert.equal(image.width, 64);
  assert.deepEqual(k.visibleAssetIds(f.candidate, f.run, now + engine.COUNTDOWN_MS), [assetId]);
  const bad = { runId: f.runId, tools: { knowledge: structuredClone(view) } }; bad.tools.knowledge.sample.questions[0].image = { ...image, url: 'https://foreign.invalid/image.png' };
  assert.throws(() => ui.validate(bad, f.root), /INVALID_REHEARSAL_KNOWLEDGE/);
  f.command({ command: 'answer', questionId: 'one', optionId: 'a' }); f.command({ command: 'submit' }); assert.deepEqual(k.visibleAssetIds(f.candidate, f.run, now + engine.COUNTDOWN_MS), []);
});
