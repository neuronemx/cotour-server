const test = require("node:test");
const assert = require("node:assert/strict");
const { GameQueueStore } = require("../game-queue-store");

test("queue keeps only the selected available games in difficulty order", () => {
  const store = new GameQueueStore();
  const result = store.configure("session-1", "presenter", ["pong", "breakout"], ["breakout", "pong"]);

  assert.equal(result.ok, true);
  assert.deepEqual(store.snapshot("session-1", ["breakout", "pong"]).selected, ["breakout", "pong"]);
});

test("queue rejects unavailable games and cannot start empty", () => {
  const store = new GameQueueStore();

  assert.equal(store.configure("session-1", "stage", ["pong"], ["breakout"]).reason, "game_unavailable");
  assert.equal(store.validateStart("session-1", "stage", ["breakout"]).reason, "empty_queue");
});

test("queue locks selection while running and exposes its next game", () => {
  const store = new GameQueueStore();
  store.configure("session-1", "presenter", ["breakout", "pong"], ["breakout", "pong"]);
  const validation = store.validateStart("session-1", "presenter", ["breakout", "pong"]);
  assert.deepEqual(validation, { ok: true, gameType: "breakout" });
  assert.equal(store.start("session-1", "breakout").ok, true);

  assert.equal(store.configure("session-1", "stage", ["pong"], ["breakout", "pong"]).reason, "queue_locked");
  const running = store.snapshot("session-1", ["breakout", "pong"]);
  assert.equal(running.locked, true);
  assert.equal(running.current_game_type, "breakout");
  assert.equal(running.next_game_type, "pong");
});

test("final game remains visible until a controller ends the queue", () => {
  const store = new GameQueueStore();
  store.configure("session-1", "presenter", ["breakout"], ["breakout"]);
  store.start("session-1", "breakout");
  assert.equal(store.finish("session-1", "breakout").ok, true);
  assert.equal(store.snapshot("session-1", ["breakout"]).status, "finished");
  assert.equal(store.end("session-1", "stage").ok, true);
  const idle = store.snapshot("session-1", ["breakout"]);
  assert.equal(idle.status, "idle");
  assert.deepEqual(idle.selected, ["breakout"]);
});
