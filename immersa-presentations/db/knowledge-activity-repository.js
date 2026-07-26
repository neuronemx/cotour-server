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
    JSON.stringify(execution),
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

class KnowledgeActivityRepository {
  constructor(pool, options = {}) {
    if (!pool?.getConnection || !pool?.execute) throw new Error("A MySQL pool is required");
    this.pool = pool;
    this.createId = options.createId || randomUUID;
  }

  async ensurePresentationSession({ deckId, sourceSessionId }) {
    const normalizedDeckId = String(deckId || "").trim();
    const normalizedSourceSessionId = String(sourceSessionId || "").trim();
    if (!normalizedDeckId || !normalizedSourceSessionId) {
      throw new KnowledgeActivityError("INVALID_INPUT", "deckId and sourceSessionId are required");
    }
    return inTransaction(this.pool, async (connection) => {
      const [rows] = await connection.execute(
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
      await connection.execute(
        `INSERT INTO presentation_sessions (id, deck_id, source_session_id)
         VALUES (?, ?, ?)`,
        [presentationSessionId, normalizedDeckId, normalizedSourceSessionId]
      );
      return presentationSessionId;
    });
  }

  async createExecution(execution) {
    try {
      await this.pool.execute(
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

  async saveExecution(execution, { expectedRevision }) {
    return inTransaction(this.pool, async (connection) => {
      const values = executionValues(execution);
      const [updated] = await connection.execute(
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

      for (const participant of execution.participants) {
        await connection.execute(
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
        await connection.execute(
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

      for (const answer of execution.answers) {
        await connection.execute(
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
        await connection.execute(
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
        await connection.execute(
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

  async loadExecution(executionId) {
    const [rows] = await this.pool.execute(
      `SELECT snapshot_json
       FROM knowledge_activity_executions
       WHERE id = ?
       LIMIT 1`,
      [String(executionId || "")]
    );
    return rows[0] ? parseJson(rows[0].snapshot_json) : null;
  }

  async loadActiveExecution({ deckId, sourceSessionId }) {
    const [rows] = await this.pool.execute(
      `SELECT e.snapshot_json
       FROM knowledge_activity_executions e
       INNER JOIN presentation_sessions ps ON ps.id = e.presentation_session_id
       WHERE ps.deck_id = ? AND ps.source_session_id = ?
         AND e.active_session_key IS NOT NULL
       ORDER BY e.opened_at DESC, e.id DESC
       LIMIT 1`,
      [String(deckId || ""), String(sourceSessionId || "")]
    );
    return rows[0] ? parseJson(rows[0].snapshot_json) : null;
  }

  async listActiveExecutions() {
    const [rows] = await this.pool.execute(
      `SELECT snapshot_json
       FROM knowledge_activity_executions
       WHERE active_session_key IS NOT NULL
       ORDER BY opened_at`
    );
    return rows.map((row) => parseJson(row.snapshot_json));
  }

  async listHistory(deckId) {
    const [rows] = await this.pool.execute(
      `SELECT e.snapshot_json
       FROM knowledge_activity_executions e
       INNER JOIN presentation_sessions ps ON ps.id = e.presentation_session_id
       WHERE ps.deck_id = ?
       ORDER BY e.opened_at DESC, e.id DESC`,
      [String(deckId || "")]
    );
    return rows.map((row) => parseJson(row.snapshot_json));
  }
}

module.exports = { KnowledgeActivityRepository, parseJson, inTransaction, mysqlDateTime };
