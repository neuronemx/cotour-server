const test = require("node:test");
const assert = require("node:assert/strict");
const { BreakoutStore } = require("../breakout-store");
const { createBreakoutSocketHandlers } = require("../breakout-sockets");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");

function createSocket() {
  const handlers = new Map();
  const emitted = [];
  return {
    handlers,
    emitted,
    on(event, fn) { handlers.set(event, fn); },
    emit(event, payload) { emitted.push({ event, payload }); }
  };
}

function createIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(event, payload) { emitted.push({ room, event, payload }); }
      };
    }
  };
}

function createIntervals() {
  const active = new Set();
  return {
    active,
    setIntervalFn(fn) {
      const handle = { fn, unref() {} };
      active.add(handle);
      return handle;
    },
    clearIntervalFn(handle) { active.delete(handle); }
  };
}

test("controller starts synchronized countdown before authoritative Breakout loop", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new BreakoutStore();
  const handlers = createBreakoutSocketHandlers({ io, store, ...intervals });
  const socket = createSocket();
  const context = { roomKey: "room", sessionId: "s1", role: "presenter" };
  handlers.attach(socket, () => context);

  await socket.handlers.get("breakout:start")();
  assert.equal(store.snapshot("s1").status, "countdown");
  assert.equal(intervals.active.size, 1);
  assert.equal(io.emitted.at(-1).event, "breakout:state");

  store.step("s1", 50, Date.now() + 5000);
  socket.handlers.get("breakout:pause")();
  assert.equal(store.snapshot("s1").status, "paused");
  assert.equal(intervals.active.size, 0);
});

test("audience input is forwarded only for its registered identity", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new BreakoutStore();
  store.start("s1", "presenter");
  const handlers = createBreakoutSocketHandlers({ io, store, ...intervals });
  const socket = createSocket();
  handlers.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "audience", audienceId: "a1" }));

  socket.handlers.get("breakout:input")({ direction: "right" });
  assert.equal(store.getSession("s1").input.right, 1);
});

test("start is rejected while another primary interaction is active", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new BreakoutStore();
  const coordinator = {
    hasAnyActive: () => true,
    withSessionLock: async (_sessionId, action) => action()
  };
  const handlers = createBreakoutSocketHandlers({ io, store, coordinator, ...intervals });
  const socket = createSocket();
  handlers.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "stage" }));

  await socket.handlers.get("breakout:start")();
  assert.equal(store.snapshot("s1").status, "idle");
  assert.deepEqual(socket.emitted.at(-1), {
    event: "breakout:rejected",
    payload: { action: "start", reason: "active_interaction_exists" }
  });
});

test("late join receives current state and restores running loop", () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new BreakoutStore();
  store.start("s1", "presenter");
  const handlers = createBreakoutSocketHandlers({ io, store, ...intervals });
  const socket = createSocket();

  handlers.sendCurrentState(socket, { roomKey: "room", sessionId: "s1", role: "screen" });
  assert.equal(socket.emitted.at(-1).event, "breakout:state");
  assert.equal(socket.emitted.at(-1).payload.status, "running");
  assert.equal(intervals.active.size, 1);
});

test("preparing Breakout closes another registered game inside the session lock", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new BreakoutStore();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  let pongActive = true;
  const closed = [];
  coordinator.registerGame("pong", {
    hasActive: () => pongActive,
    close(context) {
      pongActive = false;
      closed.push(context.sessionId);
      return { ok: true };
    }
  });
  const handlers = createBreakoutSocketHandlers({ io, store, coordinator, ...intervals });
  coordinator.registerGame("breakout", handlers);
  const socket = createSocket();
  handlers.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "presenter" }));

  await socket.handlers.get("breakout:prepare")();

  assert.deepEqual(closed, ["s1"]);
  assert.equal(pongActive, false);
  assert.equal(store.snapshot("s1").status, "ready");
  assert.equal(intervals.active.size, 1);
});
