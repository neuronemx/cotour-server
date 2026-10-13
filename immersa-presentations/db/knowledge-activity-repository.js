const { randomUUID } = require("node:crypto");
const { KnowledgeActivityError, TERMINAL_STATES } = require("../knowledge-activity-engine");

function parseJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
  return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value));
}

function mysqlDateTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new KnowledgeActivityError("INVALID_DATE", "Knowledge activity contains an invalid date");
  }
  return date.toISOString().slice(0, 23).replace("T", " ");
}

async function inTransaction(pool, operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function activeSessionKey(execution) {
  return TERMINAL_STATES.has(execution.state) ? null : execution.presentationSessionId;
}

// Participant and answer rows are authoritative for the high-cardinality part
// of an execution. Keeping them out of snapshot_json keeps an answer write
// bounded even when a Trivia has thousands of people ready.
function snapshotForStorage(execution) {
  const snapshot = { ...execution };
  delete snapshot.participants;
  delete snapshot.answers;
  return snapshot;
}

function executionValues(execution) {
  return [
    execution.id,
    execution.presentationSessionId,
    execution.definitionId,
    execution.category,
    execution.contractVersion,
    execution.title,
    execution.state,
    execution.revision,
    activeSessionKey(execution),
    JSON.stringify(snapshotForStorage(execution)),
    mysqlDateTime(execution.openedAt),
    mysqlDateTime(execution.startedAt),
    mysqlDateTime(execution.deadlineAt || execution.questionDeadlineAt),
    mysqlDateTime(execution.processingStartedAt),
    mysqlDateTime(execution.resultsReadyAt),
    mysqlDateTime(execution.resultsVisibleAt),
    mysqlDateTime(execution.cancelledAt),
    mysqlDateTime(execution.closedAt)
  ];
}

function hydrateExecution(snapshot, participantRows = [], answerRows = []) {
  if (!snapshot) return null;
  const participants = participantRows.map((row) => ({
    id: String(row.participant_id),
    name: row.display_name || "",
    label: row.public_label,
    userNumber: Number(row.user_number),
    state: row.state,
    connected: false,
    activeTabId: row.active_tab_id || "",
    recoveryTokenHash: row.recovery_token_hash || null,
    questionOrder: parseJson(row.question_order_json) || [],
    optionOrders: parseJson(row.option_orders_json) || {},
    currentQuestionIndex: Number(row.current_question_index || 0),
    joinedAt: row.joined_at,
    lastSeenAt: row.submitted_at || row.joined_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    completionMode: null
  }));
  const answers = answerRows.map((row) => ({
    participantId: String(row.participant_id),
    questionId: String(row.question_id),
    optionId: String(row.option_id),
    clientAttemptId: row.client_attempt_id || "",
    correct: Boolean(row.correct),
    elapsedMs: row.elapsed_ms === null || row.elapsed_ms === undefined ? null : Number(row.elapsed_ms),
    receivedAt: row.received_at
  }));
  return { ...snapshot, participants, answers };
}

class KnowledgeActivityRepository {
  constructor(pool, options = {}) {
    if (!pool?.getConnection || !pool?.execute) throw new Error("A MySQL pool is required");
    this.pool = pool;
    this.createId = options.createId || randomUUID;
    const storage = options.storage || "presentations";
    if (!["presentations", "events-v2"].includes(storage)) throw new Error("Invalid knowledge storage");
    this.eventStorage = storage === "events-v2";
    if (this.eventStorage && (!options.executor?.execute || typeof options.transactionExecutor !== "function")) {
      throw new Error("Events knowledge requires an authorized transaction executor");
    }
    this.executor = options.executor || pool;
    this.transactionExecutor = options.transactionExecutor || (operation => inTransaction(pool, operation));
  }

  execute(executor, sql, values) {
    const tables = { presentation_sessions: "event_v2_knowledge_sessions",
      knowledge_activity_executions: "event_v2_knowledge_executions",
      knowledge_activity_participants: "event_v2_knowledge_participants",
      knowledge_activity_participant_orders: "event_v2_knowledge_participant_orders",
      knowledge_activity_answers: "event_v2_knowledge_answers",
      knowledge_activity_results: "event_v2_knowledge_results",
      knowledge_activity_commands: "event_v2_knowledge_commands" };
    // Fixed SQL identifiers only. JSON parameters work on MySQL and MariaDB;
    // the legacy SQL is unchanged, including its historical casts.
    const statement = this.eventStorage ? String(sql)
      .replace(/\b(presentation_sessions|knowledge_activity_\w+)\b/g, table => tables[table] || table)
      .replace(/CAST\(\? AS JSON\)/g, "?") : sql;
    return executor.execute(statement, values);
  }

  requireLegacyLifecycle() {
    if (this.eventStorage) throw new KnowledgeActivityError("KNOWLEDGE_EVENTS_LIFECYCLE_NOT_ENABLED", "Use the authorized Events adapter");
  }

  async ensurePresentationSession({ deckId, sourceSessionId }) {
    this.requireLegacyLifecycle();
    const normalizedDeckId = String(deckId || "").trim();
    const normalizedSourceSessionId = String(sourceSessionId || "").trim();
    if (!normalizedDeckId || !normalizedSourceSessionId) {
      throw new KnowledgeActivityError("INVALID_INPUT", "deckId and sourceSessionId are required");
    }
    return this.transactionExecutor( async (connection) => {
      const [rows] = await this.execute(connection, 
        `SELECT id
         FROM presentation_sessions
         WHERE deck_id = ? AND source_session_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [normalizedDeckId, normalizedSourceSessionId]
      );
      if (rows[0]) return rows[0].id;
      const presentationSessionId = this.createId();
      await this.execute(connection, 
        `INSERT INTO presentation_sessions (id, deck_id, source_session_id)
         VALUES (?, ?, ?)`,
        [presentationSessionId, normalizedDeckId, normalizedSourceSessionId]
      );
      return presentationSessionId;
    });
  }

  async createExecution(execution) {
    try {
      await this.execute(this.executor, 
        `INSERT INTO knowledge_activity_executions
           (id, presentation_session_id, source_definition_id, category, contract_version,
            title, state, revision, active_session_key, snapshot_json, opened_at, started_at,
            deadline_at, processing_started_at, results_ready_at, results_visible_at,
            cancelled_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?, ?)`,
        executionValues(execution)
      );
      return execution;
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
        throw new KnowledgeActivityError("INTERACTION_BUSY", "Another knowledge activity is active");
      }
      throw error;
    }
  }

  async saveExecution(execution, {
    expectedRevision,
    participants: participantsToSave,
    answers: answersToSave
  } = {}) {
    return this.transactionExecutor( async (connection) => {
      const values = executionValues(execution);
      const [updated] = await this.execute(connection, 
        `UPDATE knowledge_activity_executions
         SET source_definition_id = ?, category = ?, contract_version = ?, title = ?,
             state = ?, revision = ?, active_session_key = ?, snapshot_json = CAST(? AS JSON),
             started_at = ?, deadline_at = ?, processing_started_at = ?,
             results_ready_at = ?, results_visible_at = ?, cancelled_at = ?, closed_at = ?
         WHERE id = ? AND revision = ?`,
        [
          values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9],
          values[11], values[12], values[13], values[14], values[15], values[16], values[17],
          execution.id, Number(expectedRevision)
        ]
      );
      if (!updated.affectedRows) {
        throw new KnowledgeActivityError("STALE_REVISION", "The persisted execution revision changed");
      }

      const participants = Array.isArray(participantsToSave)
        ? participantsToSave
        : execution.participants;
      for (const participant of participants) {
        await this.execute(connection, 
          `INSERT INTO knowledge_activity_participants
             (execution_id, participant_id, recovery_token_hash, user_number, display_name, public_label,
              active_tab_id, state, joined_at, submitted_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             recovery_token_hash = COALESCE(recovery_token_hash, VALUES(recovery_token_hash)),
             display_name = VALUES(display_name),
             public_label = VALUES(public_label),
             active_tab_id = VALUES(active_tab_id),
             state = VALUES(state),
             submitted_at = VALUES(submitted_at),
             completed_at = VALUES(completed_at)`,
          [
            execution.id,
            participant.id,
            participant.recoveryTokenHash || null,
            participant.userNumber,
            participant.name || null,
            participant.label,
            participant.activeTabId || null,
            participant.state,
            mysqlDateTime(participant.joinedAt),
            mysqlDateTime(participant.submittedAt),
            mysqlDateTime(participant.completedAt)
          ]
        );
        await this.execute(connection, 
          `INSERT INTO knowledge_activity_participant_orders
             (execution_id, participant_id, question_order_json, option_orders_json, current_question_index)
           VALUES (?, ?, CAST(? AS JSON), CAST(? AS JSON), ?)
           ON DUPLICATE KEY UPDATE
             question_order_json = VALUES(question_order_json),
             option_orders_json = VALUES(option_orders_json),
             current_question_index = VALUES(current_question_index)`,
          [
            execution.id,
            participant.id,
            JSON.stringify(participant.questionOrder),
            JSON.stringify(participant.optionOrders),
            participant.currentQuestionIndex || 0
          ]
        );
      }

      const answers = Array.isArray(answersToSave)
        ? answersToSave
        : execution.answers;
      for (const answer of answers) {
        await this.execute(connection, 
          `INSERT INTO knowledge_activity_answers
             (execution_id, participant_id, question_id, option_id, client_attempt_id,
              correct, elapsed_ms, received_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             option_id = VALUES(option_id),
             client_attempt_id = VALUES(client_attempt_id),
             correct = VALUES(correct),
             elapsed_ms = VALUES(elapsed_ms),
             received_at = VALUES(received_at)`,
          [
            execution.id,
            answer.participantId,
            answer.questionId,
            answer.optionId,
            answer.clientAttemptId || null,
            answer.correct ? 1 : 0,
            Number.isFinite(answer.elapsedMs) ? answer.elapsedMs : null,
            mysqlDateTime(answer.receivedAt)
          ]
        );
      }

      for (const command of execution.commandLog) {
        await this.execute(connection, 
          `INSERT IGNORE INTO knowledge_activity_commands
             (execution_id, command_id, actor_role, intent, applied_revision, result_json, applied_at)
           VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [
            execution.id,
            command.commandId,
            command.actorRole,
            command.intent,
            command.result.revision,
            JSON.stringify(command.result),
            mysqlDateTime(command.appliedAt)
          ]
        );
      }

      if (execution.result) {
        await this.execute(connection, 
          `INSERT IGNORE INTO knowledge_activity_results
             (execution_id, mode, revision, excluded_response_count, result_json, created_at)
           VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [
            execution.id,
            execution.result.mode,
            execution.revision,
            execution.result.excludedResponseCount || 0,
            JSON.stringify(execution.result),
            mysqlDateTime(execution.result.calculatedAt)
          ]
        );
      }
      return execution;
    });
  }

  async saveAnswerBatch(execution, { expectedRevision, participants = [], answers = [] } = {}) {
    if (!answers.length) return execution;
    return this.transactionExecutor( async (connection) => {
      const values = executionValues(execution);
      const [updated] = await this.execute(connection, 
        `UPDATE knowledge_activity_executions
         SET state = ?, revision = ?, active_session_key = ?, snapshot_json = CAST(? AS JSON),
             deadline_at = ?, processing_started_at = ?, results_ready_at = ?,
             results_visible_at = ?, cancelled_at = ?, closed_at = ?
         WHERE id = ? AND revision = ?`,
        [values[6], values[7], values[8], values[9], values[12], values[13], values[14], values[15], values[16], values[17], execution.id, Number(expectedRevision)]
      );
      if (!updated.affectedRows) throw new KnowledgeActivityError("STALE_REVISION", "The persisted execution revision changed");
      const uniqueParticipants = [...new Map((participants || []).map((participant) => [participant.id, participant])).values()];
      if (uniqueParticipants.length) {
        const participantValues = uniqueParticipants.flatMap((participant) => [
          execution.id,
          participant.id,
          participant.recoveryTokenHash || null,
          participant.userNumber,
          participant.name || null,
          participant.label,
          participant.activeTabId || null,
          participant.state,
          mysqlDateTime(participant.joinedAt),
          mysqlDateTime(participant.submittedAt),
          mysqlDateTime(participant.completedAt)
        ]);
        await this.execute(connection, 
          `INSERT INTO knowledge_activity_participants
             (execution_id, participant_id, recovery_token_hash, user_number, display_name, public_label,
              active_tab_id, state, joined_at, submitted_at, completed_at)
           VALUES ${uniqueParticipants.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
           ON DUPLICATE KEY UPDATE
             recovery_token_hash = COALESCE(recovery_token_hash, VALUES(recovery_token_hash)),
             display_name = VALUES(display_name), public_label = VALUES(public_label),
             state = VALUES(state), active_tab_id = VALUES(active_tab_id),
             submitted_at = VALUES(submitted_at), completed_at = VALUES(completed_at)`,
          participantValues
        );
      }
      const answerValues = answers.flatMap((answer) => [execution.id, answer.participantId, answer.questionId, answer.optionId, answer.clientAttemptId || null, answer.correct ? 1 : 0, Number.isFinite(answer.elapsedMs) ? answer.elapsedMs : null, mysqlDateTime(answer.receivedAt)]);
      await this.execute(connection, 
        `INSERT INTO knowledge_activity_answers
           (execution_id, participant_id, question_id, option_id, client_attempt_id, correct, elapsed_ms, received_at)
         VALUES ${answers.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
         ON DUPLICATE KEY UPDATE
           option_id = VALUES(option_id), client_attempt_id = VALUES(client_attempt_id), correct = VALUES(correct), elapsed_ms = VALUES(elapsed_ms), received_at = VALUES(received_at)`,
        answerValues
      );
      return execution;
    });
  }

  async hydrate(row, executor = this.executor) {
    if (!row?.snapshot_json) return null;
    const snapshot = parseJson(row.snapshot_json);
    const [participants] = await this.execute(executor, 
      `SELECT p.participant_id, p.recovery_token_hash, p.user_number, p.display_name, p.public_label,
              p.active_tab_id, p.state, p.joined_at, p.submitted_at, p.completed_at,
              o.question_order_json, o.option_orders_json, o.current_question_index
       FROM knowledge_activity_participants p
       LEFT JOIN knowledge_activity_participant_orders o
         ON o.execution_id = p.execution_id AND o.participant_id = p.participant_id
       WHERE p.execution_id = ?
       ORDER BY p.user_number`,
      [String(row.id || snapshot.id || "")]
    );
    const [answers] = await this.execute(executor, 
      `SELECT participant_id, question_id, option_id, client_attempt_id, correct, elapsed_ms, received_at
       FROM knowledge_activity_answers
       WHERE execution_id = ?
       ORDER BY received_at, participant_id, question_id`,
      [String(row.id || snapshot.id || "")]
    );
    const execution = hydrateExecution(snapshot, participants || [], answers || []);
    if (this.eventStorage) {
      for (const participant of execution.participants) for (const field of ['joinedAt', 'lastSeenAt', 'submittedAt', 'completedAt']) {
        if (participant[field]) participant[field] = new Date(participant[field]).toISOString();
      }
      for (const answer of execution.answers) if (answer.receivedAt) answer.receivedAt = new Date(answer.receivedAt).toISOString();
    }
    return execution;
  }

  async loadExecution(executionId) {
    const [rows] = await this.execute(this.executor, 
      `SELECT id, snapshot_json
       FROM knowledge_activity_executions
       WHERE id = ?
       LIMIT 1`,
      [String(executionId || "")]
    );
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async loadActiveExecution({ deckId, sourceSessionId }) {
    const [rows] = await this.execute(this.executor, 
      `SELECT e.id, e.snapshot_json
       FROM knowledge_activity_executions e
       INNER JOIN presentation_sessions ps ON ps.id = e.presentation_session_id
       WHERE ps.deck_id = ? AND ps.source_session_id = ?
         AND e.active_session_key IS NOT NULL
       LIMIT 1`,
      [String(deckId || ""), String(sourceSessionId || "")]
    );
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async listActiveExecutions() {
    this.requireLegacyLifecycle();
    const [rows] = await this.execute(this.executor, 
      `SELECT id, snapshot_json
       FROM knowledge_activity_executions
       WHERE active_session_key IS NOT NULL`
    );
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async listHistory(deckId) {
    this.requireLegacyLifecycle();
    const [rows] = await this.execute(this.executor, 
      `SELECT e.id, e.snapshot_json
       FROM knowledge_activity_executions e
       INNER JOIN presentation_sessions ps ON ps.id = e.presentation_session_id
       WHERE ps.deck_id = ? AND ps.recording_started_at IS NOT NULL
       ORDER BY e.opened_at DESC, e.id DESC`,
      [String(deckId || "")]
    );
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }
}

module.exports = { KnowledgeActivityRepository, parseJson, inTransaction, mysqlDateTime, snapshotForStorage, hydrateExecution };
