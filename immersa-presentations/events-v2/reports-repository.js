const { EventAccessError } = require('./authorization');
const { isId } = require('./grant-repository');
const { executionKey } = require('./live-runtime');
const { parseJson } = require('../db/knowledge-activity-repository');
const { resultCsv } = require('../knowledge-activity-export');
const fail = (code = 'REPORT_BINDING_INVALID', status = 409) => { throw new EventAccessError(code, status); };
const TABLES = Object.freeze({ qna: 'event_v2_qna_sessions', knowledge: 'event_v2_knowledge_sessions', reactions: 'event_v2_reaction_counts' });
const date = value => value ? new Date(value).toISOString() : null;

// Human-viewing CSV: quoted fields and a tab before formula/control prefixes.
// JSON retains the original text for programmatic use. Resaving/importing a
// CSV in other applications is not a universal spreadsheet safety guarantee.
function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text) || /^\d{16,}$/.test(text))) text = '\t' + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
const csv = rows => '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

function pagination(query = {}, mode = 'after') {
  const allowed = mode === 'none' ? [] : ['limit', mode];
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !allowed.includes(key))) fail('INVALID_REPORT_QUERY', 400);
  const number = (value, fallback, max, zero = false) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d{1,8}$/.test(value)) fail('INVALID_REPORT_QUERY', 400);
    const n = Number(value); if (!Number.isSafeInteger(n) || n < (zero ? 0 : 1) || n > max) fail('INVALID_REPORT_QUERY', 400); return n;
  };
  const limit = number(query.limit, 100, 500);
  if (mode === 'after' && query.after !== undefined && !isId(query.after)) fail('INVALID_REPORT_QUERY', 400);
  return { limit, after: query.after || null, offset: mode === 'offset' ? number(query.offset, 0, 50000000, true) : 0 };
}

function definitionDTO(value) {
  if (!value || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 100) fail();
  return { questions: value.questions.map(question => {
    if (!question || typeof question.id !== 'string' || typeof question.prompt !== 'string' || question.prompt.length > 2000
      || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) fail();
    return { id: question.id, prompt: question.prompt, options: question.options.map(option => {
      if (!option || typeof option.id !== 'string' || typeof option.label !== 'string' || option.label.length > 500) fail();
      return { id: option.id, label: option.label };
    }) };
  }) };
}

function resultRowDTO(row, definition, category) {
  if (!row || !isId(row.participantId) || typeof row.label !== 'string' || row.label.length > 140
    || !['COMPLETED', 'INCOMPLETE'].includes(row.state) || !Array.isArray(row.answers) || row.answers.length > definition.questions.length) fail();
  const output = { label: row.label, state: row.state, answers: row.answers.map(answer => {
    const question = definition.questions.find(item => item.id === answer.questionId);
    if (!question || !question.options.some(option => option.id === answer.optionId) || typeof answer.correct !== 'boolean') fail();
    return { questionId: answer.questionId, optionId: answer.optionId, correct: answer.correct };
  }) };
  for (const key of ['correctCount', 'incorrectCount', 'omittedCount', 'totalQuestions', 'correctTimeMs', 'timeUsedMs']) {
    if (!Number.isFinite(row[key]) || row[key] < 0) fail(); output[key] = row[key];
  }
  if (category === 'contest') { if (!Number.isSafeInteger(row.position) || row.position < 1 || row.position > 10) fail(); output.position = row.position; }
  else { if (!Number.isFinite(row.grade) || row.grade < 0 || row.grade > 100) fail(); output.grade = row.grade; }
  return output;
}

class EventReportsRepository {
  constructor({ domain, enabled = () => false }) { this.domain = domain; this.enabled = enabled; }
  checkEnabled() { if (!this.enabled()) fail('EVENTS_V2_DISABLED', 404); }
  async resource(db, eventId, liveId) {
    const [rows] = await db.execute(`SELECT l.id, l.event_workspace_id, l.deck_id, l.event_activity_id, l.event_stage_id, l.status, l.started_at, l.ended_at
      FROM event_live_sessions l
      JOIN event_activities a ON a.id = l.event_activity_id AND a.event_workspace_id = l.event_workspace_id AND a.event_stage_id = l.event_stage_id
      JOIN event_stages s ON s.id = l.event_stage_id AND s.event_workspace_id = l.event_workspace_id
      WHERE l.id = ? AND l.event_workspace_id = ?`, [liveId, eventId]);
    if (!rows[0]) fail('RESOURCE_NOT_FOUND', 404); return rows[0];
  }
  async record(db, family, live) {
    const [rows] = await db.execute(`SELECT * FROM ${TABLES[family]} WHERE id = ?`, [live.id]);
    const row = rows[0];
    if (row && (row.stage_id !== live.event_stage_id || row.activity_id !== live.event_activity_id || row.deck_id !== live.deck_id
      || typeof row.version_id !== 'string' || !row.version_id || row.version_id.length > 191)) fail();
    if (row && family !== 'reactions' && row.source_session_id !== executionKey(live.event_workspace_id, live.id)) fail();
    return row || null;
  }
  async read({ actor, organizationId, eventId, liveId, family, executionId = null, exportCsv = false, query = {} }) {
    this.checkEnabled();
    if (![organizationId, eventId, liveId].every(isId) || typeof family !== 'string' || !Object.hasOwn(TABLES, family) || (executionId && !isId(executionId))
      || (exportCsv && family === 'knowledge' && !executionId)) fail('INVALID_REPORT_QUERY', 400);
    const action = exportCsv ? 'event.metrics.export' : 'event.metrics.read';
    const result = await this.domain.transaction(actor, action, async db => {
      this.checkEnabled(); await this.domain.event(db, organizationId, eventId, actor, action);
      const page = pagination(query, family === 'reactions' ? 'none' : executionId ? 'offset' : 'after');
      const live = await this.resource(db, eventId, liveId), record = await this.record(db, family, live);
      const context = { eventId, liveSessionId: liveId, stageId: live.event_stage_id, activityId: live.event_activity_id, versionId: record?.version_id || null };
      let data;
      if (family === 'qna') data = await this.qna(db, context, record, page);
      else if (family === 'knowledge') data = executionId ? await this.results(db, context, record, executionId, page) : await this.knowledgeHistory(db, context, record, page);
      else data = await this.reactions(db, context, record);
      this.checkEnabled();
      await this.domain.audit(db, actor, action, organizationId, eventId, liveId);
      if (!exportCsv) return { ...context, ...data };
      const content = family === 'qna' ? csv([['Ronda', 'Pregunta', 'Nombre', 'Proyectada', 'Fecha'], ...data.questions.map(q => [q.roundNumber, q.question, q.name, q.answered ? 'Sí' : 'No', q.createdAt])])
        : family === 'reactions' ? csv([['Evento', 'Sesión', 'Corazones', 'Aplausos', 'Fuego', 'Total'], [eventId, liveId, data.counts.heart, data.counts.clap, data.counts.fire, data.counts.total]])
          : resultCsv({ category: data.category, definition: data.definition, result: { rows: data.rows, top10: data.rows } }, { cell: csvCell });
      return { format: 'csv', csv: content, filename: `immersa-event-${eventId}-${liveId}-${family}${executionId ? '-' + executionId : ''}.csv`,
        nextAfter: data.nextAfter || null, nextOffset: data.nextOffset ?? null, rowCount: data.questions?.length ?? data.rows?.length ?? 1 };
    });
    this.checkEnabled(); return result;
  }
  async qna(db, context, record, page) {
    if (!record) return { questions: [], nextAfter: null };
    const [bad] = await db.execute(`SELECT q.id FROM event_v2_qna_questions q JOIN event_v2_qna_rounds r ON r.id = q.qna_round_id
      LEFT JOIN event_participants p ON p.id = q.audience_id
      WHERE r.presentation_session_id = ? AND (p.id IS NULL OR p.event_workspace_id <> ?) LIMIT 1`, [context.liveSessionId, context.eventId]);
    if (bad.length) fail();
    let afterSql = '', values = [context.liveSessionId];
    if (page.after) {
      const [anchor] = await db.execute(`SELECT r.round_number, q.created_at, q.id FROM event_v2_qna_questions q
        JOIN event_v2_qna_rounds r ON r.id = q.qna_round_id WHERE r.presentation_session_id = ? AND q.id = ?`, [context.liveSessionId, page.after]);
      if (!anchor[0]) fail('INVALID_REPORT_QUERY', 400);
      afterSql = ' AND (r.round_number, q.created_at, q.id) > (?, ?, ?)'; values.push(anchor[0].round_number, anchor[0].created_at, anchor[0].id);
    }
    const [rows] = await db.execute(`SELECT q.id, r.round_number, q.question_text, q.name, q.projected_at, q.created_at
      FROM event_v2_qna_questions q JOIN event_v2_qna_rounds r ON r.id = q.qna_round_id
      WHERE r.presentation_session_id = ?${afterSql} ORDER BY r.round_number, q.created_at, q.id LIMIT ?`, [...values, page.limit + 1]);
    const selected = rows.slice(0, page.limit);
    return { questions: selected.map(row => ({ id: row.id, roundNumber: Number(row.round_number), question: row.question_text, name: row.name || '', answered: Boolean(row.projected_at), createdAt: date(row.created_at) })),
      nextAfter: rows.length > page.limit ? selected.at(-1).id : null };
  }
  async knowledgeHistory(db, context, record, page) {
    if (!record) return { executions: [], nextAfter: null };
    let afterSql = '', values = [context.liveSessionId];
    if (page.after) {
      const [anchor] = await db.execute('SELECT id, opened_at FROM event_v2_knowledge_executions WHERE presentation_session_id = ? AND id = ?', [context.liveSessionId, page.after]);
      if (!anchor[0]) fail('INVALID_REPORT_QUERY', 400);
      afterSql = ' AND (e.opened_at, e.id) > (?, ?)'; values.push(anchor[0].opened_at, anchor[0].id);
    }
    const [rows] = await db.execute(`SELECT e.id, e.category, e.title, e.state, e.opened_at, e.started_at, e.closed_at,
      (r.execution_id IS NOT NULL) AS results_ready FROM event_v2_knowledge_executions e
      LEFT JOIN event_v2_knowledge_results r ON r.execution_id = e.id
      WHERE e.presentation_session_id = ?${afterSql} ORDER BY e.opened_at, e.id LIMIT ?`, [...values, page.limit + 1]);
    const selected = rows.slice(0, page.limit);
    return { executions: selected.map(row => ({ executionId: row.id, category: row.category, title: row.title, state: row.state, openedAt: date(row.opened_at), startedAt: date(row.started_at), closedAt: date(row.closed_at), resultsReady: Boolean(row.results_ready) })),
      nextAfter: rows.length > page.limit ? selected.at(-1).id : null };
  }
  async results(db, context, record, executionId, page) {
    if (!record) fail('RESOURCE_NOT_FOUND', 404);
    const [rows] = await db.execute(`SELECT e.id, e.category, e.title, e.state,
      JSON_UNQUOTE(JSON_EXTRACT(e.snapshot_json, '$.id')) AS snapshot_id,
      JSON_UNQUOTE(JSON_EXTRACT(e.snapshot_json, '$.presentationSessionId')) AS snapshot_live,
      JSON_UNQUOTE(JSON_EXTRACT(e.snapshot_json, '$.sourceSessionId')) AS snapshot_source,
      JSON_UNQUOTE(JSON_EXTRACT(e.snapshot_json, '$.deckId')) AS snapshot_deck,
      JSON_EXTRACT(e.snapshot_json, '$.definition') AS definition_json,
      r.execution_id AS result_id,
      JSON_UNQUOTE(JSON_EXTRACT(r.result_json, '$.executionId')) AS result_execution,
      JSON_UNQUOTE(JSON_EXTRACT(r.result_json, '$.category')) AS result_category,
      JSON_LENGTH(JSON_EXTRACT(r.result_json, IF(e.category = 'contest', '$.top10', '$.rows'))) AS row_count
      FROM event_v2_knowledge_executions e LEFT JOIN event_v2_knowledge_results r ON r.execution_id = e.id
      WHERE e.id = ? AND e.presentation_session_id = ?`, [executionId, context.liveSessionId]);
    const row = rows[0]; if (!row) fail('RESOURCE_NOT_FOUND', 404);
    if (row.snapshot_id !== executionId || row.snapshot_live !== context.liveSessionId || row.snapshot_source !== executionKey(context.eventId, context.liveSessionId)
      || row.snapshot_deck !== record.deck_id || !['contest', 'assessment'].includes(row.category)) fail();
    if (!row.result_id) fail('REPORT_RESULTS_NOT_READY', 409);
    if (row.result_execution !== executionId || row.result_category !== row.category || !Number.isSafeInteger(Number(row.row_count)) || Number(row.row_count) < 0) fail();
    const total = Number(row.row_count), definition = definitionDTO(parseJson(row.definition_json));
    const length = Math.max(0, Math.min(page.limit, total - page.offset));
    let raw = [];
    if (length) {
      const field = row.category === 'contest' ? 'top10' : 'rows';
      const paths = Array.from({ length }, (_, index) => `$.${field}[${page.offset + index}]`);
      const [parts] = await db.execute(`SELECT JSON_EXTRACT(result_json, ${paths.map(() => '?').join(',')}) AS page_json
        FROM event_v2_knowledge_results WHERE execution_id = ?`, [...paths, executionId]);
      const value = parseJson(parts[0]?.page_json); raw = length === 1 ? [value] : value;
      if (!Array.isArray(raw) || raw.length !== length) fail();
      const ids = raw.map(item => item?.participantId); if (!ids.every(isId) || new Set(ids).size !== ids.length) fail();
      const [participants] = await db.execute(`SELECT k.participant_id FROM event_v2_knowledge_participants k
        JOIN event_participants p ON p.id = k.participant_id AND p.event_workspace_id = ?
        WHERE k.execution_id = ? AND k.participant_id IN (${ids.map(() => '?').join(',')})`, [context.eventId, executionId, ...ids]);
      if (participants.length !== ids.length) fail();
    }
    return { executionId, category: row.category, title: row.title, state: row.state, definition,
      rows: raw.map(item => resultRowDTO(item, definition, row.category)), rowCount: total, offset: page.offset,
      nextOffset: page.offset + length < total ? page.offset + length : null };
  }
  async reactions(db, context, record) {
    const [rows] = record ? await db.execute(`SELECT CAST(heart_count AS CHAR) AS heart, CAST(clap_count AS CHAR) AS clap,
      CAST(fire_count AS CHAR) AS fire FROM event_v2_reaction_counts WHERE id = ?`, [context.liveSessionId]) : [[]];
    const counts = rows[0] || { heart: '0', clap: '0', fire: '0' };
    for (const value of Object.values(counts)) if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) fail();
    return { counts: { ...counts, total: (BigInt(counts.heart) + BigInt(counts.clap) + BigInt(counts.fire)).toString() } };
  }
}
module.exports = { EventReportsRepository, csvCell, csv, pagination, definitionDTO, resultRowDTO };
