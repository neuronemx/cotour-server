const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const raffle = require('../events-v2/rehearsal-raffle');
const ui = require('../public/events-v2/rehearsal-raffle');
function fixture(mode = 'free') {
  const definition = { id: 'own-raffle', mode, title: '<Sorteo>', prompt: 'Participa', entryKey: mode === 'visual_key' ? 'a' : '',
    options: mode === 'free' ? [] : ['a', 'b', ...(mode === 'visual_key' ? ['c', 'd'] : [])].map(id => ({ id, label: 'Opción ' + id })) };
  const candidate = { configuration: { raffles: [definition] }, snapshot: { bundleDigest: 'a'.repeat(64) }, rehearsalImages: [] };
  let state, now = 1000000;
  const runId = crypto.randomUUID(), root = '/api/events-v2/rehearsal/' + crypto.randomUUID() + '/' + crypto.randomUUID();
  return { definition, candidate, runId, root, get state() { return state; },
    command(input) { state = raffle.operate(state, raffle.definitions(candidate), { raffleRunId: state?.latestRunId, ...input }, now); return this.view(); },
    advance(ms) { now += ms; state = raffle.advance(state, now); return this.view(); },
    view() { const view = { runId, tools: { raffle: raffle.projection(candidate, state, root, runId, now) } }; ui.validate(view, root); return view.tools.raffle; } };
}
test('free rehearsal rejects empty closure, issues a sample ticket, hides its winner and reveals at the server deadline', () => {
  const f = fixture(); f.command({ command: 'open', definitionId: 'own-raffle' });
  const before = structuredClone(f.state);
  assert.throws(() => f.command({ command: 'close_entries' }), { code: 'REHEARSAL_RAFFLE_NO_ENTRIES' }); assert.deepEqual(f.state, before);
  let v = f.command({ command: 'enter', sampleId: null, name: '<Persona de prueba>' }); const sampleId = v.samples[0].id;
  assert.equal(v.controller.entries[0].ticketNumber, 1); assert.equal(v.controller.ticketDigits, 2);
  f.command({ command: 'enter', sampleId, name: '<Persona de prueba>' }); assert.equal(f.view().controller.entryCount, 1);
  f.command({ command: 'close_entries' }); v = f.command({ command: 'draw' });
  assert.equal(v.controller.state, 'drawing'); assert.equal(v.controller.winner, null); assert.equal(v.screen.winner, undefined);
  assert.equal(JSON.stringify(v.screen).includes('pendingWinner'), false);
  v = f.advance(4999); assert.equal(v.controller.state, 'drawing'); v = f.advance(1);
  assert.equal(v.controller.state, 'winner'); assert.equal(v.screen.winner.name, '<Persona de prueba>'); assert.equal(v.previousWinnerCount, 1);
  v = f.command({ command: 'close' }); assert.equal(v.controller, null); assert.equal(v.samples.length, 1); assert.equal(v.winners.length, 1);
});
test('previous sample winners cannot win a new round until the operator resets winners; pending draws cannot survive close', () => {
  const f = fixture(); f.command({ command: 'open', definitionId: 'own-raffle' }); let v = f.command({ command: 'enter', sampleId: null, name: 'One' }); const sampleId = v.samples[0].id;
  f.command({ command: 'close_entries' }); f.command({ command: 'draw' }); f.command({ command: 'reveal' }); f.command({ command: 'close' });
  f.command({ command: 'open', definitionId: 'own-raffle' }); f.command({ command: 'enter', sampleId, name: 'One' }); v = f.command({ command: 'close_entries' });
  assert.equal(v.controller.eligibleCount, 0); assert.throws(() => f.command({ command: 'draw' }), { code: 'REHEARSAL_RAFFLE_NO_ELIGIBLE_ENTRIES' });
  v = f.command({ command: 'reset_winners' }); assert.equal(v.controller.eligibleCount, 1); assert.equal(v.winners.length, 0);
  f.command({ command: 'draw' }); f.command({ command: 'close' }); v = f.advance(10000); assert.equal(v.screen, null); assert.equal(v.winners.length, 0);
});
test('poll raffle uses one response per sample and the existing results and draw selection', () => {
  const f = fixture('poll'); f.command({ command: 'open', definitionId: 'own-raffle' });
  let v = f.command({ command: 'enter', sampleId: null, name: 'First', optionId: 'a' }); const id = v.samples[0].id;
  assert.throws(() => f.command({ command: 'enter', sampleId: id, name: 'First', optionId: 'b' }), { code: 'REHEARSAL_RAFFLE_DUPLICATE_ENTRY' });
  v = f.command({ command: 'enter', sampleId: null, name: 'Second', optionId: 'b' });
  assert.equal(v.controller.pollResults.totalResponses, 2); assert.equal(v.controller.pollResults.options[0].count, 1);
  f.command({ command: 'close_entries' }); f.command({ command: 'draw' }); v = f.advance(5000); assert.ok(['First', 'Second'].includes(v.screen.winner.name));
});
test('visual key can change before opening; only matching selections enter and changing a sample selection is reversible', () => {
  const f = fixture('visual_key'); f.command({ command: 'configure_key', definitionId: 'own-raffle', optionId: 'b' }); let v = f.command({ command: 'open', definitionId: 'own-raffle' });
  assert.equal(v.screen.displayOption.id, 'b'); assert.equal(v.screen.options.length, 0); assert.equal(v.screen.entryKey, undefined);
  v = f.command({ command: 'enter', sampleId: null, name: 'Practice', optionId: 'a' }); const sampleId = v.samples[0].id;
  assert.equal(v.controller.matchingSelectionCount, 0); assert.throws(() => f.command({ command: 'close_entries' }), { code: 'REHEARSAL_RAFFLE_NO_ENTRIES' });
  f.command({ command: 'enter', sampleId, name: 'Practice', optionId: 'b' }); v = f.command({ command: 'close_entries' });
  assert.equal(v.controller.entryCount, 1); assert.equal(v.controller.entries[0].selectedOptionId, 'b');
  f.command({ command: 'draw' }); v = f.command({ command: 'reveal' }); assert.equal(v.screen.winner.name, 'Practice');
});
test('sample bounds, stale runs, foreign sample IDs and invalid text/options preserve previous state', () => {
  const f = fixture(); f.command({ command: 'open', definitionId: 'own-raffle' }); const original = structuredClone(f.state);
  for (const input of [{ sampleId: crypto.randomUUID(), name: 'Foreign' }, { sampleId: null, name: '' }, { sampleId: null, name: 'x'.repeat(121) }, { sampleId: null, name: 'One', optionId: 'a' }])
    assert.throws(() => f.command({ command: 'enter', ...input }));
  assert.deepEqual(f.state, original);
  assert.throws(() => f.command({ command: 'draw', raffleRunId: crypto.randomUUID() }), { code: 'REHEARSAL_RAFFLE_STALE_EXECUTION' });
  for (let i = 0; i < raffle.MAX_SAMPLES; i++) f.command({ command: 'enter', sampleId: null, name: 'Sample ' + i });
  assert.throws(() => f.command({ command: 'enter', sampleId: null, name: 'Overflow' }), { code: 'REHEARSAL_RAFFLE_LIMIT' }); assert.equal(f.view().samples.length, 20);
});
test('visual assets stay bound to the private rehearsal, approved catalog and current raffle; image URLs and leaked pending winners fail closed', () => {
  const f = fixture('visual_key'), assetId = crypto.randomUUID(), foreignId = crypto.randomUUID();
  f.definition.options[0].imageAssetId = assetId; f.candidate.rehearsalImages = [{ id: assetId, width: 64, height: 32 }];
  let v = f.view(); assert.ok(v.available[0].keyOptions[0].image.url.includes('/catalog/' + assetId));
  assert.equal(raffle.allowedImage(f.candidate, f.state, 'catalog', assetId), true); assert.equal(raffle.allowedImage(f.candidate, f.state, 'catalog', foreignId), false);
  v = f.command({ command: 'open', definitionId: 'own-raffle' }); const id = v.raffleRunId;
  assert.ok(v.screen.displayOption.image.url.includes('/' + id + '/' + assetId)); assert.equal(raffle.allowedImage(f.candidate, f.state, id, assetId), true);
  const bad = { runId: f.runId, tools: { raffle: structuredClone(v) } }; bad.tools.raffle.screen.pendingWinner = { name: 'leak' };
  assert.throws(() => ui.validate(bad, f.root), /INVALID_REHEARSAL_RAFFLE/); delete bad.tools.raffle.screen.pendingWinner;
  bad.tools.raffle.available[0].keyOptions[0].image.url = 'https://foreign.invalid/x.png'; assert.throws(() => ui.validate(bad, f.root), /INVALID_REHEARSAL_RAFFLE/);
  f.command({ command: 'close' }); assert.equal(raffle.allowedImage(f.candidate, f.state, id, assetId), false);
});
