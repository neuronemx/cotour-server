const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const engine = require('../knowledge-activity-engine');
const { KnowledgeActivityRepository } = require('../db/knowledge-activity-repository');
const { EventAccessError } = require('./authorization');
const { executionKey } = require('./live-runtime');
const controls = context => ['STAGE', 'SPEAKER', 'PLAYER'].includes(context.kind);
const error = code => new EventAccessError(code, 403);
const token = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 96;
const bounded = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const ACTIONS = Object.freeze({ start: engine.startExecution, finalize: engine.finalizeExecution,
  cancel: engine.cancelExecution, show_results: engine.showResults, close: engine.closeExecution,
  retry_processing: engine.retryProcessing, force_results: (run, now) => engine.forceResults(run, { nowMs: now }) });

function normalizeKnowledge(definitions) {
  if (!Array.isArray(definitions) || definitions.length > 500) throw error('KNOWLEDGE_CONTENT_NOT_PREPARED');
  const seen = new Set();
  return definitions.map(definition => {
    if (!definition || !token(definition.id) || seen.has(definition.id) || !bounded(definition.title, 240)
      || !['contest', 'assessment'].includes(definition.category)
      || !['anonymous', 'optional_name', 'required_name'].includes(definition.identificationMode)
      || !Array.isArray(definition.questions) || !definition.questions.length || definition.questions.length > 100) throw error('KNOWLEDGE_CONTENT_NOT_PREPARED');
    seen.add(definition.id);
    const questionIds = new Set();
    for (const question of definition.questions) {
      // Private image delivery belongs to the prepared asset boundary, not the
      // historical /decks URL. This increment accepts text definitions only.
      if (!question || !token(question.id) || questionIds.has(question.id) || !bounded(question.prompt, 2000)
        || question.image || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) throw error('KNOWLEDGE_CONTENT_NOT_PREPARED');
      questionIds.add(question.id);
      const options = new Set();
      for (const option of question.options) {
        if (!option || !token(option.id) || options.has(option.id) || !bounded(option.label, 500)) throw error('KNOWLEDGE_CONTENT_NOT_PREPARED');
        options.add(option.id);
      }
      const marked = question.options.filter(option => option.correct);
      if (marked.length > 1 || (question.correctOptionId && marked.length && marked[0].id !== question.correctOptionId)) throw error('KNOWLEDGE_CONTENT_NOT_PREPARED');
    }
    try { return engine.normalizeDefinition(definition); } catch (_) { throw error('KNOWLEDGE_CONTENT_NOT_PREPARED'); }
  });
}

function nextDeadline(run) {
  const times = ['countdownDeadlineAt', 'questionDeadlineAt', 'revealDeadlineAt', 'deadlineAt', 'processingReadyAt', 'processingDeadlineAt']
    .map(key => Date.parse(run?.[key] || '')).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

class EventKnowledgeRuntime {
  constructor({ liveRuntime, pool, polls = null, readKnowledge = async () => null, now = Date.now,
    random = Math.random, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.live = liveRuntime; this.pool = pool; this.polls = polls; this.readKnowledge = readKnowledge;
    this.now = now; this.random = random; this.setTimeoutFn = setTimeoutFn; this.clearTimeoutFn = clearTimeoutFn;
    this.timers = new Map(); this.notify = async () => {};
  }
  repository(db) {
    return new KnowledgeActivityRepository(this.pool, { storage: 'events-v2', executor: db,
      transactionExecutor: operation => operation(db) });
  }
  async scope(context, db, liveId, preparedLive = null) {
    const prepared = preparedLive || await this.live.prepared(context, db, liveId);
    const key = executionKey(context.eventId, liveId), live = this.live.states.get(key);
    if (!live || ['eventId', 'liveSessionId', 'stageId', 'activityId', 'deckId', 'versionId', 'slideCount'].some(field => live[field] !== prepared[field])) throw error('CONTENT_VERSION_CHANGED');
    const catalog = await this.readKnowledge(prepared, db);
    if (!catalog || ['eventId', 'liveSessionId', 'deckId', 'versionId'].some(field => catalog[field] !== prepared[field])) throw error('KNOWLEDGE_CONTENT_NOT_PREPARED');
    const definitions = normalizeKnowledge(catalog.knowledge);
    const digest = crypto.createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
    const [rows] = await db.execute('SELECT * FROM event_v2_knowledge_sessions WHERE id = ?', [liveId]);
    const record = rows[0];
    if (record && (record.stage_id !== prepared.stageId || record.activity_id !== prepared.activityId
      || record.deck_id !== prepared.deckId || record.version_id !== prepared.versionId || record.catalog_digest !== digest)) throw error('CONTENT_VERSION_CHANGED');
    const run = record?.latest_execution_id ? await this.repository(db).loadExecution(record.latest_execution_id) : null;
    if (record?.latest_execution_id && (!run || run.presentationSessionId !== liveId || run.sourceSessionId !== key || run.deckId !== prepared.deckId
      || !isDeepStrictEqual(run.definition, definitions.find(item => item.id === run.definitionId)))) throw error('CONTENT_VERSION_CHANGED');
    return { prepared, key, record, definitions, digest, run };
  }
  async hasActive(context, db, liveId, preparedLive) {
    const { run } = await this.scope(context, db, liveId, preparedLive);
    return Boolean(run && !engine.TERMINAL_STATES.has(run.state));
  }
  async participantName(context, db, submitted) {
    const [rows] = await db.execute('SELECT display_name FROM event_participant_identities WHERE participant_id = ?', [context.participantId]);
    let name = rows[0]?.display_name || '';
    if (submitted !== undefined) {
      if (typeof submitted !== 'string' || submitted.trim().length > 120) throw error('KNOWLEDGE_INVALID_INPUT');
      if (submitted.trim()) {
        name = submitted.trim();
        await db.execute('UPDATE event_participant_identities SET display_name = ? WHERE participant_id = ?', [name, context.participantId]);
      }
    }
    return name;
  }
  async operate(grants, credentials, liveId, command, payload = {}) {
    const key = executionKey(credentials.eventId, liveId);
    const run = await this.live.serial(key, () => grants.withSession(credentials, async (context, db) => {
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      const publicCommand = ['join', 'claim_tab', 'answer', 'submit'].includes(command);
      if (command !== 'tick' && (publicCommand ? context.kind !== 'PARTICIPANT' || !context.participantId : !controls(context))) throw error('KNOWLEDGE_COMMAND_DENIED');
      if (!['open', 'tick', ...Object.keys(ACTIONS), 'join', 'claim_tab', 'answer', 'submit'].includes(command)) throw error('COMMAND_NOT_ENABLED');
      const scoped = await this.scope(context, db, liveId), repository = this.repository(db);
      let current = scoped.run;
      if (command === 'open') {
        if (current && !engine.TERMINAL_STATES.has(current.state)) throw error('INTERACTION_BUSY');
        if (this.polls?.states.get(key)?.store.hasActive(key)) throw error('INTERACTION_BUSY');
        const definition = scoped.definitions.find(item => item.id === payload.definitionId);
        if (!definition) throw error('KNOWLEDGE_DEFINITION_NOT_FOUND');
        if (!scoped.record) await db.execute(`INSERT INTO event_v2_knowledge_sessions
          (id,stage_id,activity_id,deck_id,version_id,catalog_digest,source_session_id) VALUES (?,?,?,?,?,?,?)`,
        [liveId, scoped.prepared.stageId, scoped.prepared.activityId, scoped.prepared.deckId, scoped.prepared.versionId, scoped.digest, key]);
        current = engine.createExecution({ presentationSessionId: liveId, sourceSessionId: key,
          deckId: scoped.prepared.deckId, definition, nowMs: this.now(), random: this.random });
        current.contractVersion = 'events-v2-knowledge-adapter-v1';
        await repository.createExecution(current);
        await db.execute('UPDATE event_v2_knowledge_sessions SET latest_execution_id = ? WHERE id = ?', [current.id, liveId]);
      } else if (current) {
        if (command !== 'tick' && current.id !== payload.executionId) throw error('KNOWLEDGE_STALE_EXECUTION');
        const before = current.revision;
        // Tick only in a committed authorization transaction. No background
        // legacy service can mutate or broadcast an Events execution.
        if (command === 'tick') engine.tickExecution(current, this.now());
        else if (publicCommand) {
          if (!token(payload.tabId)) throw error('KNOWLEDGE_INVALID_INPUT');
          const input = { participantId: context.participantId, tabId: payload.tabId, nowMs: this.now() };
          if (command === 'join') {
            const name = await this.participantName(context, db, payload.name);
            const participant = engine.joinParticipant(current, { ...input, name, random: this.random });
            // Correction is per event and also applies to an existing admission.
            if (current.definition.identificationMode !== 'anonymous' && name) { participant.name = name; participant.label = name; }
            if (current.definition.identificationMode === 'anonymous') {
              participant.name = ''; participant.label = `Usuario ${String(participant.userNumber).padStart(3, '0')}`;
            }
          } else if (command === 'claim_tab') engine.claimParticipantTab(current, input);
          else if (command === 'answer') {
            if (!token(payload.questionId) || !token(payload.optionId) || !token(payload.attemptId)) throw error('KNOWLEDGE_INVALID_INPUT');
            const previous = current.answers.find(answer => answer.participantId === context.participantId && answer.clientAttemptId === payload.attemptId);
            if (previous && (previous.questionId !== payload.questionId || previous.optionId !== payload.optionId)) throw error('KNOWLEDGE_INVALID_INPUT');
            if (!previous) engine.submitAnswer(current, { ...input, questionId: payload.questionId, optionId: payload.optionId, clientAttemptId: payload.attemptId });
          } else engine.submitAssessment(current, input);
        } else {
          if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision !== current.revision) throw error('KNOWLEDGE_STALE_REVISION');
          // Real typed grant authorizes pure transitions, including PLAYER's
          // emergency cycle. Never impersonate a legacy presenter/stage actor.
          ACTIONS[command](current, this.now());
        }
        if (current.revision !== before) await repository.saveExecution(current, { expectedRevision: before });
      } else if (command !== 'tick') throw error('KNOWLEDGE_NOT_ACTIVE');
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      return current;
    }));
    if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
    this.schedule(key, run, grants, credentials, liveId);
    return key;
  }
  schedule(key, run, grants, credentials, liveId) {
    const previous = this.timers.get(key); if (previous) this.clearTimeoutFn(previous);
    this.timers.delete(key);
    const deadline = nextDeadline(run);
    if (!Number.isFinite(deadline) || engine.TERMINAL_STATES.has(run?.state)) return;
    const handle = this.setTimeoutFn(async () => {
      this.timers.delete(key);
      try { await this.operate(grants, credentials, liveId, 'tick'); await this.notify(key); } catch (_) { /* Fresh scoped activity can resume after reconnect. */ }
    }, Math.max(5, deadline - this.now() + 5));
    handle?.unref?.(); this.timers.set(key, handle);
  }
  async projection(context, db, liveId, preparedLive, tabId = '') {
    const { run, definitions } = await this.scope(context, db, liveId, preparedLive);
    const snapshot = { eventId: context.eventId, liveSessionId: liveId, execution: null };
    if (controls(context)) snapshot.available = definitions.map(({ id, title, category }) => ({ id, title, category }));
    if (context.kind === 'PARTICIPANT') snapshot.displayName = await this.participantName(context, db);
    if (!run) return snapshot;
    // Existing DTO serializers are views only, never authorization. The
    // participant serializer is always bound to the server's participant ID.
    const view = context.kind === 'PARTICIPANT' ? 'audience' : context.kind === 'PLAYER' ? 'screen' : 'stage';
    snapshot.execution = engine.stateForRole(run, { role: view, participantId: context.participantId, tabId, nowMs: this.now() });
    return snapshot;
  }
  close() { for (const handle of this.timers.values()) this.clearTimeoutFn(handle); this.timers.clear(); }
}
module.exports = { EventKnowledgeRuntime, normalizeKnowledge, nextDeadline };
