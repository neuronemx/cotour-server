const { createMysqlPool } = require("../db/mysql");
const { createResendEmailSender } = require("./resend-email");

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
  const enabled = options.enabled ?? (isEnabled(env.IMMERSA_AUTH_ENABLED) || isEnabled(env.IMMERSA_AUTH_SPIKE_ENABLED));
  const loadRuntime = options.loadRuntime || (() => import("./better-auth-runtime.mjs"));
  const databaseFactory = options.databaseFactory || (() => createMysqlPool({ env }));
  const emailSenderFactory = options.emailSenderFactory || ((runtimeEnv) => createResendEmailSender({ env: runtimeEnv }));
  let runtimePromise = null;
  let database = null;

  function initialize() {
    if (!enabled) return Promise.resolve(null);
    if (!runtimePromise) {
      runtimePromise = Promise.resolve(loadRuntime()).then((runtimeModule) => {
        database = databaseFactory();
        return runtimeModule.createBetterAuthRuntime({ database, env, emailSender: emailSenderFactory(env) });
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

  async function capabilitiesHandler(_req, res) {
    if (!enabled) return res.json({ enabled: false, email: false, google: false });
    try {
      const runtime = await initialize();
      return res.json({ enabled: true, ...runtime.capabilities });
    } catch (error) {
      console.error("Immersa Auth capabilities failed", error);
      return sendUnavailable(res);
    }
  }

  async function accountContext(req) {
    const runtime = await initialize();
    return runtime?.getAccountContext(req.headers);
  }

  async function attachOptionalAccount(req, res, next) {
    if (!enabled) return next();
    try {
      const context = await accountContext(req);
      if (context) req.accountContext = context;
      return next();
    } catch (error) {
      console.error("Immersa optional Auth check failed", error);
      return sendUnavailable(res);
    }
  }

  function requireApiAuth() {
    return async (req, res, next) => {
      if (!enabled) return res.status(503).json({ error: "Immersa Auth is not enabled" });
      try {
        const context = await accountContext(req);
        if (!context) return res.status(401).json({ error: "Authentication required" });
        req.accountContext = context;
        return next();
      } catch (error) {
        console.error("Immersa Auth guard failed", error);
        return sendUnavailable(res);
      }
    };
  }

  function requirePageAuth() {
    return async (req, res, next) => {
      if (!enabled) return res.redirect(302, "/auth");
      try {
        const context = await accountContext(req);
        if (!context) {
          const returnTo = req.originalUrl === "/" ? "/home" : req.originalUrl;
          return res.redirect(302, "/auth?returnTo=" + encodeURIComponent(returnTo));
        }
        req.accountContext = context;
        return next();
      } catch (error) {
        console.error("Immersa Auth page guard failed", error);
        return res.status(503).send("Immersa Auth is temporarily unavailable");
      }
    };
  }

  function requireDeckOwnership(paramName = "deckId") {
    return async (req, res, next) => {
      const context = req.accountContext;
      if (!context?.user?.id) return res.status(401).json({ error: "Authentication required" });
      try {
        const runtime = await initialize();
        if (!(await runtime.workspaces.ownsDeck(context.user.id, req.params[paramName]))) {
          return res.status(404).json({ error: "Deck not found" });
        }
        return next();
      } catch (error) {
        console.error("Immersa deck ownership check failed", error);
        return sendUnavailable(res);
      }
    };
  }

  async function listDeckIds(req) {
    const runtime = await initialize();
    return runtime.workspaces.listDeckIds(req.accountContext.user.id);
  }

  async function registerDeck(req, deck) {
    const runtime = await initialize();
    return runtime.workspaces.registerDeck({
      userId: req.accountContext.user.id,
      workspaceId: req.accountContext.workspace.id,
      deckId: deck.deckId,
      sessionId: deck.session_id
    });
  }

  async function unregisterDeck(req, deckId) {
    const runtime = await initialize();
    return runtime.workspaces.unregisterDeck(req.accountContext.user.id, deckId);
  }

  async function requireOwnedSession(req, res, next) {
    const sessionId = String(req.body?.session_id || "").trim();
    if (!sessionId) return res.status(400).json({ error: "session_id is required" });
    try {
      const runtime = await initialize();
      const deckId = await runtime.workspaces.ownsSession(req.accountContext.user.id, sessionId);
      if (!deckId) return res.status(404).json({ error: "Deck not found" });
      req.ownedDeckId = deckId;
      return next();
    } catch (error) {
      console.error("Immersa session ownership check failed", error);
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

  return {
    enabled,
    handler,
    sessionHandler,
    capabilitiesHandler,
    socketMiddleware,
    requireApiAuth,
    requirePageAuth,
    attachOptionalAccount,
    requireDeckOwnership,
    requireOwnedSession,
    listDeckIds,
    registerDeck,
    unregisterDeck,
    initialize,
    close
  };
}

module.exports = { createBetterAuthCompatibilityBridge, isEnabled };
