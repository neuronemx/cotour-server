const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRaffleConfig,
  createInitialRaffleControllerState,
  reduceRaffleControllerState,
  getRaffleActions,
  canDispatchRaffleAction,
  winnerLabel
} = require("../public/shared/raffle-controller");

test("maps raffle states to available controller actions", () => {
  assert.deepEqual(getRaffleActions({ active: { state: "collecting" } }).map((action) => action.event), ["raffle:close_entries", "raffle:close"]);
  assert.deepEqual(getRaffleActions({ active: { state: "entries_closed" } }).map((action) => action.event), ["raffle:draw", "raffle:close"]);
  assert.deepEqual(getRaffleActions({ active: { state: "winner" } }).map((action) => action.event), ["raffle:close", "raffle:reset_winners"]);

  const drawing = getRaffleActions({ active: { state: "drawing", pendingWinnerSelected: false } });
  assert.equal(drawing.length, 1);
  assert.equal(drawing[0].event, "raffle:reveal_winner");
  assert.equal(drawing[0].disabled, true);
});

test("prevents duplicate actions while one raffle action is pending", () => {
  const state = { active: { state: "collecting" }, pendingEvent: "raffle:close_entries" };

  assert.equal(canDispatchRaffleAction(state, "raffle:close_entries"), false);
  assert.equal(canDispatchRaffleAction(state, "raffle:close"), false);
});

test("reconstructs raffle controller state from server state after refresh", () => {
  let state = createInitialRaffleControllerState();
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: {
      id: "r1",
      mode: "free",
      state: "entries_closed",
      entryCount: 2,
      eligibleCount: 2
    },
    previousWinnerCount: 1
  });

  assert.equal(state.active.id, "r1");
  assert.equal(state.active.state, "entries_closed");
  assert.equal(state.previousWinnerCount, 1);
  assert.equal(canDispatchRaffleAction(state, "raffle:draw"), true);
});

test("applies the same raffle state events for Speaker and Stage controllers", () => {
  const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    active: { id: "r2", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 }
  });
  const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    active: { id: "r2", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 }
  });

  assert.deepEqual(getRaffleActions(speaker), getRaffleActions(stage));
});

test("visual key config uses one correct temporary option without exposing permanent assets", () => {
  const config = createRaffleConfig("visual_key");

  assert.equal(config.mode, "visual_key");
  assert.equal(config.title, "Sorteo");
  assert.equal(config.options.length, 4);
  assert.equal(config.options.some((option) => option.id === config.entryKey), true);
});

test("winner label avoids exposing audience id when no public label exists", () => {
  assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id" } }), "Ganador seleccionado");
  assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id", label: "Mesa 4" } }), "Mesa 4");
});
