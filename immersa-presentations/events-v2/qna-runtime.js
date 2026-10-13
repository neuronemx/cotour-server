const crypto = require('node:crypto');
const { QnaRepository } = require('../db/qna-repository');
const { EventAccessError } = require('./authorization');
const { executionKey } = require('./live-runtime');
const controls = context => ['STAGE', 'SPEAKER', 'PLAYER'].includes(context.kind);
const error = code => new EventAccessError(code, 403);

class EventQnaRuntime {
  constructor({ liveRuntime, pool, now = Date.now }) { this.live = liveRuntime; this.pool = pool; this.now = now; }
  repository(db) {
    // The grant transaction already owns the organization lock. Reuse its
    // connection, never open a nested transaction or another pool connection.
    return new QnaRepository(this.pool, { storage: 'events-v2', executor: db,
      transactionExecutor: operation => operation(db), now: this.now });
  }
  async scope(context, db, liveId, preparedLive = null) {
    const prepared = preparedLive || await this.live.prepared(context, db, liveId);
    const live = this.live.states.get(executionKey(context.eventId, liveId));
    if (!live || ['stageId', 'activityId', 'deckId', 'versionId', 'slideCount'].some(field => live[field] !== prepared[field])) throw error('CONTENT_VERSION_CHANGED');
    const [rows] = await db.execute('SELECT * FROM event_v2_qna_sessions WHERE id = ?', [liveId]);
    const record = rows[0];
    if (record && (record.ended_at || record.version_id !== prepared.versionId || record.deck_id !== prepared.deckId
      || record.stage_id !== prepared.stageId || record.activity_id !== prepared.activityId)) throw error('CONTENT_VERSION_CHANGED');
    return { prepared, record };
  }
  async initialize(db, liveId, prepared) {
    if (prepared.versionId.length > 191 || typeof prepared.deckId !== 'string') throw error('CONTENT_NOT_PREPARED');
    await db.execute(`INSERT INTO event_v2_qna_sessions (id,stage_id,activity_id,deck_id,version_id,source_session_id)
      VALUES (?,?,?,?,?,?)`, [liveId, prepared.stageId, prepared.activityId, prepared.deckId, prepared.versionId, executionKey(prepared.eventId, liveId)]);
    await db.execute('INSERT INTO event_v2_qna_rounds (id,presentation_session_id,round_number,questions_open) VALUES (?,?,1,1)', [crypto.randomUUID(), liveId]);
    await db.execute('INSERT INTO event_v2_qna_projection (live_session_id) VALUES (?)', [liveId]);
  }
  async participantName(context, db, submitted) {
    const [rows] = await db.execute('SELECT display_name FROM event_participant_identities WHERE participant_id = ?', [context.participantId]);
    let name = rows[0]?.display_name || '';
    if (submitted !== undefined) {
      if (typeof submitted !== 'string' || submitted.trim().length > 120) throw error('QNA_INVALID_INPUT');
      if (submitted.trim()) {
        name = submitted.trim();
        await db.execute('UPDATE event_participant_identities SET display_name = ? WHERE participant_id = ?', [name, context.participantId]);
      }
    }
    return name;
  }
  async operate(grants, credentials, liveId, command, payload) {
    return this.live.serial(executionKey(credentials.eventId, liveId), () => grants.withSession(credentials, async (context, db) => {
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      if (command === 'submit' ? context.kind !== 'PARTICIPANT' || !context.participantId : !controls(context)) throw error('QNA_COMMAND_DENIED');
      if (!['open', 'set_open', 'submit', 'select', 'project', 'delete', 'new_round', 'panel_close'].includes(command)) throw error('COMMAND_NOT_ENABLED');
      const { prepared, record } = await this.scope(context, db, liveId);
      const repository = this.repository(db);
      if (!record) {
        if (command !== 'open') throw error('QNA_SESSION_NOT_READY');
        await this.initialize(db, liveId, prepared);
      } else if (command !== 'open') {
        const round = await repository.activeRound(db, liveId, true);
        if (payload.roundId !== round.id) throw error('QNA_STALE_ROUND');
      }
      const input = { presentationSessionId: liveId, questionId: payload.questionId };
      if (command === 'set_open') {
        if (typeof payload.open !== 'boolean') throw error('QNA_INVALID_INPUT');
        await repository.setQuestionsOpen({ ...input, open: payload.open });
      } else if (command === 'submit') {
        if (typeof payload.question !== 'string' || !payload.question.trim() || payload.question.trim().length > 1000
          || typeof payload.allowNameOnScreen !== 'boolean') throw error('QNA_INVALID_INPUT');
        const name = await this.participantName(context, db, payload.name);
        await repository.submitQuestion({ presentationSessionId: liveId, audienceId: context.participantId,
          questionText: payload.question, name, allowNameOnScreen: payload.allowNameOnScreen });
      } else if (['select', 'project', 'delete'].includes(command)) {
        if (typeof payload.questionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(payload.questionId)) throw error('QNA_INVALID_INPUT');
        await repository[{ select: 'selectQuestion', project: 'projectQuestion', delete: 'deleteQuestion' }[command]](input);
        if (command === 'project') await db.execute('UPDATE event_v2_qna_projection SET question_id = ?, visible = 1 WHERE live_session_id = ?', [payload.questionId, liveId]);
      } else if (command === 'new_round') {
        await repository.newRound(input);
        await db.execute('UPDATE event_v2_qna_projection SET question_id = NULL, visible = 0 WHERE live_session_id = ?', [liveId]);
      } else if (command === 'panel_close') {
        // Closing the panel hides Screen, preserving the intake setting/history.
        await db.execute('UPDATE event_v2_qna_projection SET question_id = NULL, visible = 0 WHERE live_session_id = ?', [liveId]);
      }
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      if (!record || command !== 'open') await db.execute('UPDATE event_v2_qna_sessions SET revision = revision + 1 WHERE id = ?', [liveId]);
      return executionKey(context.eventId, liveId);
    }));
  }
  async projection(context, db, liveId, preparedLive) {
    const { record } = await this.scope(context, db, liveId, preparedLive);
    const snapshot = { eventId: context.eventId, liveSessionId: liveId, revision: record?.revision || 0,
      roundId: null, roundNumber: 0, questionsOpen: false };
    if (context.kind === 'PARTICIPANT') {
      snapshot.displayName = await this.participantName(context, db);
      const state = record ? await this.repository(db).getAudienceState({ presentationSessionId: liveId, audienceId: context.participantId }) : { hasSubmitted: false, questionId: null, cooldownRemainingMs: 0 };
      return { ...snapshot, ...state };
    }
    const state = record ? await this.repository(db).getActiveState(liveId) : { roundId: null, roundNumber: 0, questionsOpen: false, selectedQuestionId: null, questions: [] };
    Object.assign(snapshot, { roundId: state.roundId, roundNumber: state.roundNumber, questionsOpen: state.questionsOpen });
    const [rows] = record ? await db.execute('SELECT question_id, visible FROM event_v2_qna_projection WHERE live_session_id = ?', [liveId]) : [[]];
    const projection = rows[0];
    if (record && !projection) throw error('QNA_SESSION_NOT_READY');
    const projected = projection?.visible ? state.questions.find(question => question.id === projection.question_id) : null;
    if (projection?.visible && !projected) throw error('QNA_QUESTION_NOT_FOUND');
    snapshot.screen = { visible: Boolean(projected), question: projected ? { id: projected.id, text: projected.text,
      name: projected.allowNameOnScreen ? projected.name : '' } : null };
    if (['STAGE', 'SPEAKER'].includes(context.kind)) Object.assign(snapshot, { questions: state.questions, selectedQuestionId: state.selectedQuestionId });
    else if (context.kind === 'PLAYER') snapshot.availableQuestions = state.questions.map((question, index) => ({ id: question.id, label: `Pregunta ${index + 1}`, answered: question.answered }));
    return snapshot;
  }
}
module.exports = { EventQnaRuntime };
