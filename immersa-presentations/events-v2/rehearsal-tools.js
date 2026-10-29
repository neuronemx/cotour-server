const crypto = require('node:crypto');
const { InteractionStore } = require('../interaction-store');
const { normalizePolls } = require('./poll-runtime');
const { normalizeAV } = require('./av-runtime');
const { EventAccessError } = require('./authorization');
const qna = require('./rehearsal-qna');
const knowledge = require('./rehearsal-knowledge');
const fail = code => { throw new EventAccessError(code, 409); };
const session = 'private-rehearsal', sample = 'private-sample';

function catalogs(candidate) {
  // Stored catalogs are already normalized and carry publicId:null. Rehearsal
  // has no public QR; pass only the selected media and playlists to admission.
  const av = candidate.configuration?.av || { resources: [], playlists: [] };
  return { polls: normalizePolls(candidate.configuration?.polls || []),
    av: normalizeAV({ resources: av.resources, playlists: av.playlists }) };
}
function storeFor(previous) {
  const store = new InteractionStore();
  if (previous) store.sessions = structuredClone(previous.sessions);
  return store;
}
function operatePoll(previous, definitions, input) {
  const store = storeFor(previous), active = store.hasActive(session);
  let runId = previous?.runId || null;
  if (input.command === 'launch') {
    if (active) fail('REHEARSAL_POLL_ACTIVE');
    const poll = definitions.find(p => p.id === input.interactionId);
    if (!poll) fail('REHEARSAL_POLL_NOT_FOUND');
    store.launch({ sessionId: session, interaction: poll });
    store.hideResults(session); runId = crypto.randomUUID();
  } else {
    if (!active || input.pollRunId !== runId) fail('REHEARSAL_POLL_NOT_ACTIVE');
    if (input.command === 'respond') {
      const result = store.submitResponse({ sessionId: session, interactionId: store.getState(session).active.id,
        audienceId: sample, optionId: input.optionId });
      if (!result.ok) fail(result.reason === 'duplicate_response' ? 'REHEARSAL_SAMPLE_ALREADY_USED' : 'REHEARSAL_INVALID_OPTION');
    } else if (input.command === 'show') store.revealResults(session);
    else if (input.command === 'hide') store.hideResults(session);
    else if (input.command === 'close') {
      store.close(session);
      // No history or metrics, including the engine's optional in-memory snapshots.
      store.sessions.clear(); runId = null;
    } else fail('REHEARSAL_INVALID_POLL_COMMAND');
  }
  return { sessions: store.sessions, runId };
}
function projection(candidate, state, root, now = Date.now()) {
  const { polls, av } = catalogs(candidate), store = storeFor(state.poll), raw = store.getState(session, sample);
  const active = raw.active ? Object.fromEntries(['id', 'title', 'prompt', 'options', 'en'].map(k => [k, structuredClone(raw.active[k])])) : null;
  return { knowledge: knowledge.projection(candidate, state.knowledge, root, state.runId, now), qna: qna.projection(state.qna, now), polls: { available: polls.map(({ id, title }) => ({ id, title })), runId: state.poll?.runId || null,
    active, responded: !!raw.response, resultsVisible: raw.resultsVisible,
    results: raw.resultsVisible ? store.getResults(session) : null },
  media: av.resources.map(({ id, assetId, name, type, duration }) => ({ id, name, type, duration,
    url: root + '/media/' + state.runId + '/' + candidate.snapshot.bundleDigest + '/' + assetId })),
  playlists: av.playlists.map(p => structuredClone(p)) };
}
module.exports = { catalogs, operatePoll, projection };
