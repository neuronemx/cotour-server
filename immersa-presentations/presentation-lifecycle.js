const { randomUUID } = require("node:crypto");

const CONTROL_ROLES = new Set(["presenter", "stage"]);

class PresentationLifecycleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PresentationLifecycleError";
    this.code = code;
  }
}

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new PresentationLifecycleError("INVALID_INPUT", `${field} is required`);
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

function rowState(row) {
  if (!row) return { available: true, mode: "test", presentationSessionId: null, startedAt: null };
  return {
    available: true,
    mode: row.recording_started_at ? "live" : "test",
    presentationSessionId: row.id,
    startedAt: row.recording_started_at || null
  };
}

class PresentationLifecycleRepository {
  constructor(pool, options = {}) {
    if (!pool?.getConnection || !pool?.execute) throw new Error("A MySQL pool is required");
    this.pool = pool;
    this.createId = options.createId || randomUUID;
  }

  async activeRow(connection, { deckId, sourceSessionId }, lock = false) {
    const executor = connection || this.pool;
    const [rows] = await executor.execute(
      `SELECT id, deck_id, source_session_id, recording_started_at
       FROM presentation_sessions
       WHERE deck_id = ? AND source_session_id = ? AND ended_at IS NULL
       ORDER BY started_at DESC, id DESC
       LIMIT 1${lock ? " FOR UPDATE" : ""}`,
      [required(deckId, "deckId"), required(sourceSessionId, "sourceSessionId")]
    );
    return rows[0] || null;
  }

  async state(payload) {
    return rowState(await this.activeRow(null, payload));
  }

  async insertDraft(connection, { deckId, sourceSessionId }) {
    const presentationSessionId = this.createId();
    const roundId = this.createId();
    await connection.execute(
      `INSERT INTO presentation_sessions (id, deck_id, source_session_id)
       VALUES (?, ?, ?)`,
      [presentationSessionId, deckId, sourceSessionId]
    );
    await connection.execute(
      `INSERT INTO qna_rounds (id, presentation_session_id, round_number, questions_open)
       VALUES (?, ?, 1, 0)`,
      [roundId, presentationSessionId]
    );
    return presentationSessionId;
  }

  async start(payload, options = {}) {
    const deckId = required(payload?.deckId, "deckId");
    const sourceSessionId = required(payload?.sourceSessionId, "sourceSessionId");
    const preserveTestData = Boolean(options.preserveTestData);
    return inTransaction(this.pool, async (connection) => {
      let active = await this.activeRow(connection, { deckId, sourceSessionId }, true);
      if (active?.recording_started_at) return rowState(active);
      const presentationSessionId = active?.id
        || await this.insertDraft(connection, { deckId, sourceSessionId });

      if (!preserveTestData) {
        await connection.execute(
          "DELETE FROM knowledge_activity_executions WHERE presentation_session_id = ?",
          [presentationSessionId]
        );
        await connection.execute(
          "DELETE FROM qna_rounds WHERE presentation_session_id = ?",
          [presentationSessionId]
        );
        await connection.execute(
          `INSERT INTO qna_rounds (id, presentation_session_id, round_number, questions_open)
           VALUES (?, ?, 1, 0)`,
          [this.createId(), presentationSessionId]
        );
      }
      await connection.execute(
        `UPDATE presentation_sessions
         SET started_at = CURRENT_TIMESTAMP(3),
             recording_started_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [presentationSessionId]
      );
      active = await this.activeRow(connection, { deckId, sourceSessionId });
      return rowState(active);
    });
  }

  async finish(payload) {
    const deckId = required(payload?.deckId, "deckId");
    const sourceSessionId = required(payload?.sourceSessionId, "sourceSessionId");
    return inTransaction(this.pool, async (connection) => {
      const active = await this.activeRow(connection, { deckId, sourceSessionId }, true);
      if (!active?.recording_started_at) {
        throw new PresentationLifecycleError("NOT_LIVE", "Presentation is not live");
      }
      await connection.execute(
        `UPDATE presentation_sessions
         SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP(3))
         WHERE id = ?`,
        [active.id]
      );
      const presentationSessionId = await this.insertDraft(connection, { deckId, sourceSessionId });
      return {
        available: true,
        mode: "test",
        presentationSessionId,
        startedAt: null,
        completedPresentationSessionId: String(active.id)
      };
    });
  }
}

function createPresentationLifecycleRuntime({
  io,
  repository,
  getRoleRoomKey,
  beforeStart = async () => {},
  afterStart = async () => {},
  preserveAutomaticStart = async () => false,
  beforeFinish = async () => ({ ok: true }),
  afterFinish = async () => {},
  logger = console
}) {
  if (!io?.to || !repository?.state || !getRoleRoomKey) {
    throw new Error("Presentation lifecycle dependencies are required");
  }
  const locks = new Map();

  function key(context) {
    return `${String(context?.sessionId || "")}::${String(context?.deckId || "")}`;
  }

  async function withLock(context, operation) {
    const lockKey = key(context);
    const previous = locks.get(lockKey) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    locks.set(lockKey, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(lockKey) === current) locks.delete(lockKey);
    }
  }

  function payload(context) {
    return { deckId: context.deckId, sourceSessionId: context.sessionId };
  }

  function emitState(context, state) {
    io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("presentation:lifecycle:state", state);
    io.to(getRoleRoomKey(context.roomKey, "stage")).emit("presentation:lifecycle:state", state);
    return state;
  }

  function emitClosed(context, completion) {
    if (!completion) return null;
    for (const role of ["presenter", "stage", "screen", "audience"]) {
      io.to(getRoleRoomKey(context.roomKey, role)).emit("presentation:closed", completion);
    }
    return completion;
  }

  function reject(socket, event, error) {
    socket.emit("presentation:lifecycle:rejected", {
      event,
      reason: error?.code || error?.reason || "PRESENTATION_LIFECYCLE_UNAVAILABLE",
      message: error?.message || "Presentation lifecycle unavailable"
    });
  }

  function validControl(context) {
    return Boolean(context?.roomKey && context?.sessionId && context?.deckId && CONTROL_ROLES.has(context.role));
  }

  function validAutomaticStart(context) {
    return Boolean(context?.roomKey && context?.sessionId && context?.deckId && context.role === "audience");
  }

  async function start(context, { automatic = false } = {}) {
    const state = await withLock(context, async () => {
      const current = await repository.state(payload(context));
      if (current.mode === "live") return current;
      const preserveTestData = automatic && Boolean(await preserveAutomaticStart(context));
      if (!preserveTestData) await beforeStart(context);
      const started = await repository.start(payload(context), { preserveTestData });
      if (!preserveTestData) await afterStart(context, started);
      return started;
    });
    emitState(context, state);
    return state;
  }

  async function finish(context, { skipGuard = false } = {}) {
    const result = await withLock(context, async () => {
      if (!skipGuard) {
        const allowed = await beforeFinish(context);
        if (allowed?.ok === false) {
          throw new PresentationLifecycleError(
            allowed.reason || "ACTIVE_INTERACTION",
            allowed.message || "Close the active interaction before finishing"
          );
        }
      }
      const state = await repository.finish(payload(context));
      const completion = await afterFinish(context, state);
      return { state, completion: completion || null };
    });
    emitClosed(context, result.completion);
    emitState(context, result.state);
    return result;
  }

  function attach(socket, getContext) {
    socket.on("presentation:lifecycle:request", async () => {
      const context = getContext();
      if (!validControl(context)) return;
      try {
        socket.emit("presentation:lifecycle:state", await repository.state(payload(context)));
      } catch (error) {
        logger.error("Unable to read presentation lifecycle", error);
        reject(socket, "request", error);
      }
    });

    socket.on("presentation:lifecycle:start", async () => {
      const context = getContext();
      if (!validControl(context)) return;
      try {
        await start(context);
      } catch (error) {
        logger.error("Unable to start presentation lifecycle", error);
        reject(socket, "start", error);
      }
    });

    socket.on("presentation:lifecycle:finish", async () => {
      const context = getContext();
      if (!validControl(context)) return;
      try {
        await finish(context);
      } catch (error) {
        logger.error("Unable to finish presentation lifecycle", error);
        reject(socket, "finish", error);
      }
    });
  }

  async function sendCurrentState(socket, context) {
    if (!validControl(context)) return;
    socket.emit("presentation:lifecycle:state", await repository.state(payload(context)));
  }

  async function startAutomatically(context) {
    if (!validAutomaticStart(context)) return null;
    try {
      return await start(context, { automatic: true });
    } catch (error) {
      logger.error("Unable to start presentation lifecycle automatically", error);
      return null;
    }
  }

  async function finishInactive(context) {
    if (!context?.roomKey || !context?.sessionId || !context?.deckId) return null;
    try {
      const current = await repository.state(payload(context));
      if (current.mode !== "live") return null;
      return await finish(context, { skipGuard: true });
    } catch (error) {
      logger.error("Unable to finish inactive presentation lifecycle", error);
      return null;
    }
  }

  // Event Stage also invokes the lifecycle through its authenticated HTTP control,
  // so expose the same guarded operations used by the socket controls.
  return { attach, start, finish, sendCurrentState, startAutomatically, finishInactive, emitState, emitClosed };
}

module.exports = {
  CONTROL_ROLES,
  PresentationLifecycleError,
  PresentationLifecycleRepository,
  createPresentationLifecycleRuntime,
  rowState
};
