const test = require("node:test");
const assert = require("node:assert/strict");
const { PongStore } = require("../pong-store");
const { createPongSocketHandlers } = require("../pong-sockets");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");
const { GameQueueStore } = require("../game-queue-store");
const { createGameQueueSocketHandlers } = require("../game-queue-sockets");
const { InteractionStore, createInteractionSocketHandlers } = require("../interaction-store");

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
      return { emit(event, payload) { emitted.push({ room, event, payload }); } };
    }
  };
}

function createClock(start = 1000) {
  let value = start;
  return {
    now: () => value,
    set(next) { value = next; },
    add(delta) { value += delta; }
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

test("Speaker and Stage prepare Pong and synchronize lobby team names", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new PongStore({ now: () => 1000 });
  const runtime = createPongSocketHandlers({ io, store, ...intervals });
  const socket = createSocket();
  runtime.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "presenter" }));

  await socket.handlers.get("pong:prepare")();
  socket.handlers.get("pong:teams:set")({ left: "Océano", right: "Fuego" });

  const state = io.emitted.at(-1).payload;
  assert.equal(state.status, "ready");
  assert.equal(state.teams.left.name, "Océano");
  assert.equal(state.teams.right.name, "Fuego");
  assert.equal(intervals.active.size, 1);
});

test("starting after a long lobby resets loop timing before acceleration begins", async () => {
  const clock = createClock();
  const io = createIo();
  const intervals = createIntervals();
  const store = new PongStore({ now: clock.now });
  const runtime = createPongSocketHandlers({ io, store, now: clock.now, ...intervals });
  const socket = createSocket();
  runtime.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "stage" }));

  await socket.handlers.get("pong:prepare")();
  clock.set(30000);
  await socket.handlers.get("pong:start")();
  clock.add(50);
  intervals.active.values().next().value.fn();
  assert.equal(store.snapshot("s1").speed_multiplier, 1);
});

test("audience team choice is server-bound to its identity and restored on reconnect", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "stage");
  const runtime = createPongSocketHandlers({ io, store, ...intervals });
  const socket = createSocket();
  const context = { roomKey: "room", sessionId: "s1", role: "audience", audienceId: "a1" };
  runtime.attach(socket, () => context);

  socket.handlers.get("pong:team:join")({ team: "left", audienceId: "spoofed" });
  runtime.sendCurrentState(socket, context);
  assert.equal(socket.emitted.filter((item) => item.event === "pong:membership").at(-1).payload.team, "left");

  store.start("s1", "stage");
  const late = createSocket();
  runtime.sendCurrentState(late, { ...context, audienceId: "late" });
  assert.deepEqual(late.emitted.at(-1), {
    event: "pong:membership",
    payload: { team: "", spectator: true, roster_locked: true }
  });
});

test("the loop emits each goal once and notifies the queue once at match end", async () => {
  const clock = createClock();
  const io = createIo();
  const intervals = createIntervals();
  const store = new PongStore({ now: clock.now, durationMs: 1000 });
  const finished = [];
  const runtime = createPongSocketHandlers({
    io,
    store,
    now: clock.now,
    onFinished: (payload) => finished.push(payload),
    ...intervals
  });
  const context = { roomKey: "room", sessionId: "s1", role: "stage" };
  await runtime.prepare(context);
  store.start("s1", "stage", 1000);
  const game = store.getSession("s1");
  game.ball.x = -0.1;
  game.ball.y = 0.02;
  game.ball.vx = -0.34;

  clock.add(100);
  intervals.active.values().next().value.fn();
  clock.add(100);
  intervals.active.values().next().value.fn();
  assert.equal(io.emitted.filter((item) => item.event === "pong:goal").length, 1);

  clock.set(2000);
  intervals.active.values().next().value.fn();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].gameType, "pong");
  assert.equal(intervals.active.size, 0);
});

test("Pong closes a competing registered game before entering its lobby", async () => {
  const io = createIo();
  const intervals = createIntervals();
  const store = new PongStore({ now: () => 1000 });
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  let breakoutActive = true;
  coordinator.registerGame("breakout", {
    hasActive: () => breakoutActive,
    close() { breakoutActive = false; return { ok: true }; }
  });
  const runtime = createPongSocketHandlers({ io, store, coordinator, ...intervals });
  coordinator.registerGame("pong", runtime);

  const result = await runtime.prepare({ roomKey: "room", sessionId: "s1", role: "presenter" });
  assert.equal(result.ok, true);
  assert.equal(breakoutActive, false);
  assert.equal(store.snapshot("s1").status, "ready");
});

test("Pong core remains hidden from the queue until its UI explicitly enables it", () => {
  const io = createIo();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  coordinator.registerGame("breakout", {
    hasActive: () => false,
    prepare: () => ({ ok: true }),
    close: () => ({ ok: true })
  });
  const pong = createPongSocketHandlers({ io, store: new PongStore() });
  coordinator.registerGame("pong", pong);
  const queue = createGameQueueSocketHandlers({ io, store: new GameQueueStore(), coordinator });

  const state = queue.snapshot("s1");
  assert.equal(state.catalog.find((game) => game.id === "breakout").available, true);
  assert.equal(state.catalog.find((game) => game.id === "pong").available, false);
});

test("only Stage synchronizes bounded Pong audio configuration", () => {
  const io = createIo();
  const runtime = createPongSocketHandlers({ io, store: new PongStore() });
  const stage = createSocket();
  runtime.attach(stage, () => ({ roomKey: "room", sessionId: "s1", role: "stage" }));
  stage.handlers.get("pong:audio:set")({ muted: true, volume: 2, pack: "SOFT" });
  assert.deepEqual(io.emitted.at(-1), {
    room: "room",
    event: "pong:audio:state",
    payload: { muted: true, volume: 1, pack: "soft" }
  });

  const presenter = createSocket();
  runtime.attach(presenter, () => ({ roomKey: "room", sessionId: "s1", role: "presenter" }));
  const before = io.emitted.length;
  presenter.handlers.get("pong:audio:set")({ muted: false, volume: 0, pack: "arcade" });
  assert.equal(io.emitted.length, before);

  const screen = createSocket();
  runtime.attach(screen, () => ({ roomKey: "room", sessionId: "s1", role: "screen" }));
  screen.handlers.get("pong:audio:request")();
  assert.deepEqual(screen.emitted.at(-1), {
    event: "pong:audio:state",
    payload: { muted: true, volume: 1, pack: "soft" }
  });

  stage.handlers.get("pong:audio:set")({ volume: "invalid", pack: "../../bad" });
  assert.deepEqual(runtime.audioState("s1"), { muted: false, volume: 0.7, pack: "arcade" });
});

test("production interaction runtime exposes and prepares Pong from the ordered game queue", async () => {
  const io = createIo();
  const coordinator = new ActiveInteractionCoordinator({ interactionStore: null, raffleStore: null });
  const interactionRuntime = createInteractionSocketHandlers({
    io,
    store: new InteractionStore(),
    loadInteractionsForDeck: async () => [],
    getRoleRoomKey: (roomKey, role) => `${roomKey}::${role}`,
    coordinator
  });
  const queue = createGameQueueSocketHandlers({ io, store: new GameQueueStore(), coordinator });
  const pong = coordinator.getGameRuntime("pong");
  assert.equal(interactionRuntime.pongSockets, pong);
  assert.equal(pong.queueAvailable, true);
  assert.equal(queue.snapshot("s1").catalog.find((game) => game.id === "pong").available, true);

  const socket = createSocket();
  queue.attach(socket, () => ({ roomKey: "room", sessionId: "s1", role: "presenter" }));
  await socket.handlers.get("games:queue:set")({ selected: ["pong"] });
  await socket.handlers.get("games:queue:start")();

  assert.equal(queue.snapshot("s1").current_game_type, "pong");
  assert.equal(interactionRuntime.pongStore.snapshot("s1").status, "ready");
});
