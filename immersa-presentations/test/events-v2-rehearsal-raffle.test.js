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
test('deferred raffle modes are hidden and rejected even if directly injected into the adapter catalog', () => {
  for (const mode of ['poll', 'visual_key']) {
    const f = fixture(mode); assert.deepEqual(f.view().available, []);
    assert.throws(() => f.command({ command: 'open', definitionId: 'own-raffle' }), { code: 'REHEARSAL_RAFFLE_NOT_FOUND' });
    assert.throws(() => raffle.operate(undefined, [f.definition], { command: 'open', definitionId: 'own-raffle' }, 1000), { code: 'REHEARSAL_RAFFLE_NOT_FOUND' });
    assert.throws(() => f.command({ command: 'configure_key', definitionId: 'own-raffle', optionId: 'b' }), { code: 'REHEARSAL_RAFFLE_NOT_FOUND' });
    assert.equal(f.state, undefined);
  }
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
test('deferred visual raffle assets are not exposed, and a leaked pending winner still fails closed', () => {
  const deferred = fixture('visual_key'), assetId = crypto.randomUUID();
  deferred.definition.options[0].imageAssetId = assetId;
  assert.equal(raffle.allowedImage(deferred.candidate, undefined, 'catalog', assetId), false);
  assert.deepEqual(deferred.view().available, []);
  const f = fixture(); const v = f.command({ command: 'open', definitionId: 'own-raffle' });
  const bad = { runId: f.runId, tools: { raffle: structuredClone(v) } }; bad.tools.raffle.screen.pendingWinner = { name: 'leak' };
  assert.throws(() => ui.validate(bad, f.root), /INVALID_REHEARSAL_RAFFLE/);
});
