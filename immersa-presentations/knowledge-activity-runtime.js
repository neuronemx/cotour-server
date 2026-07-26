const { KnowledgeActivityService } = require("./knowledge-activity-service");
const { createKnowledgeActivitySocketHandlers } = require("./knowledge-activity-sockets");

function knowledgeActivitiesEnabled(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.IMMERSA_KNOWLEDGE_ACTIVITIES_ENABLED || "").trim());
}

function disabledRuntime() {
  return {
    enabled: false,
    hasActive() { return false; },
    attach() {},
    async start() { return 0; },
    async sendCurrentState(socket) {
      socket.emit("interaction:execution:state", { available: false, execution: null });
    },
    async listHistory() { return []; },
    async close() {}
  };
}

function createKnowledgeActivityRuntime(options = {}) {
  const env = options.env || process.env;
  if (!knowledgeActivitiesEnabled(env)) return disabledRuntime();
  // Do not load the database adapter until the feature flag is explicitly on.
  // This keeps the disabled path inert in every environment.
  const { createMysqlPool } = require("./db/mysql");
  const {
    KnowledgeActivityRepository,
  } = require("./db/knowledge-activity-repository");
  const pool = options.pool || (options.createPool || createMysqlPool)({ env });
  const repository = options.repository || new KnowledgeActivityRepository(pool);
  const service = options.service || new KnowledgeActivityService({
    repository,
    coordinator: options.coordinator,
    loadDefinitionsForDeck: options.loadDefinitionsForDeck,
    now: options.now,
    setTimeoutFn: options.setTimeoutFn,
    clearTimeoutFn: options.clearTimeoutFn,
    random: options.random
  });
  const sockets = createKnowledgeActivitySocketHandlers({
    io: options.io,
    service,
    getRoleRoomKey: options.getRoleRoomKey,
    getRoomKey: options.getRoomKey,
    getConnectedAudience: options.getConnectedAudience
  });
  const logger = options.logger || console;
  return {
    enabled: true,
    hasActive: (sessionId) => service.hasActive(sessionId),
    attach: sockets.attach,
    async start() {
      try {
        return await service.start();
      } catch (error) {
        logger.error("Unable to restore knowledge activities", error);
        throw error;
      }
    },
    sendCurrentState: sockets.sendCurrentState,
    listHistory: ({ deckId }) => repository.listHistory(deckId),
    async close() {
      sockets.close();
      await service.close();
      if (pool?.end) await pool.end();
    },
    service,
    repository
  };
}

module.exports = { knowledgeActivitiesEnabled, createKnowledgeActivityRuntime };
