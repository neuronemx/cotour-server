const { randomUUID } = require("node:crypto");

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
    this.createId = options.createId || randomUUID;
  }

  async startPresentationSession({ deckId, sourceSessionId, replaceActive = false }) {
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    const normalizedSourceSessionId = requiredText(sourceSessionId, "sourceSessionId", 191);
    const presentationSessionId = this.createId();
    const qnaRoundId = this.createId();

    return inTransaction(this.pool, async (connection) => {
      if (replaceActive) {
        await connection.execute(
          `UPDATE qna_rounds r
           INNER JOIN presentation_sessions ps ON ps.id = r.presentation_session_id
           SET r.archived_at = COALESCE(r.archived_at, CURRENT_TIMESTAMP(3))
           WHERE ps.deck_id = ? AND ps.source_session_id = ?
             AND ps.ended_at IS NULL AND r.archived_at IS NULL`,
          [normalizedDeckId, normalizedSourceSessionId]
        );
        await connection.execute(
          `UPDATE presentation_sessions
           SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
           WHERE deck_id = ? AND source_session_id = ? AND ended_at IS NULL`,
          [normalizedDeckId, normalizedSourceSessionId]
        );
      }
      await connection.execute(
        `INSERT INTO presentation_sessions (id, deck_id, source_session_id)
         VALUES (?, ?, ?)`,
        [presentationSessionId, normalizedDeckId, normalizedSourceSessionId]
      );
      await connection.execute(
        `INSERT INTO qna_rounds (id, presentation_session_id, round_number, questions_open)
         VALUES (?, ?, 1, 0)`,
        [qnaRoundId, presentationSessionId]
      );
      return { presentationSessionId, qnaRoundId, roundNumber: 1, questionsOpen: false };
    });
  }

  async getActivePresentationSession({ deckId, sourceSessionId }) {
    const normalizedDeckId = requiredText(deckId, "deckId", 191);
    const normalizedSourceSessionId = requiredText(sourceSessionId, "sourceSessionId", 191);
    const [rows] = await this.pool.execute(
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
    const id = requiredText(presentationSessionId, "presentationSessionId", 36);
    const [result] = await this.pool.execute(
      `UPDATE presentation_sessions
       SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
       WHERE id = ?`,
      [id]
    );
    if (!result.affectedRows) throw new QnaError("QNA_SESSION_NOT_FOUND", "Presentation session not found");
  }

  async activeRound(connection, presentationSessionId, lock = false) {
    const [rows] = await connection.execute(
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
    return inTransaction(this.pool, async (connection) => {
      const round = await this.activeRound(connection, sessionId, true);
      const questionsOpen = Boolean(open);
      await connection.execute("UPDATE qna_rounds SET questions_open = ? WHERE id = ?", [questionsOpen ? 1 : 0, round.id]);
      return { qnaRoundId: round.id, questionsOpen };
    });
  }

  async submitQuestion({ presentationSessionId, audienceId, questionText, name, allowNameOnScreen }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const normalizedAudienceId = requiredText(audienceId, "audienceId", 191);
    const normalizedQuestion = requiredText(questionText, "questionText", 1000);
    const normalizedName = optionalText(name, 120);
    const questionId = this.createId();

    return inTransaction(this.pool, async (connection) => {
      const round = await this.activeRound(connection, sessionId, true);
      if (!round.questions_open) throw new QnaError("QNA_CLOSED", "Questions are closed");
      try {
        await connection.execute(
          `INSERT INTO qna_questions
             (id, qna_round_id, audience_id, question_text, name, allow_name_on_screen)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [questionId, round.id, normalizedAudienceId, normalizedQuestion, normalizedName, allowNameOnScreen ? 1 : 0]
        );
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
          throw new QnaError("QNA_ALREADY_SUBMITTED", "Audience member already submitted a question in this round");
        }
        throw error;
      }
      return { questionId, qnaRoundId: round.id };
    });
  }

  async lockActiveQuestion(connection, presentationSessionId, questionId) {
    const [rows] = await connection.execute(
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
    await connection.execute(
      `UPDATE qna_questions
       SET status = 'new', selected_round_id = NULL
       WHERE qna_round_id = ? AND status = 'selected'`,
      [question.qna_round_id]
    );
    await connection.execute(
      `UPDATE qna_questions
       SET status = 'selected', selected_round_id = qna_round_id
       WHERE id = ?`,
      [question.id]
    );
  }

  async selectQuestion({ presentationSessionId, questionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const id = requiredText(questionId, "questionId", 36);
    return inTransaction(this.pool, async (connection) => {
      const question = await this.lockActiveQuestion(connection, sessionId, id);
      await this.markSelected(connection, question);
      return { questionId: id, qnaRoundId: question.qna_round_id };
    });
  }

  async projectQuestion({ presentationSessionId, questionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const id = requiredText(questionId, "questionId", 36);
    return inTransaction(this.pool, async (connection) => {
      const question = await this.lockActiveQuestion(connection, sessionId, id);
      await this.markSelected(connection, question);
      await connection.execute(
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
    return inTransaction(this.pool, async (connection) => {
      const question = await this.lockActiveQuestion(connection, sessionId, id);
      if (question.projected_at) {
        throw new QnaError("QNA_ALREADY_PROJECTED", "Projected questions cannot be deleted");
      }
      await connection.execute("DELETE FROM qna_questions WHERE id = ?", [id]);
      return { questionId: id, deleted: true };
    });
  }

  async newRound({ presentationSessionId }) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const qnaRoundId = this.createId();
    return inTransaction(this.pool, async (connection) => {
      const session = firstRow(await connection.execute(
        `SELECT id FROM presentation_sessions
         WHERE id = ? AND ended_at IS NULL
         FOR UPDATE`,
        [sessionId]
      ));
      if (!session) throw new QnaError("QNA_SESSION_NOT_FOUND", "Active presentation session not found");
      const currentRound = await this.activeRound(connection, sessionId, true);
      const nextRoundNumber = Number(currentRound.round_number) + 1;
      const questionsOpen = Boolean(currentRound.questions_open);
      await connection.execute(
        "UPDATE qna_rounds SET archived_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [currentRound.id]
      );
      await connection.execute(
        `INSERT INTO qna_rounds (id, presentation_session_id, round_number, questions_open)
         VALUES (?, ?, ?, ?)`,
        [qnaRoundId, sessionId, nextRoundNumber, questionsOpen ? 1 : 0]
      );
      return { qnaRoundId, roundNumber: nextRoundNumber, questionsOpen };
    });
  }

  async getActiveState(presentationSessionId) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const [rows] = await this.pool.execute(
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
    const [rows] = await this.pool.execute(
      `SELECT
         r.id AS qna_round_id,
         r.round_number,
         r.questions_open,
         q.id AS question_id
       FROM qna_rounds r
       LEFT JOIN qna_questions q
         ON q.qna_round_id = r.id AND q.audience_id = ?
       WHERE r.presentation_session_id = ? AND r.archived_at IS NULL
       LIMIT 1`,
      [normalizedAudienceId, sessionId]
    );
    const row = rows[0];
    if (!row) throw new QnaError("QNA_ROUND_NOT_FOUND", "Active Q&A round not found");
    return {
      roundId: row.qna_round_id,
      roundNumber: Number(row.round_number),
      questionsOpen: Boolean(row.questions_open),
      hasSubmitted: Boolean(row.question_id),
      questionId: row.question_id || null
    };
  }

  async listExportQuestions(presentationSessionId) {
    const sessionId = requiredText(presentationSessionId, "presentationSessionId", 36);
    const [rows] = await this.pool.execute(
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
}

module.exports = { QnaError, QnaRepository, inTransaction };
