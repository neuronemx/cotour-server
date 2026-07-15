const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BreakoutStore } = require("../breakout-store");

function advanceReadyPaddle(store, sessionId, direction, audienceId, startAt) {
  store.input(sessionId, audienceId, direction, startAt + 100);
  store.step(sessionId, 50, startAt + 200);
  store.input(sessionId, audienceId, direction, startAt + 300);
  return store.step(sessionId, 50, startAt + 400);
}

test("ready lobby keeps the clock frozen and accepts collective paddle input", () => {
  let now = 1000;
  const store = new BreakoutStore({ now: () => now });
  assert.equal(store.prepare("s1", "presenter", now).ok, true);

  const initial = store.snapshot("s1", now);
  const moved = advanceReadyPaddle(store, "s1", "right", "audience-1", now);

  assert.equal(initial.status, "ready");
  assert.equal(initial.remaining_ms, 60000);
  assert.equal(moved.status, "ready");
  assert.equal(moved.remaining_ms, 60000);
  assert.ok(moved.paddle.x > initial.paddle.x);
  assert.equal(store.hasActive("s1"), true);
});

test("starting from ready preserves paddle position and starts the authoritative timer", () => {
  const store = new BreakoutStore({ now: () => 1000 });
  store.prepare("s1", "stage", 1000);
  const ready = advanceReadyPaddle(store, "s1", "left", "audience-1", 1000);
  const paddleX = ready.paddle.x;

  const result = store.start("s1", "stage", 2000);
  const running = store.snapshot("s1", 2000);

  assert.equal(result.ok, true);
  assert.equal(running.status, "running");
  assert.equal(running.remaining_ms, 60000);
  assert.equal(running.paddle.x, paddleX);
});

test("ready lobby contract includes preview, cleanup, fullscreen, and portrait fitting", () => {
  const sockets = fs.readFileSync(path.join(__dirname, "../breakout-sockets.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-ui.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/shared/breakout-controls-art.css"), "utf8");

  assert.match(sockets, /breakout:prepare/);
  assert.match(sockets, /interaction:closed/);
  assert.match(sockets, /raffle:closed/);
  assert.match(ui, /requestFullscreen/);
  assert.match(ui, /webkitRequestFullscreen/);
  assert.match(ui, /breakout:close/);
  assert.match(css, /100dvh/);
  assert.match(css, /data-breakout-direction="left"/);
  assert.match(css, /breakout-fullscreen/);
});
