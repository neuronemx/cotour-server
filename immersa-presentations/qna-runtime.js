const { createMysqlPool } = require("./db/mysql");
const { QnaRepository } = require("./db/qna-repository");
const { QnaExecutionCoordinator } = require("./qna-execution-coordinator");
const { createQnaSocketHandlers } = require("./qna-sockets");
const { buildQnaCsv } = require("./qna-csv");

function qnaEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.IMMERSA_QNA_ENABLED || "").trim());
}

function disabledRuntime() {
  return {
    enabled: false,
    startScreenExecution: null,
    listHistory: null,
    exportDeckCsv: null,
    clearHistory: null,
    resetSessionState: null,
    repository: null,
    attach() {},
    async sendCurrentState() {},
    async close() {}
  };
}

function createQnaRuntime(options = {}) {
  const env = options.env || process.env;
  if (!qnaEnabled(env)) return disabledRuntime();

  const pool = options.pool || (options.createPool || createMysqlPool)({ env });
  const repository = options.repository || new QnaRepository(pool);
  const executionCoordinator = options.executionCoordinator || new QnaExecutionCoordinator(repository);
  const logger = options.logger || console;

  async function resolvePresentationSessionId(context) {
    const active = await repository.getActivePresentationSession({
      deckId: context.deckId,
      sourceSessionId: context.sessionId
    });
    return active?.presentationSessionId || null;
  }

  const sockets = createQnaSocketHandlers({
    io: options.io,
    repository,
    getRoleRoomKey: options.getRoleRoomKey,
    getRoomKey: options.getRoomKey,
    getConnectedAudience: options.getConnectedAudience,
    resolvePresentationSessionId
  });

  return {
    enabled: true,
    startScreenExecution: (payload) => executionCoordinator.openScreen(payload),
    async listHistory({ deckId }) {
      return repository.listPresentationSessions(deckId);
    },
    async exportDeckCsv({ deckId }) {
      const rows = await repository.listExportQuestionsByDeck(deckId);
      return {
        csv: buildQnaCsv(rows),
        deckId,
        questionCount: rows.length
      };
    },
    async clearHistory({ deckId }) {
      const result = await repository.clearDeckHistory(deckId);
      await sockets.resetAfterHistoryDelete(result);
      return result;
    },
    async resetSessionState({ deckId, sourceSessionId, presentationSessionId }) {
      await sockets.resetAfterHistoryDelete({
        deckId,
        sourceSessionId,
        presentationSessionId
      });
    },
    attach(socket, getContext) {
      sockets.attach(socket, getContext);
    },
    async sendCurrentState(socket, context) {
      try {
        await sockets.sendCurrentState(socket, context);
      } catch (error) {
        logger.error("Unable to send current Q&A state", error);
        socket.emit("qna:rejected", { event: "qna:state", reason: "QNA_UNAVAILABLE" });
      }
    },
    async close() {
      if (pool?.end) await pool.end();
    },
    repository,
    pool
  };
}

module.exports = { createQnaRuntime, qnaEnabled };
