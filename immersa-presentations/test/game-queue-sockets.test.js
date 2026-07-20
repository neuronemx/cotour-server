const test = require("node:test");
const assert = require("node:assert/strict");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");
const { BreakoutStore } = require("../breakout-store");
const { createBreakoutSocketHandlers } = require("../breakout-sockets");
const { GameQueueStore } = require("../game-queue-store");
const { createGameQueueSocketHandlers } = require("../game-queue-sockets");

function createSocket() {
  const handlers = new Map();
  const emitted = [];
  return {
    handlers,
    emitted,
    on(event, handler) { handlers.set(event, handler); },
    emit(event, payload) { emitted.push({ event, payload }); }
  };
}

function createIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return { emit(event, payload) { emitted.push({ room, event, payload }); } };
    }
  };
}

function createRuntime(gameType) {
  let active = false;
  const calls = [];
  return {
    calls,
    hasActive: () => active,
    async prepare(context, options) {
      active = true;
      calls.push({ action: "prepare", gameType, context, options });
      return { ok: true };
    },
    close(context) {
      active = false;
      calls.push({ action: "close", gameType, context });
      return { ok: true };
    }
  };
}

test("Speaker selection is synchronized and starts the first game in fixed order", async () => {
  const io = createIo();
  const store = new GameQueueStore();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const breakout = createRuntime("breakout");
  const pong = createRuntime("pong");
  coordinator.registerGame("breakout", breakout);
  coordinator.registerGame("pong", pong);
  const queue = createGameQueueSocketHandlers({ io, store, coordinator });
  const socket = createSocket();
  const context = { roomKey: "room", sessionId: "session-1", role: "presenter" };
  queue.attach(socket, () => context);

  await socket.handlers.get("games:queue:set")({ selected: ["pong", "breakout"] });
  assert.deepEqual(io.emitted.at(-1).payload.selected, ["breakout", "pong"]);

  await socket.handlers.get("games:queue:start")();
  assert.equal(store.snapshot("session-1", ["breakout", "pong"]).current_game_type, "breakout");
  assert.equal(breakout.calls[0].action, "prepare");
  assert.deepEqual(breakout.calls[0].options, { skipLock: true });
});

test("finished games advance automatically after five seconds and stop at the final result", async () => {
  const io = createIo();
  const store = new GameQueueStore();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const breakout = createRuntime("breakout");
  const pong = createRuntime("pong");
  coordinator.registerGame("breakout", breakout);
  coordinator.registerGame("pong", pong);
  const timers = [];
  const queue = createGameQueueSocketHandlers({
    io,
    store,
    coordinator,
    now: () => 1000,
    setTimeoutFn(fn, delay) {
      const handle = { fn, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    clearTimeoutFn() {}
  });
  store.configure("session-1", "stage", ["breakout", "pong"], ["breakout", "pong"]);
  await queue.snapshot("session-1");
  const socket = createSocket();
  const context = { roomKey: "room", sessionId: "session-1", role: "stage" };
  queue.attach(socket, () => context);
  await socket.handlers.get("games:queue:start")();

  assert.equal(queue.handleGameFinished({ sessionId: "session-1", roomKey: "room", gameType: "breakout" }), true);
  assert.equal(timers[0].delay, 5000);
  assert.equal(store.snapshot("session-1", ["breakout", "pong"]).transition_at_ms, 6000);
  await timers[0].fn();
  assert.equal(store.snapshot("session-1", ["breakout", "pong"]).current_game_type, "pong");
  assert.deepEqual(breakout.calls.map((call) => call.action), ["prepare", "close"]);
  assert.deepEqual(pong.calls.map((call) => call.action), ["prepare"]);

  assert.equal(queue.handleGameFinished({ sessionId: "session-1", roomKey: "room", gameType: "pong" }), true);
  const finished = store.snapshot("session-1", ["breakout", "pong"]);
  assert.equal(finished.status, "finished");
  assert.equal(finished.current_game_type, "pong");
});

test("Pong stays unavailable until its runtime is registered", async () => {
  const io = createIo();
  const store = new GameQueueStore();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  coordinator.registerGame("breakout", createRuntime("breakout"));
  const queue = createGameQueueSocketHandlers({ io, store, coordinator });
  const socket = createSocket();
  queue.attach(socket, () => ({ roomKey: "room", sessionId: "session-1", role: "presenter" }));

  await socket.handlers.get("games:queue:set")({ selected: ["pong"] });
  assert.deepEqual(socket.emitted.at(-1), {
    event: "games:queue:rejected",
    payload: { action: "set", reason: "game_unavailable" }
  });
});

test("real Breakout runtime prepares inside the queue session lock without deadlocking", async () => {
  const io = createIo();
  const store = new GameQueueStore();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const breakoutStore = new BreakoutStore();
  const breakout = createBreakoutSocketHandlers({
    io,
    store: breakoutStore,
    coordinator,
    setIntervalFn() { return { unref() {} }; },
    clearIntervalFn() {}
  });
  coordinator.registerGame("breakout", breakout);
  const queue = createGameQueueSocketHandlers({ io, store, coordinator });
  const socket = createSocket();
  queue.attach(socket, () => ({ roomKey: "room", sessionId: "session-1", role: "presenter" }));

  await socket.handlers.get("games:queue:set")({ selected: ["breakout"] });
  await socket.handlers.get("games:queue:start")();

  assert.equal(store.snapshot("session-1", ["breakout"]).status, "running");
  assert.equal(breakoutStore.snapshot("session-1").status, "ready");
});
