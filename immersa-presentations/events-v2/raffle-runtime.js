const {imageBindings}=require('./interaction-images');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { RaffleStore, RAFFLE_STATES, RAFFLE_MODES, countdownRemainingMs } = require('../raffle-store');
const { EventAccessError } = require('./authorization');
const { executionKey } = require('./live-runtime');
const { isId } = require('./grant-repository');
const error = code => new EventAccessError(code, 403);
const controls = context => ['STAGE', 'SPEAKER', 'PLAYER'].includes(context.kind);
const token = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 96;
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const iso = now => new Date(now).toISOString();
const FORMAT = 'events-v2-raffle-1';

function normalizeRaffles(definitions) {
  if (!Array.isArray(definitions) || definitions.length > 500) throw error('RAFFLE_CONTENT_NOT_PREPARED');
  const seen = new Set(), store = new RaffleStore();
  return definitions.map(item => {
    if (!item || !token(item.id) || seen.has(item.id) || !RAFFLE_MODES.has(item.mode)
      || !text(item.title, 240) || !text(item.prompt, 2000) || !Array.isArray(item.options)
      || (item.mode === 'free' ? item.options.length !== 0 : item.options.length < 2 || item.options.length > 20)) throw error('RAFFLE_CONTENT_NOT_PREPARED');
    seen.add(item.id); const ids = new Set();
    for (const option of item.options) {
      if (!option || !token(option.id) || ids.has(option.id) || !text(option.label, 500)
        || ['asset', 'thumbnail', 'thumb', 'image'].some(field => option[field])) throw error('RAFFLE_CONTENT_NOT_PREPARED');
      ids.add(option.id);
    }
    const config = { id: item.id, mode: item.mode, title: item.title, prompt: item.prompt,
      options: item.options.map(({ id, label }) => ({ id, label })), entryKey: item.mode === 'visual_key' ? item.entryKey : '' };
    const normalized = store.normalizeRaffle(config);
    if (!normalized.ok) throw error('RAFFLE_CONTENT_NOT_PREPARED');
    const { id, mode, title, prompt, options, entryKey } = normalized.raffle;
    return { id, mode, title, prompt, options, entryKey };
  });
}

function pack(body, store, key) {
  const session = store.getSession(key), active = session.active;
  return { ...body, format: FORMAT, session: { ...session, previousWinnerAudienceIds: [...session.previousWinnerAudienceIds],
    active: active ? { ...active, entries: [...active.entries], selections: [...active.selections] } : null } };
}
function unpack(raw, key, random, now) {
  const body = raw ? typeof raw === 'string' || Buffer.isBuffer(raw) ? JSON.parse(raw.toString()) : raw
    : { format: FORMAT, latestRunId: null, definitionId: null, draftDefinitionId: null,
      session: { active: null, winners: [], previousWinnerAudienceIds: [], visualKeyDraftEntryKey: '' } };
  const session = body.session, active = session?.active;
  if (body.format !== FORMAT || !session || !Array.isArray(session.winners) || !Array.isArray(session.previousWinnerAudienceIds)
    || session.previousWinnerAudienceIds.some(id => !isId(id)) || session.winners.some(entry => !isId(entry?.audienceId))
    || (body.latestRunId !== null && !isId(body.latestRunId))
    || (active && (active.id !== body.latestRunId || !RAFFLE_STATES.has(active.state) || active.state === 'closed'
      || !RAFFLE_MODES.has(active.mode) || !Array.isArray(active.entries) || !Array.isArray(active.selections)
      || [...active.entries, ...active.selections].some(row => !Array.isArray(row) || row.length !== 2 || !isId(row[0]) || row[1]?.audienceId !== row[0])
      || (active.pendingWinner && !isId(active.pendingWinner.audienceId)) || (active.winner && !isId(active.winner.audienceId))))) throw error('RAFFLE_STATE_INVALID');
  const store = new RaffleStore(random || Math.random, { now });
  store.sessions.set(key, { ...session, previousWinnerAudienceIds: new Set(session.previousWinnerAudienceIds),
    active: active ? { ...active, entries: new Map(active.entries), selections: new Map(active.selections) } : null });
  return { body, store };
}
function publicWinner(entry) { return entry ? { name: entry.name, label: entry.label, ticketNumber: entry.ticketNumber || null } : null; }

class EventRaffleRuntime {
  constructor({ liveRuntime, polls = null, knowledge = null, readRaffles = async () => null, projectImages = null, now = Date.now,
    random = null, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.live = liveRuntime; this.polls = polls; this.knowledge = knowledge; this.readRaffles = readRaffles; this.projectImages = projectImages;
    this.now = now; this.random = random; this.setTimeoutFn = setTimeoutFn; this.clearTimeoutFn = clearTimeoutFn;
    this.connected = async () => []; this.notify = async () => {};
    this.timers = new Map(); this.witnesses = new Map(); this.sequence = 0;
  }
  async scope(context, db, liveId, preparedLive = null) {
    const prepared = preparedLive || await this.live.prepared(context, db, liveId);
    const key = executionKey(context.eventId, liveId), live = this.live.states.get(key);
    if (!live || ['eventId', 'liveSessionId', 'stageId', 'activityId', 'deckId', 'versionId', 'slideCount'].some(field => live[field] !== prepared[field])) throw error('CONTENT_VERSION_CHANGED');
    const catalog = await this.readRaffles(prepared, db);
    if (!catalog || ['eventId', 'liveSessionId', 'deckId', 'versionId'].some(field => catalog[field] !== prepared[field])) throw error('RAFFLE_CONTENT_NOT_PREPARED');
    const definitions = normalizeRaffles(catalog.raffles);
    const bindings = imageBindings(catalog.raffles,'raffle');
    if(bindings.length&&!this.projectImages)throw error('INTERACTION_IMAGE_NOT_PREPARED');
    const digest = crypto.createHash('sha256').update(JSON.stringify(bindings.length?{definitions,images:bindings}:definitions)).digest('hex');
    const [rows] = await db.execute('SELECT * FROM event_v2_raffle_sessions WHERE id = ?', [liveId]);
    const record = rows[0];
    if (record && (record.stage_id !== prepared.stageId || record.activity_id !== prepared.activityId || record.deck_id !== prepared.deckId
      || record.version_id !== prepared.versionId || record.catalog_digest !== digest)) throw error('CONTENT_VERSION_CHANGED');
    const { body, store } = unpack(record?.snapshot_json, key, this.random, this.now);
    const active = store.getActive(key);
    if (active) {
      const source = definitions.find(item => item.id === body.definitionId);
      if (!source || ['mode', 'title', 'prompt'].some(field => active[field] !== source[field]) || !isDeepStrictEqual(active.options, source.options)
        || (active.mode === 'visual_key' && !source.options.some(option => option.id === active.entryKey))) throw error('CONTENT_VERSION_CHANGED');
    }
    return { prepared, key, record, definitions, digest, body, store, imageBindings:bindings };
  }
  async hasActive(context, db, liveId, preparedLive) {
    const { key, store } = await this.scope(context, db, liveId, preparedLive);
    return Boolean(store.getActive(key));
  }
  async name(context, db, submitted) {
    const [rows] = await db.execute('SELECT display_name FROM event_participant_identities WHERE participant_id = ?', [context.participantId]);
    let name = rows[0]?.display_name || '';
    if (submitted !== undefined) {
      if (typeof submitted !== 'string' || submitted.trim().length > 120) throw error('RAFFLE_INVALID_INPUT');
      if (submitted.trim()) { name = submitted.trim(); await db.execute('UPDATE event_participant_identities SET display_name = ? WHERE participant_id = ?', [name, context.participantId]); }
    }
    return name;
  }
  async save(db, liveId, scoped) {
    const snapshot = JSON.stringify(pack(scoped.body, scoped.store, scoped.key));
    if (!scoped.record) await db.execute(`INSERT INTO event_v2_raffle_sessions
      (id,stage_id,activity_id,deck_id,version_id,catalog_digest,revision,snapshot_json) VALUES (?,?,?,?,?,?,1,?)`,
    [liveId, scoped.prepared.stageId, scoped.prepared.activityId, scoped.prepared.deckId, scoped.prepared.versionId, scoped.digest, snapshot]);
    else {
      const [result] = await db.execute('UPDATE event_v2_raffle_sessions SET revision = revision + 1, snapshot_json = ? WHERE id = ? AND revision = ?', [snapshot, liveId, scoped.record.revision]);
      if (!result.affectedRows) throw error('RAFFLE_STATE_CHANGED');
    }
  }
  async operate(grants, credentials, liveId, command, payload = {}) {
    const key = executionKey(credentials.eventId, liveId);
    const authorized = await this.live.serial(key, () => grants.withSession(credentials, async (context, db) => {
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      if (command !== 'tick' && (['enter', 'submit_poll_response'].includes(command) ? context.kind !== 'PARTICIPANT' || !context.participantId : !controls(context))) throw error('RAFFLE_COMMAND_DENIED');
      if (!['tick', 'configure_key', 'open', 'enter', 'submit_poll_response', 'close_entries', 'draw', 'reveal', 'close', 'reset_winners'].includes(command)) throw error('COMMAND_NOT_ENABLED');
      const scoped = await this.scope(context, db, liveId), { body, store, definitions } = scoped;
      const active = store.getActive(key); let changed = command !== 'tick', result;
      if (command === 'open' || command === 'configure_key') {
        const definition = definitions.find(item => item.id === payload.definitionId);
        if (!definition) throw error('RAFFLE_DEFINITION_NOT_FOUND');
        if (command === 'configure_key') {
          if (definition.mode !== 'visual_key' || !definition.options.some(option => option.id === payload.optionId)) throw error('RAFFLE_INVALID_OPTION');
          result = store.configureVisualKey(key, payload.optionId); body.draftDefinitionId = definition.id;
        } else {
          if ((this.games && await this.games.hasActive(context, db, liveId, scoped.prepared)) || this.polls?.states.get(key)?.store.hasActive(key) || (this.knowledge && await this.knowledge.hasActive(context, db, liveId, scoped.prepared))) throw error('INTERACTION_BUSY');
          const runId = crypto.randomUUID();
          result = store.create({ sessionId: key, config: { ...definition, id: runId,
            entryKey: body.draftDefinitionId === definition.id ? store.getSession(key).visualKeyDraftEntryKey : definition.entryKey } });
          if (result.ok) { body.latestRunId = runId; body.definitionId = definition.id; }
        }
      } else if (command === 'tick') {
        if (active?.state === 'drawing' && Date.parse(active.revealAt) <= this.now()) {
          const present = await this.connected(db, context, liveId);
          if (present.includes(active.pendingWinner?.audienceId)) { result = store.revealWinner(key, { nowMs: this.now() }); changed = true; }
        }
      } else {
        if (!scoped.record || !body.latestRunId || payload.raffleRunId !== body.latestRunId) throw error('RAFFLE_STALE_EXECUTION');
        if (command !== 'reset_winners' && !active) throw error('RAFFLE_NOT_ACTIVE');
        if (command === 'enter' || command === 'submit_poll_response') {
          const name = await this.name(context, db, payload.name);
          if (active.mode !== 'free' && !token(payload.optionId)) throw error('RAFFLE_INVALID_OPTION');
          result = command === 'enter' ? store.enter({ sessionId: key, audienceId: context.participantId, name, optionId: payload.optionId })
            : store.submitPollResponse({ sessionId: key, audienceId: context.participantId, name, optionId: payload.optionId });
        } else if (command === 'close_entries') result = store.closeEntries(key);
        else if (command === 'draw') {
          const present = await this.connected(db, context, liveId);
          if (!this.random) {
            const session = store.getSession(key), source = active.eligibleSnapshot || [...active.entries.values()];
            const size = source.filter(entry => !session.previousWinnerAudienceIds.has(entry.audienceId) && present.includes(entry.audienceId)).length;
            store.random = () => crypto.randomInt(size) / size;
          }
          result = store.drawWinner(key, present, { nowMs: this.now() });
        } else if (command === 'reveal') {
          if (active.state !== 'drawing') throw error('RAFFLE_INVALID_STATE');
          const present = await this.connected(db, context, liveId);
          if (!present.includes(active.pendingWinner?.audienceId)) throw error('RAFFLE_WINNER_NOT_CONNECTED');
          result = store.revealWinner(key, { nowMs: this.now() });
        } else if (command === 'close') { result = store.close(key); body.draftDefinitionId = null; }
        else result = store.resetWinners(key);
      }
      if (result && !result.ok) throw error(`RAFFLE_${String(result.reason).toUpperCase()}`);
      if (changed) await this.save(db, liveId, scoped);
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      return { active: store.getActive(key), kind: context.kind };
    }));
    if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
    this.schedule(key, authorized.active, grants, credentials, liveId, authorized.kind);
    return key;
  }
  schedule(key, active, grants, credentials, liveId, kind) {
    const previous = this.timers.get(key); if (previous) this.clearTimeoutFn(previous);
    this.timers.delete(key);
    if (active?.state !== 'drawing') { this.witnesses.delete(key); return; }
    const witnesses = this.witnesses.get(key) || new Map(), id = credentials.grantId;
    witnesses.set(id, { grants, credentials, kind, sequence: ++this.sequence });
    this.witnesses.set(key, new Map([...witnesses].sort((a, b) => Number(controls(b[1])) - Number(controls(a[1])) || b[1].sequence - a[1].sequence).slice(0, 12)));
    const handle = this.setTimeoutFn(async () => {
      this.timers.delete(key);
      for (const [id, witness] of this.witnesses.get(key) || []) {
        try { await this.operate(witness.grants, witness.credentials, liveId, 'tick'); await this.notify(key); return; }
        catch (_) { this.witnesses.get(key)?.delete(id); }
      }
      this.witnesses.delete(key);
    }, Date.parse(active.revealAt) > this.now() ? Date.parse(active.revealAt) - this.now() + 5 : 1000);
    handle?.unref?.(); this.timers.set(key, handle);
  }
  async projection(context, db, liveId, preparedLive) {
    const scoped = await this.scope(context, db, liveId, preparedLive), { key, record, body, store, definitions } = scoped;
    const snapshot = { eventId: context.eventId, liveSessionId: liveId, raffleRunId: body.latestRunId, revision: Number(record?.revision || 0) };
    let state;
    if (context.kind === 'PARTICIPANT') { state = store.getAudienceState(key, context.participantId); snapshot.displayName = await this.name(context, db); }
    else if (context.kind === 'PLAYER') state = store.getScreenState(key);
    else {
      state = store.getControllerState(key);
      if (state.active) { state.active.entries = state.active.entries.map(({ audienceId, ...entry }) => entry); state.active.winners = state.active.winners.map(publicWinner); state.active.winner = publicWinner(state.active.winner); }
      state.winners = state.winners.map(publicWinner);
    }
    if (context.kind === 'PLAYER' && state.active?.winner) state.active.winner = publicWinner(state.active.winner);
    if (state.active) state.active.countdownRemainingMs = countdownRemainingMs(store.getActive(key), this.now());
    if (controls(context)) snapshot.available = definitions.map(({ id, title, mode, options }) => ({ id, title, mode,
      ...(mode === 'visual_key' ? { keyOptions: options } : {}) }));
    const out={ ...snapshot, ...state };return this.projectImages ? this.projectImages(context,db,scoped,out) : out;
  }
  close() { for (const handle of this.timers.values()) this.clearTimeoutFn(handle); this.timers.clear(); this.witnesses.clear(); }
}
module.exports = { EventRaffleRuntime, normalizeRaffles, pack, unpack };
