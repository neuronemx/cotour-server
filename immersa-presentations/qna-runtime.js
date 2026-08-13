const { createMysqlPool } = require("./db/mysql");
const { QnaRepository } = require("./db/qna-repository");
const { QnaExecutionCoordinator } = require("./qna-execution-coordinator");
const { createQnaSocketHandlers } = require("./qna-sockets");
const { buildQnaCsv } = require("./qna-csv");

function qnaEnabled(env = process.env) {
  const value = String(env.IMMERSA_QNA_ENABLED ?? "").trim();
  return !/^(0|false|no|off|disabled)$/i.test(value);
}

function disabledRuntime() {
  return {
    enabled: false,
    startScreenExecution: null,
    listHistory: null,
    exportDeckCsv: null,
    clearHistory: null,
    resetSessionState: null,
    shutdownSession: null,
    shutdownSessionIfStale: null,
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
    if (active?.presentationSessionId) return active.presentationSessionId;
    if (!["presenter", "stage"].includes(context.role)) return null;
    const prepared = await executionCoordinator.ensureExecution({
      deckId: context.deckId,
      sourceSessionId: context.sessionId
    });
    return prepared?.presentationSessionId || null;
  }

  const sockets = createQnaSocketHandlers({
    io: options.io,
    repository,
    getRoleRoomKey: options.getRoleRoomKey,
    getRoomKey: options.getRoomKey,
    getConnectedAudience: options.getConnectedAudience,
    resolvePresentationSessionId
  });

  async function replaceSession({ deckId, sourceSessionId }) {
    const replacement = await repository.startPresentationSession({
      deckId,
      sourceSessionId,
      replaceActive: true
    });
    await sockets.resetAfterHistoryDelete({
      deckId,
      sourceSessionId,
      presentationSessionId: replacement.presentationSessionId
    });
    return replacement;
  }

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
    async shutdownSession({ deckId, sourceSessionId }) {
      return replaceSession({ deckId, sourceSessionId });
    },
    async shutdownSessionIfStale({ deckId, sourceSessionId, inactivityMs, now = Date.now() }) {
      const active = await repository.getActivePresentationSession({ deckId, sourceSessionId });
      const startedAt = active?.startedAt ? new Date(active.startedAt).getTime() : 0;
      if (!startedAt || now - startedAt < inactivityMs) return { expired: false, presentationSessionId: active?.presentationSessionId || null };
      const replacement = await replaceSession({ deckId, sourceSessionId });
      return { ...replacement, expired: true };
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
