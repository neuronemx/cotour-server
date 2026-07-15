const test = require("node:test");
const assert = require("node:assert/strict");
const { BreakoutStore } = require("../breakout-store");

function makeClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    set: (value) => { now = value; },
    add: (value) => { now += value; }
  };
}

test("only presenter or stage can control Breakout", () => {
  const clock = makeClock();
  const store = new BreakoutStore({ now: clock.now });
  assert.equal(store.start("s1", "audience").ok, false);
  assert.equal(store.start("s1", "presenter").ok, true);
  assert.equal(store.pause("s1", "screen").reason, "unauthorized_role");
  assert.equal(store.pause("s1", "stage").ok, true);
});

test("collective input moves paddle by left versus right difference", () => {
  const clock = makeClock();
  const store = new BreakoutStore({ now: clock.now, inputWindowMs: 100 });
  store.start("s1", "presenter");
  store.input("s1", "a1", "right", 1010);
  store.input("s1", "a2", "right", 1020);
  store.input("s1", "a3", "left", 1030);
  const before = store.snapshot("s1", 1030).paddle.x;
  store.step("s1", 50, 1120);
  const after = store.snapshot("s1", 1120).paddle.x;
  assert.ok(after > before);
});

test("audience input is rate limited per participant", () => {
  const clock = makeClock();
  const store = new BreakoutStore({ now: clock.now });
  store.start("s1", "presenter");
  assert.equal(store.input("s1", "a1", "left", 1010).ok, true);
  assert.equal(store.input("s1", "a1", "left", 1040).reason, "rate_limited");
  assert.equal(store.input("s1", "a1", "left", 1080).ok, true);
});

test("game finishes when authoritative duration expires", () => {
  const clock = makeClock();
  const store = new BreakoutStore({ now: clock.now, durationMs: 1000 });
  store.start("s1", "presenter", 1000);
  assert.equal(store.step("s1", 16, 1999).status, "running");
  const finished = store.step("s1", 16, 2000);
  assert.equal(finished.status, "finished");
  assert.equal(finished.remaining_ms, 0);
});

test("misses respawn the ball without ending the game", () => {
  const clock = makeClock();
  const store = new BreakoutStore({ now: clock.now });
  store.start("s1", "presenter");
  const game = store.getSession("s1");
  game.ball.y = 1.1;
  game.ball.vy = 0.3;
  const snapshot = store.step("s1", 16, 1100);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.misses, 1);
  assert.equal(snapshot.ball.y, 0.72);
});
