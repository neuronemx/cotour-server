const crypto = require('node:crypto');
const { RaffleStore, countdownRemainingMs } = require('../raffle-store');
const { normalizeRaffles } = require('./raffle-runtime');
const { requiredText } = require('../qna-values');
const { EventAccessError } = require('./authorization');
const KEY = 'private-raffle-rehearsal', MAX_SAMPLES = 20;
const fail = (code, status = 409) => { throw new EventAccessError(code, status); };
function definitions(candidate) { return normalizeRaffles(candidate.configuration?.raffles || []); }
function storeFor(previous, now) {
  const store = new RaffleStore(Math.random, { now: () => now });
  if (previous) store.sessions = structuredClone(previous.sessions);
  return store;
}
function active(previous) { return !!previous?.sessions.get(KEY)?.active; }
function advance(previous, now) {
  const run = previous?.sessions.get(KEY)?.active;
  if (run?.state !== 'drawing' || Date.parse(run.revealAt) > now) return previous;
  const store = storeFor(previous, now), result = store.revealWinner(KEY, { nowMs: now });
  if (!result.ok) fail('REHEARSAL_RAFFLE_' + result.reason.toUpperCase());
  return { ...previous, sessions: store.sessions };
}
function operate(previous, catalog, input, now) {
  const store = storeFor(previous, now), next = previous ? structuredClone(previous)
    : { samples: [], definitionId: null, draftDefinitionId: null, latestRunId: null };
  let result;
  if (['open', 'configure_key'].includes(input.command)) {
    const definition = catalog.find(d => d.id === input.definitionId);
    if (!definition) fail('REHEARSAL_RAFFLE_NOT_FOUND');
    if (input.command === 'configure_key') {
      if (definition.mode !== 'visual_key' || !definition.options.some(o => o.id === input.optionId)) fail('INVALID_INPUT', 400);
      result = store.configureVisualKey(KEY, input.optionId); next.draftDefinitionId = definition.id;
    } else {
      const runId = crypto.randomUUID();
      result = store.create({ sessionId: KEY, config: { ...definition, id: runId,
        entryKey: next.draftDefinitionId === definition.id ? store.getSession(KEY).visualKeyDraftEntryKey : definition.entryKey } });
      if (result.ok) { next.latestRunId = runId; next.definitionId = definition.id; }
    }
  } else {
    if (!next.latestRunId || input.raffleRunId !== next.latestRunId) fail('REHEARSAL_RAFFLE_STALE_EXECUTION');
    const run = store.getActive(KEY);
    if (input.command !== 'reset_winners' && !run) fail('REHEARSAL_RAFFLE_NOT_ACTIVE');
    if (input.command === 'enter') {
      if (run.state !== 'collecting') fail('REHEARSAL_RAFFLE_ENTRIES_NOT_COLLECTING');
      if (typeof input.name !== 'string' || input.sampleId !== null && typeof input.sampleId !== 'string') fail('INVALID_INPUT', 400);
      let name; try { name = requiredText(input.name, 'name', 120); } catch (_) { fail('INVALID_INPUT', 400); }
      let sample = next.samples.find(s => s.id === input.sampleId);
      if (input.sampleId !== null && (!sample || sample.name !== name)) fail('REHEARSAL_RAFFLE_SAMPLE_NOT_FOUND');
      if (!sample) {
        if (next.samples.length >= MAX_SAMPLES) fail('REHEARSAL_RAFFLE_LIMIT', 429);
        sample = { id: crypto.randomUUID(), name }; next.samples.push(sample);
      }
      if (run.mode === 'free' ? input.optionId !== undefined : typeof input.optionId !== 'string' || !run.options.some(o => o.id === input.optionId)) fail('INVALID_INPUT', 400);
      const entry = { sessionId: KEY, audienceId: sample.id, name: sample.name, optionId: input.optionId };
      result = run.mode === 'poll' ? store.submitPollResponse(entry) : store.enter(entry);
    } else if (input.command === 'close_entries') result = store.closeEntries(KEY, next.samples);
    else if (input.command === 'draw') {
      const session = store.getSession(KEY), source = run.eligibleSnapshot || [...run.entries.values()];
      const count = source.filter(e => !session.previousWinnerAudienceIds.has(e.audienceId)).length;
      store.random = () => count ? crypto.randomInt(count) / count : 0;
      result = store.drawWinner(KEY, next.samples.map(s => s.id), { nowMs: now });
    } else if (input.command === 'reveal') result = store.revealWinner(KEY, { nowMs: now });
    else if (input.command === 'close') { result = store.close(KEY); next.draftDefinitionId = null; }
    else if (input.command === 'reset_winners') result = store.resetWinners(KEY);
    else fail('INVALID_INPUT', 400);
  }
  if (!result?.ok) fail('REHEARSAL_RAFFLE_' + String(result?.reason || 'INVALID_COMMAND').toUpperCase());
  next.sessions = store.sessions;
  return next;
}
const winner = entry => entry ? { name: entry.name, label: entry.label, ticketNumber: entry.ticketNumber } : null;
function projection(candidate, previous, root, runId, now) {
  const catalog = definitions(candidate), store = storeFor(previous, now), state = store.getControllerState(KEY), raw = store.getActive(KEY);
  function attach(option, definitionId, executionId) {
    const id = candidate.configuration?.raffles.find(d => d.id === definitionId)?.options.find(o => o.id === option?.id)?.imageAssetId;
    if (!option || !id) return option;
    const metadata = candidate.rehearsalImages?.find(r => r.id === id);
    if (!metadata) fail('INTERACTION_IMAGE_NOT_PREPARED', 403);
    return { ...option, image: { url: root + '/raffle-images/' + runId + '/' + candidate.snapshot.bundleDigest + '/' + executionId + '/' + id,
      width: metadata.width, height: metadata.height } };
  }
  const available = catalog.map(({ id, title, mode, options }) => ({ id, title, mode,
    keyOptions: mode === 'visual_key' ? options.map(o => attach(o, id, 'catalog')) : [] }));
  let controller = null, screen = null;
  if (raw) {
    const c = state.active;
    controller = { id: raw.id, mode: raw.mode, state: raw.state, title: raw.title, prompt: raw.prompt, entryKey: raw.entryKey,
      ticketDigits: raw.ticketDigits, options: c.options.map(o => attach(o, previous.definitionId, raw.id)),
      entryCount: c.entryCount, eligibleCount: c.eligibleCount,
      matchingSelectionCount: [...raw.selections.values()].filter(s => s.selectedOptionId === raw.entryKey).length,
      entries: c.entries.map(({ audienceId, name, label, ticketNumber, selectedOptionId }) => ({ sampleId: audienceId, name, label, ticketNumber, selectedOptionId })),
      selections: [...raw.selections.values()].map(s => ({ sampleId: s.audienceId, optionId: s.selectedOptionId })),
      pollResults: c.pollResults, winner: winner(c.winner) };
    screen = structuredClone(store.getScreenState(KEY).active);
    if (screen.winner) screen.winner = winner(screen.winner);
    screen.displayOption = attach(screen.displayOption, previous.definitionId, raw.id);
    screen.options = screen.options.map(o => attach(o, previous.definitionId, raw.id));
    screen.countdownRemainingMs = countdownRemainingMs(raw, now);
  }
  return { available, raffleRunId: previous?.latestRunId || null, controller, screen, samples: previous ? structuredClone(previous.samples) : [],
    previousWinnerCount: state.previousWinnerCount, winners: state.winners.map(winner), maxSamples: MAX_SAMPLES,
    draftDefinitionId: previous?.draftDefinitionId || null, draftOptionId: state.visualKeyDraftEntryKey,
    nextDeadlineAt: raw?.state === 'drawing' ? Date.parse(raw.revealAt) : null, serverNow: now };
}
function allowedImage(candidate, previous, executionId, assetId) {
  const id = executionId === 'catalog' ? null : previous?.latestRunId;
  if (executionId !== 'catalog' && (!active(previous) || id !== executionId)) return false;
  return (candidate.configuration?.raffles || []).some(d => d.mode === 'visual_key'
    && (executionId === 'catalog' || d.id === previous.definitionId) && d.options.some(o => o.imageAssetId === assetId));
}
module.exports = { definitions, active, advance, operate, projection, allowedImage, MAX_SAMPLES };
