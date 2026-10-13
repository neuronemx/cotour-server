const crypto = require('node:crypto');
const { InteractionStore } = require('../interaction-store');
const { EventAccessError } = require('./authorization');
const { executionKey } = require('./live-runtime');
const controls = context => ['STAGE', 'SPEAKER', 'PLAYER'].includes(context.kind);
const error = code => new EventAccessError(code, 403);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 120;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function normalizePolls(catalog) {
  if (!Array.isArray(catalog) || catalog.length > 500) throw error('POLL_CONTENT_NOT_PREPARED');
  const store = new InteractionStore(), seen = new Set();
  return catalog.map(item => {
    if (!item || item.type !== 'poll' || !id(item.id) || seen.has(item.id)
      || !text(item.title, 1000) || !text(item.prompt, 2000)
      || item.allowMultiple || item.settings?.allow_multiple || !Array.isArray(item.options)
      || item.options.length < 2 || item.options.length > 20) throw error('POLL_CONTENT_NOT_PREPARED');
    seen.add(item.id);
    const options = new Set();
    for (const option of item.options) {
      if (!option || !id(option.id) || options.has(option.id) || !text(option.label, 500)) throw error('POLL_CONTENT_NOT_PREPARED');
      options.add(option.id);
    }
    // Existing normalization is an allowlist: no answers, private notes, paths,
    // metrics, participant identity or other arbitrary preparation fields.
    return store.normalizeInteraction({ ...item, allowMultiple: false, source: 'event' });
  });
}
function forkStore(source) {
  const store = new InteractionStore();
  if (source) store.sessions = structuredClone(source.sessions);
  return store;
}

class EventPollRuntime {
  constructor({ liveRuntime, readPolls = async () => null }) {
    this.live = liveRuntime;
    this.readPolls = readPolls;
    this.states = new Map();
    this.knowledge = null;
    this.raffles = null;
  }
  async prepared(context, db, liveId, preparedLive = null) {
    const prepared = preparedLive || await this.live.prepared(context, db, liveId);
    const key = executionKey(context.eventId, liveId), live = this.live.states.get(key);
    if (!live || ['eventId', 'liveSessionId', 'stageId', 'activityId', 'deckId', 'versionId', 'slideCount'].some(field => live[field] !== prepared[field])) throw error('CONTENT_VERSION_CHANGED');
    const catalog = await this.readPolls(prepared, db);
    if (!catalog || ['eventId', 'liveSessionId', 'deckId', 'versionId'].some(field => catalog[field] !== prepared[field])) throw error('POLL_CONTENT_NOT_PREPARED');
    const polls = normalizePolls(catalog.polls);
    const digest = crypto.createHash('sha256').update(JSON.stringify(polls)).digest('hex');
    const state = this.states.get(key);
    if (state && (state.digest !== digest || state.versionId !== prepared.versionId)) throw error('CONTENT_VERSION_CHANGED');
    return { key, polls, digest, versionId: prepared.versionId };
  }
  async operate(grants, credentials, liveId, command, payload) {
    const key = executionKey(credentials.eventId, liveId);
    return this.live.serial(key, async () => {
      const candidate = await grants.withSession(credentials, async (context, db) => {
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        if (command === 'submit' ? context.kind !== 'PARTICIPANT' || !context.participantId : !controls(context)) throw error('POLL_COMMAND_DENIED');
        if (!['launch', 'submit', 'show', 'hide', 'close'].includes(command)) throw error('COMMAND_NOT_ENABLED');
        const prepared = await this.prepared(context, db, liveId);
        const previous = this.states.get(key);
        const store = forkStore(previous?.store);
        const state = { ...prepared, store, runId: previous?.runId || null, revision: previous?.revision || 0 };
        if (command === 'launch') {
          if (store.hasActive(key)) throw error('POLL_ALREADY_ACTIVE');
          if (this.knowledge && await this.knowledge.hasActive(context, db, liveId)) throw error('INTERACTION_BUSY');
          if (this.raffles && await this.raffles.hasActive(context, db, liveId)) throw error('INTERACTION_BUSY');
          if (this.games && await this.games.hasActive(context, db, liveId)) throw error('INTERACTION_BUSY');
          const poll = prepared.polls.find(poll => poll.id === payload.interactionId);
          if (!poll) throw error('POLL_NOT_FOUND');
          if (!store.launch({ sessionId: key, interaction: poll })) throw error('POLL_CONTENT_NOT_PREPARED');
          state.runId = crypto.randomUUID();
        } else {
          if (!state.runId || state.runId !== payload.pollRunId || !store.hasActive(key)) throw error('POLL_NOT_ACTIVE');
          if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        if (command === 'submit') {
            const active = store.getSession(key).active;
            const result = store.submitResponse({ sessionId: key, interactionId: active.id,
              audienceId: context.participantId, optionId: payload.optionId });
            if (!result.ok) throw error(result.reason === 'duplicate_response' ? 'POLL_DUPLICATE_RESPONSE' : 'POLL_INVALID_OPTION');
          } else if (command === 'show') store.revealResults(key);
          else if (command === 'hide') store.hideResults(key);
          else { store.close(key); state.runId = null; }
        }
        state.revision++;
        return state;
      });
      // Clone before any mutation; publish only after SQL authorization commits.
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      this.states.set(key, candidate);
      return key;
    });
  }
  async projection(context, db, liveId, preparedLive) {
    const prepared = await this.prepared(context, db, liveId, preparedLive);
    const state = this.states.get(prepared.key);
    // Reading/reviewing an idle run never creates another poll engine.
    const store = state?.store;
    const raw = store ? store.getState(prepared.key, context.kind === 'PARTICIPANT' ? context.participantId : '') : { active: null, response: null, resultsVisible: false };
    const snapshot = { eventId: context.eventId, liveSessionId: liveId, revision: state?.revision || 0,
      pollRunId: state?.runId || null, active: null, resultsVisible: raw.resultsVisible };
    if (raw.active) {
      const { id, type, prompt, options, en } = raw.active;
      snapshot.active = { id, type, prompt, options: structuredClone(options), en: structuredClone(en) };
      if (['STAGE', 'SPEAKER'].includes(context.kind)) snapshot.active.title = raw.active.title;
    }
    if (context.kind === 'PARTICIPANT') snapshot.response = raw.response ? { ...raw.response } : null;
    if (controls(context)) {
      snapshot.available = prepared.polls.map(({ id, title }) => ({ id, title }));
      const results = store?.getResults(prepared.key);
      snapshot.results = results && (context.kind !== 'PLAYER' || raw.resultsVisible) ? structuredClone(results) : null;
      if (snapshot.results && context.kind === 'PLAYER') delete snapshot.results.title;
    }
    return snapshot;
  }
}
module.exports = { EventPollRuntime, normalizePolls };
