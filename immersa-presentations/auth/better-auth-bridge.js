const { createMysqlPool } = require("../db/mysql");

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function sendUnavailable(res) {
  if (res.headersSent) return;
  res.status(503).json({
    error: "Better Auth compatibility spike is unavailable"
  });
}

function createBetterAuthCompatibilityBridge(options = {}) {
  const env = options.env || process.env;
  const enabled = options.enabled ?? isEnabled(env.IMMERSA_AUTH_SPIKE_ENABLED);
  const loadRuntime = options.loadRuntime || (() => import("./better-auth-runtime.mjs"));
  const databaseFactory = options.databaseFactory || (() => createMysqlPool({ env }));
  let runtimePromise = null;
  let database = null;

  function initialize() {
    if (!enabled) return Promise.resolve(null);
    if (!runtimePromise) {
      runtimePromise = Promise.resolve(loadRuntime()).then((runtimeModule) => {
        database = databaseFactory();
        return runtimeModule.createBetterAuthRuntime({ database, env });
      }).catch(async (error) => {
        if (database?.end) await database.end().catch(() => {});
        database = null;
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise;
  }

  async function handler(req, res, next) {
    if (!enabled) return next();
    try {
      const runtime = await initialize();
      return await runtime.handler(req, res);
    } catch (error) {
      console.error("Better Auth compatibility handler failed", error);
      return sendUnavailable(res);
    }
  }

  async function sessionHandler(req, res) {
    if (!enabled) return res.status(404).json({ error: "Compatibility spike is disabled" });
    try {
      const runtime = await initialize();
      const session = await runtime.getSession(req.headers);
      return res.json({ authenticated: Boolean(session), session: session || null });
    } catch (error) {
      console.error("Better Auth compatibility session check failed", error);
      return sendUnavailable(res);
    }
  }

  async function socketMiddleware(socket, next) {
    if (!enabled) return next();
    try {
      const runtime = await initialize();
      socket.data.accountSession = await runtime.getSession(socket.handshake?.headers || {});
      return next();
    } catch (error) {
      socket.data.accountSession = null;
      console.warn("Better Auth compatibility socket session was unavailable", error.message);
      return next();
    }
  }

  async function close() {
    if (database?.end) await database.end();
    database = null;
    runtimePromise = null;
  }

  return { enabled, handler, sessionHandler, socketMiddleware, initialize, close };
}

module.exports = { createBetterAuthCompatibilityBridge, isEnabled };
