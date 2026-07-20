const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PongStore,
  MAX_SPEED_MULTIPLIER,
  MAX_TEAM_NAME_LENGTH,
  TEAM_DEFAULTS
} = require("../pong-store");

function makeClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    set(value) { now = value; },
    add(value) { now += value; }
  };
}

test("Pong team names are editable in the lobby, bounded, and retained for a rematch", () => {
  const clock = makeClock();
  const store = new PongStore({ now: clock.now });
  store.prepare("s1", "presenter");

  const result = store.setTeamNames("s1", "stage", {
    left: "  Las Ballenas Azules  ",
    right: "Naranjas con un nombre demasiado largo para el lobby"
  });
  assert.equal(result.ok, true);
  assert.equal(store.snapshot("s1").teams.left.name, "Las Ballenas Azules");
  assert.equal(Array.from(store.snapshot("s1").teams.right.name).length, MAX_TEAM_NAME_LENGTH);

  store.start("s1", "presenter");
  assert.equal(store.setTeamNames("s1", "stage", { left: "Otro" }).reason, "names_locked");
  store.close("s1", "stage");
  store.prepare("s1", "stage");
  assert.equal(store.snapshot("s1").teams.left.name, "Las Ballenas Azules");
});

test("empty lobby names fall back to the frozen blue and orange defaults", () => {
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "presenter");
  store.setTeamNames("s1", "presenter", { left: " ", right: "\n" });
  const state = store.snapshot("s1");
  assert.equal(state.teams.left.name, TEAM_DEFAULTS.left.name);
  assert.equal(state.teams.left.color, "#2f80ed");
  assert.equal(state.teams.right.name, TEAM_DEFAULTS.right.name);
  assert.equal(state.teams.right.color, "#f2994a");
  assert.equal(store.setTeamNames("s1", "presenter", null).ok, true);
});

test("the roster locks at start, restores known audience, and makes late joins spectators", () => {
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "presenter");
  const leftAudienceId = "audience-private-left-7f3c";
  const rightAudienceId = "audience-private-right-9d2e";
  assert.equal(store.joinTeam("s1", leftAudienceId, "left").ok, true);
  assert.equal(store.joinTeam("s1", rightAudienceId, "right").ok, true);
  assert.deepEqual(store.snapshot("s1").roster_counts, { left: 1, right: 1 });

  store.start("s1", "stage");
  assert.deepEqual(store.membership("s1", leftAudienceId), { team: "left", spectator: false, roster_locked: true });
  assert.equal(store.joinTeam("s1", leftAudienceId, "left").restored, true);
  assert.equal(store.joinTeam("s1", leftAudienceId, "right").reason, "roster_locked");
  assert.deepEqual(store.membership("s1", "late"), { team: "", spectator: true, roster_locked: true });
  assert.equal(store.joinTeam("s1", "late", "right").reason, "roster_locked");
  const serialized = JSON.stringify(store.snapshot("s1"));
  assert.equal(serialized.includes(leftAudienceId), false);
  assert.equal(serialized.includes(rightAudienceId), false);
});

test("collective input is normalized per team and one audience has one vote per window", () => {
  const clock = makeClock();
  const store = new PongStore({ now: clock.now, inputWindowMs: 100 });
  store.prepare("s1", "presenter");
  store.joinTeam("s1", "a1", "left", 1000);
  store.joinTeam("s1", "a2", "left", 1000);
  store.joinTeam("s1", "b1", "right", 1000);
  store.input("s1", "a1", "up", 1010);
  store.input("s1", "a2", "down", 1020);
  store.input("s1", "b1", "down", 1030);
  store.step("s1", 50, 1110);

  const game = store.getSession("s1");
  assert.equal(game.paddles.left.speed, 0);
  assert.equal(game.paddles.right.speed, 0.72);
  assert.ok(game.paddles.right.y > 0.5);
});

test("a goal updates the competitive score without resetting match acceleration", () => {
  const clock = makeClock();
  const store = new PongStore({ now: clock.now });
  store.prepare("s1", "presenter");
  store.start("s1", "presenter", 1000);
  const game = store.getSession("s1");
  game.elapsed_active_ms = 20000;
  game.ball.x = -0.1;
  game.ball.y = 0.05;
  game.ball.vx = -0.34;

  const state = store.step("s1", 50, 21000);
  assert.equal(state.teams.right.score, 1);
  assert.equal(state.last_goal.scoring_team, "right");
  assert.equal(state.last_goal.scoring_team_name, TEAM_DEFAULTS.right.name);
  assert.equal(state.speed_multiplier, 1.2);
  assert.equal(state.ball.vx < 0, true);
  assert.equal(state.serve_at_ms, 22200);
});

test("Pong speed grows with active match time and caps safely", () => {
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "presenter");
  store.start("s1", "presenter", 1000);
  const game = store.getSession("s1");
  game.elapsed_active_ms = 10000;
  assert.equal(store.snapshot("s1", 11000).speed_multiplier, 1.1);
  game.elapsed_active_ms = 90000;
  assert.equal(store.snapshot("s1", 11000).speed_multiplier, MAX_SPEED_MULTIPLIER);
});

test("match acceleration follows authoritative active time even after a delayed server tick", () => {
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "presenter", 1000);
  store.start("s1", "presenter", 1000);
  const state = store.step("s1", 5000, 6000);
  assert.equal(state.speed_multiplier, 1.05);
});

test("the authoritative clock finishes Pong and declares winner or tie", () => {
  const store = new PongStore({ now: () => 1000, durationMs: 1000 });
  store.prepare("s1", "presenter", 1000);
  store.start("s1", "presenter", 1000);
  store.getSession("s1").teams.left.score = 2;
  assert.equal(store.step("s1", 16, 1999).status, "running");
  const finished = store.step("s1", 16, 2000);
  assert.equal(finished.status, "finished");
  assert.equal(finished.remaining_ms, 0);
  assert.equal(finished.winner_team, "left");
});

test("pause and resume preserve both match time and a pending serve", () => {
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "presenter", 1000);
  store.start("s1", "presenter", 1000);
  const game = store.getSession("s1");
  store.scoreGoal(game, "left", 2000);
  store.pause("s1", "stage", 2200);
  assert.equal(store.snapshot("s1", 5000).remaining_ms, 58800);
  store.resume("s1", "stage", 5000);
  assert.equal(store.getSession("s1").serve_at_ms, 6000);
  assert.equal(store.snapshot("s1", 5000).remaining_ms, 58800);
});

test("a complete authoritative match keeps every physics value finite and bounded", () => {
  const store = new PongStore({ now: () => 1000 });
  store.prepare("s1", "presenter", 1000);
  store.start("s1", "presenter", 1000);
  let state = store.snapshot("s1", 1000);
  for (let nowMs = 1050; nowMs <= 61000; nowMs += 50) {
    state = store.step("s1", 50, nowMs);
    for (const value of [state.ball.x, state.ball.y, state.ball.vx, state.ball.vy, state.paddles.left.y, state.paddles.right.y]) {
      assert.equal(Number.isFinite(value), true);
    }
    assert.ok(state.paddles.left.y >= state.paddles.left.height / 2);
    assert.ok(state.paddles.left.y <= 1 - state.paddles.left.height / 2);
    if (state.status === "finished") break;
  }
  assert.equal(state.status, "finished");
});
