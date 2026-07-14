const test = require("node:test");
const assert = require("node:assert/strict");
const { TimeSyncStore, createTimeSyncSocketHandlers } = require("../time-sync-store");

function command(store, overrides = {}) {
  return store.command({
    sessionId: "session-a",
    role: "presenter",
    commandId: "cmd-" + Math.random(),
    expectedRevision: store.getSession("session-a").revision,
    action: "start",
    payload: {},
    ...overrides
  });
}

function fakeIo() {
  const emissions = [];
  return {
    emissions,
    to(room) {
      return { emit(event, payload) { emissions.push({ room, event, payload }); } };
    }
  };
}

function fakeSocket() {
  const handlers = new Map();
  const emissions = [];
  return {
    handlers,
    emissions,
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emissions.push({ event, payload }); }
  };
}

test("timer starts from idle using a server deadline", () => {
  let now = 1000;
  const store = new TimeSyncStore({ now: () => now, makeTimerId: () => "timer-test", defaultDurationMs: 60000 });
  const result = command(store, { commandId: "start-1" });
  assert.equal(result.ok, true);
  const state = store.snapshot("session-a", "presenter", { nowMs: now });
  assert.equal(state.revision, 1);
  assert.equal(state.timer.status, "running");
  assert.equal(state.timer.ends_at_server_ms, 61000);
  assert.equal(state.timer.remaining_ms, null);
});

test("pause and resume preserve remaining duration", () => {
  let now = 1000;
  const store = new TimeSyncStore({ now: () => now, defaultDurationMs: 10000 });
  command(store, { commandId: "start-1" });
  now = 4000;
  command(store, { commandId: "pause-1", expectedRevision: 1, action: "pause" });
  assert.equal(store.snapshot("session-a", "presenter").timer.remaining_ms, 7000);
  now = 9000;
  command(store, { commandId: "resume-1", expectedRevision: 2, action: "resume" });
  assert.equal(store.snapshot("session-a", "presenter").timer.ends_at_server_ms, 16000);
});

test("server normalizes an expired running timer", () => {
  let now = 1000;
  const store = new TimeSyncStore({ now: () => now, defaultDurationMs: 2000 });
  command(store, { commandId: "start-1" });
  now = 3000;
  assert.equal(store.normalizeExpired("session-a"), true);
  const state = store.snapshot("session-a", "presenter");
  assert.equal(state.revision, 2);
  assert.equal(state.timer.status, "finished");
  assert.equal(state.timer.remaining_ms, 0);
  assert.equal(state.timer.updated_by_role, "server");
});

test("stale callbacks cannot finish a restarted timer", () => {
  let now = 1000;
  let id = 0;
  const store = new TimeSyncStore({ now: () => now, makeTimerId: () => "timer-" + (++id), defaultDurationMs: 2000 });
  command(store, { commandId: "start-1" });
  const old = store.snapshot("session-a", "presenter").timer;
  command(store, { commandId: "reset-1", expectedRevision: 1, action: "reset" });
  command(store, { commandId: "start-2", expectedRevision: 2, action: "start" });
  now = 4000;
  const result = store.finishIfDue("session-a", { timerId: old.timer_id, endsAt: old.ends_at_server_ms });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "stale_timer");
});

test("revision rejects concurrent controller commands", () => {
  const store = new TimeSyncStore();
  const first = command(store, { commandId: "speaker-start", expectedRevision: 0 });
  const second = command(store, { role: "stage", commandId: "stage-start", expectedRevision: 0 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, "STALE_REVISION");
  assert.equal(second.revision, 1);
});

test("command ids are idempotent", () => {
  const store = new TimeSyncStore();
  const first = command(store, { commandId: "same-command", expectedRevision: 0 });
  const duplicate = command(store, { commandId: "same-command", expectedRevision: 0 });
  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.getSession("session-a").revision, 1);
});

test("reused command id with a different payload is rejected", () => {
  const store = new TimeSyncStore();
  const first = command(store, {
    commandId: "same-payload-command",
    expectedRevision: 0,
    action: "set_duration",
    payload: { duration_ms: 30000 }
  });
  const reused = command(store, {
    commandId: "same-payload-command",
    expectedRevision: 0,
    action: "set_duration",
    payload: { duration_ms: 45000 }
  });
  assert.equal(first.ok, true);
  assert.equal(reused.ok, false);
  assert.equal(reused.code, "DUPLICATE_COMMAND");
  assert.equal(store.snapshot("session-a", "presenter").timer.duration_ms, 30000);
});

test("only presenter and stage can control the timer", () => {
  const store = new TimeSyncStore();
  const result = command(store, { role: "audience", commandId: "audience-start" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNAUTHORIZED_ROLE");
});

test("display snapshots hide controller metadata and honor role visibility", () => {
  const store = new TimeSyncStore();
  const screen = store.snapshot("session-a", "screen");
  const audience = store.snapshot("session-a", "audience");
  assert.equal(screen.visible, true);
  assert.equal(screen.timer.status, "idle");
  assert.equal(screen.timer.timer_id, undefined);
  assert.equal(screen.timer.visibility, undefined);
  assert.equal(audience.visible, false);
  assert.equal(audience.timer, null);
});

test("visibility changes use the same revision contract", () => {
  const store = new TimeSyncStore();
  const result = command(store, { commandId: "visibility-1", action: "set_visibility", payload: { audience: true, screen: false } });
  assert.equal(result.ok, true);
  assert.equal(store.snapshot("session-a", "audience").visible, true);
  assert.equal(store.snapshot("session-a", "screen").visible, false);
});

test("socket handlers return server time and role-specific states", () => {
  let now = 5000;
  const store = new TimeSyncStore({ now: () => now });
  const io = fakeIo();
  const socket = fakeSocket();
  const handlers = createTimeSyncSocketHandlers({
    io,
    store,
    getRoleRoomKey: (room, role) => room + "::" + role,
    setTimeoutFn: () => ({ unref() {} }),
    clearTimeoutFn: () => {}
  });
  const context = { roomKey: "session-a::deck-a", sessionId: "session-a", role: "presenter" };
  handlers.attach(socket, () => context);
  socket.handlers.get("time:sync:request")({ client_sent_at_ms: 4800 });
  const response = socket.emissions.find((item) => item.event === "time:sync:response").payload;
  assert.equal(response.server_now_ms, 5000);
  assert.equal(response.client_sent_at_ms, 4800);
  assert.equal(response.timer.status, "idle");
});
