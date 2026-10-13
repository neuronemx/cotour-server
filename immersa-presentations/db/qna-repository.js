const { randomUUID } = require("node:crypto");

const QNA_SUBMISSION_COOLDOWN_MS = 10_000;

class QnaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QnaError";
    this.code = code;
  }
}

function requiredText(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new QnaError("QNA_INVALID_INPUT", `${field} is required`);
  if (normalized.length > maxLength) throw new QnaError("QNA_INVALID_INPUT", `${field} is too long`);
  return normalized;
}

function optionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new QnaError("QNA_INVALID_INPUT", "name is too long");
  return normalized;
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

function firstRow(result) {
  return result?.[0]?.[0] || null;
}

class QnaRepository {
  constructor(pool, options = {}) {
    if (!pool?.getConnection) throw new Error("A MySQL pool is required");
    this.pool = pool;
    const storage = options.storage || "presentations";
    if (!["presentations", "events-v2"].includes(storage)) throw new Error("Invalid Q&A storage");
    this.eventStorage = storage === "events-v2";
    if (this.eventStorage && (!options.executor?.execute || typeof options.transactionExecutor !== "function")) {
      throw new Error("Events Q&A requires an authorized transaction executor");
    }
    this.executor = options.executor || pool;
    this.transactionExecutor = options.transactionExecutor || (operation => inTransaction(pool, operation));
    this.createId = options.createId || randomUUID;
    this.now = typeof options.now === "function" ? options.now : Date.now;
  }

  execute(executor, sql, values) {
    const statement = this.eventStorage ? String(sql).replace(/\b(presentation_sessions|qna_rounds|qna_questions)\b/g,
      table => ({ presentation_sessions: "event_v2_qna_sessions", qna_rounds: "event_v2_qna_rounds", qna_questions: "event_v2_qna_questions" })[table]) : sql;
    return executor.execute(statement, values);
  }

  requireLegacyLifecycle() {
    if (this.eventStorage) throw new QnaError("QNA_EVENTS_LIFECYCLE_NOT_ENABLED", "Use the authorized Events adapter");
  }

  async startPresentationSession({ deckId, sourceSessionId, replaceActive = false }) {
    this.requireLegacyLifecycle();
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    const normalizedSourceSessionId = requiredText(sourceSessionId, "sourceSessionId", 191);
    const presentationSessionId = this.createId();
    const qnaRoundId = this.createId();

    return this.transactionExecutor(async (connection) => {
      if (replaceActive) {
        await this.execute(connection, 
          `UPDATE qna_rounds r
           INNER JOIN presentation_sessions ps ON ps.id = r.presentation_session_id
           SET r.archived_at = COALESCE(r.archived_at, CURRENT_TIMESTAMP(3))
           WHERE ps.deck_id = ? AND ps.source_session_id = ?
             AND ps.ended_at IS NULL AND r.archived_at IS NULL`,
          [normalizedDeckId, normalizedSourceSessionId]
        );
        await this.execute(connection, 
          `UPDATE presentation_sessions
           SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
           WHERE deck_id = ? AND source_session_id = ? AND ended_at IS NULL`,
          [normalizedDeckId, normalizedSourceSessionId]
        );
      }
      await this.execute(connection, 
        `INSERT INTO presentation_sessions (id, deck_id, source_session_id)
         VALUES (?, ?, ?)`,
        [presentationSessionId, normalizedDeckId, normalizedSourceSessionId]
      );
      await this.execute(connection, 
        `INSERT INTO qna_rounds (id, presentation_session_id, round_number, questions_open)
         VALUES (?, ?, 1, 0)`,
        [qnaRoundId, presentationSessionId]
      );
      return { presentationSessionId, qnaRoundId, roundNumber: 1, questionsOpen: false };
    });
  }

  async getActivePresentationSession({ deckId, sourceSessionId }) {
    this.requireLegacyLifecycle();
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    const normalizedSourceSessionId = requiredText(sourceSessionId, "sourceSessionId", 191);
    const [rows] = await this.execute(this.executor, 
      `SELECT id, deck_id, source_session_id, started_at
       FROM presentation_sessions
       WHERE deck_id = ? AND source_session_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC, id DESC
       LIMIT 1`,
      [normalizedDeckId, normalizedSourceSessionId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      presentationSessionId: row.id,
      deckId: row.deck_id,
      sourceSessionId: row.source_session_id,
      startedAt: row.started_at
    };
  }

  async endPresentationSession(presentationSessionId) {
    this.requireLegacyLifecycle();
    const id = requiredText(presentationSessionId, "presentationSessionId", 36);
    const [result] = await this.execute(this.executor, 
      `UPDATE presentation_sessions
       SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
       WHERE id = ?`,
      [id]
    );
    if (!result.affectedRows) throw new QnaError("QNA_SESSION_NOT_FOUND", "Presentation session not found");
  }

  async activeRound(connection, presentationSessionId, lock = false) {
    const [rows] = await this.execute(connection, 
      `SELECT id, round_number, questions_open
       FROM qna_rounds
       WHERE presentation_session_id = ? AND archived_at IS NULL
       ORDER BY round_number DESC
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [presentationSessionId]
    );
    const round = rows[0];
    if (!round) throw new QnaError("QNA_ROUND_NOT_FOUND", "Active Q&A round not found");
    return round;
  }

  async setQuestionsOpen({ presentationSessionId, open }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    return this.transactionExecutor(async (connection) => {
      const round = await this.activeRound(connection, sessionId, true);
      const questionsOpen = Boolean(open);
      await this.execute(connection, "UPDATE qna_rounds SET questions_open = ? WHERE id = ?", [questionsOpen ? 1 : 0, round.id]);
      return { qnaRoundId: round.id, questionsOpen };
    });
  }

  async submitQuestion({ presentationSessionId, audienceId, questionText, name, allowNameOnScreen }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const normalizedAudienceId = requiredText(audienceId, "audienceId", 191);
    const normalizedQuestion = requiredText(questionText, "questionText", 1000);
    const normalizedName = optionalText(name, 120);
    const questionId = this.createId();

    return this.transactionExecutor(async (connection) => {
      const round = await this.activeRound(connection, sessionId, true);
      if (!round.questions_open) throw new QnaError("QNA_CLOSED", "Questions are closed");
      const [recentRows] = await this.execute(connection, 
        `SELECT created_at
         FROM qna_questions
         WHERE qna_round_id = ? AND audience_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
        [round.id, normalizedAudienceId]
      );
      const lastSubmittedAt = recentRows[0]?.created_at ? new Date(recentRows[0].created_at).getTime() : 0;
      const retryAfterMs = Math.max(0, QNA_SUBMISSION_COOLDOWN_MS - (this.now() - lastSubmittedAt));
      if (lastSubmittedAt && retryAfterMs > 0) {
        const error = new QnaError("QNA_COOLDOWN", "Wait before submitting another question");
        error.retryAfterMs = retryAfterMs;
        throw error;
      }
      const values = [questionId, round.id, normalizedAudienceId, normalizedQuestion, normalizedName, allowNameOnScreen ? 1 : 0];
      if (this.eventStorage) {
        await this.execute(connection,
          `INSERT INTO qna_questions (id,qna_round_id,audience_id,question_text,name,allow_name_on_screen,created_at)
           VALUES (?,?,?,?,?,?,?)`, [...values, new Date(this.now())]);
      } else {
        await this.execute(connection,
          `INSERT INTO qna_questions
             (id, qna_round_id, audience_id, question_text, name, allow_name_on_screen)
           VALUES (?, ?, ?, ?, ?, ?)`, values);
      }
      return { questionId, qnaRoundId: round.id };
    });
  }

  async lockActiveQuestion(connection, presentationSessionId, questionId) {
    const [rows] = await this.execute(connection, 
      `SELECT q.id, q.qna_round_id, q.projected_at
       FROM qna_questions q
       INNER JOIN qna_rounds r ON r.id = q.qna_round_id
       WHERE q.id = ? AND r.presentation_session_id = ? AND r.archived_at IS NULL
       FOR UPDATE`,
      [questionId, presentationSessionId]
    );
    if (!rows[0]) throw new QnaError("QNA_QUESTION_NOT_FOUND", "Question not found in the active round");
    return rows[0];
  }

  async markSelected(connection, question) {
    await this.execute(connection, 
      `UPDATE qna_questions
       SET status = 'new', selected_round_id = NULL
       WHERE qna_round_id = ? AND status = 'selected'`,
      [question.qna_round_id]
    );
    await this.execute(connection, 
      `UPDATE qna_questions
       SET status = 'selected', selected_round_id = qna_round_id
       WHERE id = ?`,
      [question.id]
    );
  }

  async selectQuestion({ presentationSessionId, questionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const id = requiredText(questionId, "questionId", 36);
    return this.transactionExecutor(async (connection) => {
      const question = await this.lockActiveQuestion(connection, sessionId, id);
      await this.markSelected(connection, question);
      return { questionId: id, qnaRoundId: question.qna_round_id };
    });
  }

  async projectQuestion({ presentationSessionId, questionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const id = requiredText(questionId, "questionId", 36);
    return this.transactionExecutor(async (connection) => {
      const question = await this.lockActiveQuestion(connection, sessionId, id);
      await this.markSelected(connection, question);
      await this.execute(connection, 
        `UPDATE qna_questions
         SET projected_at = COALESCE(projected_at, CURRENT_TIMESTAMP(3))
         WHERE id = ?`,
        [id]
      );
      return { questionId: id, qnaRoundId: question.qna_round_id, answered: true };
    });
  }

  async deleteQuestion({ presentationSessionId, questionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const id = requiredText(questionId, "questionId", 36);
    return this.transactionExecutor(async (connection) => {
      const question = await this.lockActiveQuestion(connection, sessionId, id);
      if (question.projected_at) {
        throw new QnaError("QNA_ALREADY_PROJECTED", "Projected questions cannot be deleted");
      }
      await this.execute(connection, "DELETE FROM qna_questions WHERE id = ?", [id]);
      return { questionId: id, deleted: true };
    });
  }

  async newRound({ presentationSessionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const qnaRoundId = this.createId();
    return this.transactionExecutor(async (connection) => {
      const session = firstRow(await this.execute(connection, 
        `SELECT id FROM presentation_sessions
         WHERE id = ? AND ended_at IS NULL
         FOR UPDATE`,
        [sessionId]
      ));
      if (!session) throw new QnaError("QNA_SESSION_NOT_FOUND", "Active presentation session not found");
      const currentRound = await this.activeRound(connection, sessionId, true);
      const nextRoundNumber = Number(currentRound.round_number) + 1;
      const questionsOpen = Boolean(currentRound.questions_open);
      await this.execute(connection, 
        "UPDATE qna_rounds SET archived_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [currentRound.id]
      );
      await this.execute(connection, 
        `INSERT INTO qna_rounds (id, presentation_session_id, round_number, questions_open)
         VALUES (?, ?, ?, ?)`,
        [qnaRoundId, sessionId, nextRoundNumber, questionsOpen ? 1 : 0]
      );
      return { qnaRoundId, roundNumber: nextRoundNumber, questionsOpen };
    });
  }

  async getActiveState(presentationSessionId) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const [rows] = await this.execute(this.executor, 
      `SELECT
         r.id AS qna_round_id,
         r.round_number,
         r.questions_open,
         q.id AS question_id,
         q.question_text,
         q.name,
         q.allow_name_on_screen,
         q.status,
         q.projected_at,
         q.created_at
       FROM qna_rounds r
       LEFT JOIN qna_questions q ON q.qna_round_id = r.id
       WHERE r.presentation_session_id = ? AND r.archived_at IS NULL
       ORDER BY q.created_at, q.id`,
      [sessionId]
    );
    if (!rows.length) throw new QnaError("QNA_ROUND_NOT_FOUND", "Active Q&A round not found");
    const round = rows[0];
    const questions = rows.filter((row) => row.question_id).map((row) => ({
      id: row.question_id,
      text: row.question_text,
      name: row.name || "",
      allowNameOnScreen: Boolean(row.allow_name_on_screen),
      status: row.status,
      answered: Boolean(row.projected_at),
      projectedAt: row.projected_at || null,
      createdAt: row.created_at
    }));
    return {
      roundId: round.qna_round_id,
      roundNumber: Number(round.round_number),
      questionsOpen: Boolean(round.questions_open),
      selectedQuestionId: questions.find((question) => question.status === "selected")?.id || null,
      questions
    };
  }

  async getAudienceState({ presentationSessionId, audienceId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const normalizedAudienceId = requiredText(audienceId, "audienceId", 191);
    const [rows] = await this.execute(this.executor, 
      `SELECT
         r.id AS qna_round_id,
         r.round_number,
         r.questions_open,
         q.id AS question_id,
         q.created_at AS submitted_at
       FROM qna_rounds r
       LEFT JOIN qna_questions q
         ON q.qna_round_id = r.id AND q.audience_id = ?
       WHERE r.presentation_session_id = ? AND r.archived_at IS NULL
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT 1`,
      [normalizedAudienceId, sessionId]
    );
    const row = rows[0];
    if (!row) throw new QnaError("QNA_ROUND_NOT_FOUND", "Active Q&A round not found");
    const submittedAtMs = row.submitted_at ? new Date(row.submitted_at).getTime() : 0;
    const cooldownRemainingMs = submittedAtMs
      ? Math.max(0, QNA_SUBMISSION_COOLDOWN_MS - (this.now() - submittedAtMs))
      : 0;
    return {
      roundId: row.qna_round_id,
      roundNumber: Number(row.round_number),
      questionsOpen: Boolean(row.questions_open),
      hasSubmitted: cooldownRemainingMs > 0,
      questionId: row.question_id || null,
      cooldownRemainingMs
    };
  }

  async listExportQuestions(presentationSessionId) {
    this.requireLegacyLifecycle();
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const [rows] = await this.execute(this.executor, 
      `SELECT
         ps.id AS presentation_session_id,
         ps.deck_id,
         r.round_number,
         q.id AS question_id,
         q.question_text,
         q.name,
         q.projected_at,
         q.created_at
       FROM presentation_sessions ps
       INNER JOIN qna_rounds r ON r.presentation_session_id = ps.id
       INNER JOIN qna_questions q ON q.qna_round_id = r.id
       WHERE ps.id = ?
       ORDER BY r.round_number, q.created_at, q.id`,
      [sessionId]
    );
    return rows.map((row) => ({
      presentationSessionId: row.presentation_session_id,
      deckId: row.deck_id,
      roundNumber: Number(row.round_number),
      questionId: row.question_id,
      question: row.question_text,
      name: row.name || "",
      answered: Boolean(row.projected_at),
      createdAt: row.created_at
    }));
  }

  async listPresentationSessions(deckId) {
    this.requireLegacyLifecycle();
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    const [rows] = await this.execute(this.executor, 
      `SELECT
         ps.id AS presentation_session_id,
         ps.recording_started_at AS started_at,
         ps.ended_at,
         COUNT(DISTINCT r.id) AS round_count,
         COUNT(q.id) AS question_count,
         COALESCE(SUM(CASE WHEN q.projected_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS answered_count
       FROM presentation_sessions ps
       LEFT JOIN qna_rounds r ON r.presentation_session_id = ps.id
       LEFT JOIN qna_questions q ON q.qna_round_id = r.id
       WHERE ps.deck_id = ? AND ps.recording_started_at IS NOT NULL
       GROUP BY ps.id, ps.recording_started_at, ps.ended_at
       ORDER BY ps.recording_started_at DESC, ps.id DESC`,
      [normalizedDeckId]
    );
    return rows.map((row) => ({
      presentationSessionId: row.presentation_session_id,
      startedAt: row.started_at,
      endedAt: row.ended_at || null,
      roundCount: Number(row.round_count),
      questionCount: Number(row.question_count),
      answeredCount: Number(row.answered_count)
    }));
  }

  async listExportQuestionsByDeck(deckId) {
    this.requireLegacyLifecycle();
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    const [rows] = await this.execute(this.executor, 
      `SELECT
         ps.id AS presentation_session_id,
         ps.deck_id,
         ps.recording_started_at AS started_at,
         r.round_number,
         q.id AS question_id,
         q.question_text,
         q.name,
         q.projected_at,
         q.created_at
       FROM presentation_sessions ps
       INNER JOIN qna_rounds r ON r.presentation_session_id = ps.id
       INNER JOIN qna_questions q ON q.qna_round_id = r.id
       WHERE ps.deck_id = ? AND ps.recording_started_at IS NOT NULL
       ORDER BY ps.recording_started_at, ps.id, r.round_number, q.created_at, q.id`,
      [normalizedDeckId]
    );
    return rows.map((row) => ({
      presentationSessionId: row.presentation_session_id,
      deckId: row.deck_id,
      roundNumber: Number(row.round_number),
      questionId: row.question_id,
      question: row.question_text,
      name: row.name || "",
      answered: Boolean(row.projected_at),
      createdAt: row.created_at
    }));
  }

  async clearDeckHistory(deckId) {
    this.requireLegacyLifecycle();
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    return this.transactionExecutor(async (connection) => {
      const [activeRows] = await this.execute(connection, 
        `SELECT id, source_session_id, recording_started_at
         FROM presentation_sessions
         WHERE deck_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC, id DESC
         LIMIT 1 FOR UPDATE`,
        [normalizedDeckId]
      );
      const active = activeRows[0] || null;
      const [countRows] = await this.execute(connection, 
        `SELECT
           COUNT(DISTINCT ps.id) AS session_count,
           COUNT(q.id) AS question_count
         FROM presentation_sessions ps
         LEFT JOIN qna_rounds r ON r.presentation_session_id = ps.id
         LEFT JOIN qna_questions q ON q.qna_round_id = r.id
         WHERE ps.deck_id = ? AND ps.recording_started_at IS NOT NULL`,
        [normalizedDeckId]
      );
      const counts = countRows[0] || {};

      if (!active) {
        await this.execute(connection, "DELETE FROM presentation_sessions WHERE deck_id = ?", [normalizedDeckId]);
      } else {
        await this.execute(connection, 
          "DELETE FROM presentation_sessions WHERE deck_id = ? AND id <> ?",
          [normalizedDeckId, active.id]
        );
        await this.execute(connection, 
          `DELETE q FROM qna_questions q
           INNER JOIN qna_rounds r ON r.id = q.qna_round_id
           WHERE r.presentation_session_id = ?`,
          [active.id]
        );
        await this.execute(connection, 
          "DELETE FROM qna_rounds WHERE presentation_session_id = ? AND archived_at IS NOT NULL",
          [active.id]
        );
      }

      return {
        deckId: normalizedDeckId,
        deletedSessionCount: Math.max(
          0,
          Number(counts.session_count) - (active?.recording_started_at ? 1 : 0)
        ),
        deletedQuestionCount: Number(counts.question_count) || 0,
        activePresentationSessionId: active?.id || null,
        sourceSessionId: active?.source_session_id || null
      };
    });
  }
}

module.exports = { QNA_SUBMISSION_COOLDOWN_MS, QnaError, QnaRepository, inTransaction };
