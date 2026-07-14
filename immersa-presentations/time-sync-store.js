const SCHEMA_VERSION = 1;
const DEFAULT_DURATION_MS = 60000;
const MIN_DURATION_MS = 1000;
const MAX_DURATION_MS = 86400000;
const CONTROL_ROLES = new Set(["presenter", "stage"]);

function timerId() {
  return "timer_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function visibility(value = {}) {
  return { screen: Boolean(value.screen), audience: Boolean(value.audience) };
}

function controllerTimer(timer) {
  return {
    timer_id: timer.timer_id,
    status: timer.status,
    duration_ms: timer.duration_ms,
    ends_at_server_ms: timer.ends_at_server_ms,
    remaining_ms: timer.remaining_ms,
    started_at_server_ms: timer.started_at_server_ms,
    updated_at_server_ms: timer.updated_at_server_ms,
    updated_by_role: timer.updated_by_role,
    visibility: visibility(timer.visibility)
  };
}

function displayTimer(timer) {
  return {
    status: timer.status,
    duration_ms: timer.duration_ms,
    ends_at_server_ms: timer.ends_at_server_ms,
    remaining_ms: timer.remaining_ms
  };
}

function commandFingerprint(command) {
  const payload = command.payload && typeof command.payload === "object" ? command.payload : {};
  return JSON.stringify({ action: command.action, expectedRevision: command.expectedRevision, payload }, Object.keys({ action: 1, expectedRevision: 1, payload: 1 }).sort());
}

class TimeSyncStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.now = options.now || Date.now;
    this.makeTimerId = options.makeTimerId || timerId;
    this.defaultDurationMs = options.defaultDurationMs || DEFAULT_DURATION_MS;
    this.maxCommands = options.maxCommands || 256;
  }

  getSession(sessionId) {
    const key = String(sessionId || "");
    if (!this.sessions.has(key)) {
      const nowMs = this.now();
      this.sessions.set(key, {
        revision: 0,
        commands: new Map(),
        timer: {
          timer_id: this.makeTimerId(),
          status: "idle",
          duration_ms: this.defaultDurationMs,
          ends_at_server_ms: null,
          remaining_ms: this.defaultDurationMs,
          started_at_server_ms: null,
          updated_at_server_ms: nowMs,
          updated_by_role: null,
          visibility: { screen: true, audience: false }
        }
      });
    }
    return this.sessions.get(key);
  }

  normalizeExpired(sessionId, nowMs = this.now()) {
    const session = this.getSession(sessionId);
    const timer = session.timer;
    if (timer.status !== "running" || !Number.isFinite(timer.ends_at_server_ms) || timer.ends_at_server_ms > nowMs) return false;
    timer.status = "finished";
    timer.ends_at_server_ms = null;
    timer.remaining_ms = 0;
    timer.updated_at_server_ms = nowMs;
    timer.updated_by_role = "server";
    session.revision += 1;
    return true;
  }

  finishIfDue(sessionId, expected = {}, nowMs = this.now()) {
    const session = this.getSession(sessionId);
    const timer = session.timer;
    if (timer.status !== "running") return { ok: false, reason: "not_running" };
    if (expected.timerId && expected.timerId !== timer.timer_id) return { ok: false, reason: "stale_timer" };
    if (Number.isFinite(expected.endsAt) && expected.endsAt !== timer.ends_at_server_ms) return { ok: false, reason: "stale_deadline" };
    if (!Number.isFinite(timer.ends_at_server_ms) || timer.ends_at_server_ms > nowMs) return { ok: false, reason: "not_due" };
    return { ok: this.normalizeExpired(sessionId, nowMs), reason: "timeout" };
  }

  remember(session, commandId, fingerprint) {
    session.commands.set(commandId, fingerprint);
    while (session.commands.size > this.maxCommands) session.commands.delete(session.commands.keys().next().value);
  }

  command(input = {}) {
    const session = this.getSession(input.sessionId);
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : this.now();
    const expired = this.normalizeExpired(input.sessionId, nowMs);
    const role = String(input.role || "");
    const commandId = String(input.commandId || "").trim();
    const action = String(input.action || "").trim();
    const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
    const fingerprint = commandFingerprint({ action, expectedRevision: input.expectedRevision, payload });

    if (!CONTROL_ROLES.has(role)) return { ok: false, code: "UNAUTHORIZED_ROLE", message: "This role cannot control Time Sync.", expired };
    if (!commandId || commandId.length > 128) return { ok: false, code: "INVALID_COMMAND", message: "command_id is required.", expired };
    if (input.schemaVersion !== undefined && Number(input.schemaVersion) !== SCHEMA_VERSION) return { ok: false, code: "INVALID_SCHEMA_VERSION", message: "Unsupported Time Sync schema version.", expired };
    if (session.commands.has(commandId)) {
      if (session.commands.get(commandId) !== fingerprint) return { ok: false, code: "DUPLICATE_COMMAND", message: "command_id was already used.", expired };
      return { ok: true, duplicate: true, reason: "duplicate", expired, revision: session.revision };
    }
    if (!Number.isInteger(Number(input.expectedRevision)) || Number(input.expectedRevision) !== session.revision) {
      return { ok: false, code: "STALE_REVISION", message: "Timer state changed before this command was processed.", expired, revision: session.revision };
    }

    const timer = session.timer;
    const invalidState = () => ({ ok: false, code: "INVALID_STATE_TRANSITION", message: "Cannot " + action + " while timer is " + timer.status + "." });
    let result;

    if (action === "set_duration") {
      const duration = Math.round(Number(payload.duration_ms));
      if (timer.status !== "idle") result = invalidState();
      else if (!Number.isFinite(duration) || duration < MIN_DURATION_MS || duration > MAX_DURATION_MS) result = { ok: false, code: "INVALID_DURATION", message: "duration_ms must be between 1000 and 86400000." };
      else { timer.duration_ms = duration; timer.remaining_ms = duration; result = { ok: true }; }
    } else if (action === "start") {
      if (timer.status !== "idle") result = invalidState();
      else { timer.timer_id = this.makeTimerId(); timer.status = "running"; timer.started_at_server_ms = nowMs; timer.ends_at_server_ms = nowMs + timer.duration_ms; timer.remaining_ms = null; result = { ok: true }; }
    } else if (action === "pause") {
      if (timer.status !== "running") result = invalidState();
      else { timer.status = "paused"; timer.remaining_ms = Math.max(0, timer.ends_at_server_ms - nowMs); timer.ends_at_server_ms = null; result = { ok: true }; }
    } else if (action === "resume") {
      if (timer.status !== "paused" || !Number.isFinite(timer.remaining_ms) || timer.remaining_ms <= 0) result = invalidState();
      else { timer.status = "running"; timer.ends_at_server_ms = nowMs + timer.remaining_ms; timer.remaining_ms = null; result = { ok: true }; }
    } else if (action === "reset") {
      timer.timer_id = this.makeTimerId(); timer.status = "idle"; timer.ends_at_server_ms = null; timer.remaining_ms = timer.duration_ms; timer.started_at_server_ms = null; result = { ok: true };
    } else if (action === "restart") {
      if (timer.status !== "finished") result = invalidState();
      else { timer.timer_id = this.makeTimerId(); timer.status = "running"; timer.started_at_server_ms = nowMs; timer.ends_at_server_ms = nowMs + timer.duration_ms; timer.remaining_ms = null; result = { ok: true }; }
    } else if (action === "set_visibility") {
      const source = payload.visibility && typeof payload.visibility === "object" ? payload.visibility : payload;
      if (typeof source.screen !== "boolean" && typeof source.audience !== "boolean") result = { ok: false, code: "INVALID_VISIBILITY", message: "Provide screen and/or audience visibility." };
      else { if (typeof source.screen === "boolean") timer.visibility.screen = source.screen; if (typeof source.audience === "boolean") timer.visibility.audience = source.audience; result = { ok: true }; }
    } else result = { ok: false, code: "INVALID_COMMAND", message: "Unknown Time Sync action." };

    if (!result.ok) return { ...result, expired, revision: session.revision };
    timer.updated_at_server_ms = nowMs;
    timer.updated_by_role = role;
    session.revision += 1;
    this.remember(session, commandId, fingerprint);
    return { ok: true, duplicate: false, expired, reason: action, revision: session.revision };
  }

  snapshot(sessionId, role, options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : this.now();
    const session = this.getSession(sessionId);
    const timer = session.timer;
    const base = { schema_version: SCHEMA_VERSION, revision: session.revision, server_now_ms: nowMs, reason: options.reason || "state" };
    if (CONTROL_ROLES.has(role)) return { ...base, timer: controllerTimer(timer) };
    const visible = role === "audience" ? timer.visibility.audience : (role === "screen" || role === "viewer") ? timer.visibility.screen : false;
    return { ...base, visible, timer: visible ? displayTimer(timer) : null };
  }
}

function createTimeSyncSocketHandlers({ io, store = new TimeSyncStore(), getRoleRoomKey, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  const deadlines = new Map();
  const rooms = new Map();

  function clearDeadline(sessionId) {
    const key = String(sessionId || "");
    const active = deadlines.get(key);
    if (active) clearTimeoutFn(active.handle);
    deadlines.delete(key);
  }

  function emitStates(roomKey, sessionId, reason, nowMs = store.now()) {
    for (const role of ["presenter", "stage", "screen", "viewer", "audience"]) io.to(getRoleRoomKey(roomKey, role)).emit("time:state", store.snapshot(sessionId, role, { reason, nowMs }));
  }

  function schedule(roomKey, sessionId) {
    clearDeadline(sessionId);
    const timer = store.getSession(sessionId).timer;
    if (timer.status !== "running" || !Number.isFinite(timer.ends_at_server_ms)) return;
    rooms.set(String(sessionId), roomKey);
    const expected = { timerId: timer.timer_id, endsAt: timer.ends_at_server_ms };
    const handle = setTimeoutFn(() => {
      deadlines.delete(String(sessionId));
      const result = store.finishIfDue(sessionId, expected);
      if (result.ok) emitStates(rooms.get(String(sessionId)) || roomKey, sessionId, "timeout");
      else if (result.reason === "not_due") schedule(rooms.get(String(sessionId)) || roomKey, sessionId);
    }, Math.max(0, timer.ends_at_server_ms - store.now()));
    handle?.unref?.();
    deadlines.set(String(sessionId), { handle, expected });
  }

  function emitError(socket, context, payload) {
    const state = context?.sessionId ? store.snapshot(context.sessionId, context.role, { reason: "error" }) : null;
    socket.emit("time:error", { schema_version: SCHEMA_VERSION, command_id: payload.commandId || "", code: payload.code, message: payload.message, current_revision: state?.revision ?? null, state });
  }

  function attach(socket, getContext) {
    socket.on("time:sync:request", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !context?.role) return;
      rooms.set(String(context.sessionId), context.roomKey);
      const nowMs = store.now();
      if (store.normalizeExpired(context.sessionId, nowMs)) emitStates(context.roomKey, context.sessionId, "timeout", nowMs);
      schedule(context.roomKey, context.sessionId);
      socket.emit("time:sync:response", { ...store.snapshot(context.sessionId, context.role, { reason: "sync", nowMs }), client_sent_at_ms: Number(payload.client_sent_at_ms) });
    });

    socket.on("time:command", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !context?.role) return emitError(socket, context, { commandId: payload.command_id, code: "SESSION_NOT_FOUND", message: "Join a presentation before controlling Time Sync." });
      rooms.set(String(context.sessionId), context.roomKey);
      const result = store.command({ sessionId: context.sessionId, role: context.role, commandId: payload.command_id, expectedRevision: payload.expected_revision, action: payload.action, payload: payload.payload, schemaVersion: payload.schema_version });
      if (result.expired) emitStates(context.roomKey, context.sessionId, "timeout");
      if (!result.ok) return emitError(socket, context, { commandId: payload.command_id, code: result.code, message: result.message });
      if (result.duplicate) return socket.emit("time:state", store.snapshot(context.sessionId, context.role, { reason: "duplicate" }));
      schedule(context.roomKey, context.sessionId);
      emitStates(context.roomKey, context.sessionId, result.reason || "command");
    });
  }

  function sendCurrentState(socket, context) {
    if (!context?.roomKey || !context?.sessionId || !context?.role) return;
    rooms.set(String(context.sessionId), context.roomKey);
    const nowMs = store.now();
    if (store.normalizeExpired(context.sessionId, nowMs)) emitStates(context.roomKey, context.sessionId, "timeout", nowMs);
    schedule(context.roomKey, context.sessionId);
    socket.emit("time:state", store.snapshot(context.sessionId, context.role, { reason: "join", nowMs }));
  }

  return { attach, sendCurrentState, emitStates, schedule, clearDeadline, store };
}

module.exports = { TimeSyncStore, createTimeSyncSocketHandlers, SCHEMA_VERSION, DEFAULT_DURATION_MS, MIN_DURATION_MS, MAX_DURATION_MS, CONTROL_ROLES };
