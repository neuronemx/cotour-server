const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createRaffleConfig,
  createInitialRaffleControllerState,
  reduceRaffleControllerState,
  getRaffleActions,
  canDispatchRaffleAction,
  createSlideConfirmDispatcher,
  renderRaffleController,
  winnerLabel,
  remainingRaffleSeconds
} = require("../public/shared/raffle-controller");

test("maps raffle states to available controller actions", () => {
  assert.deepEqual(getRaffleActions({ active: { state: "collecting" } }).map((action) => action.event), ["raffle:close_entries", "raffle:close"]);
  assert.deepEqual(getRaffleActions({ active: { state: "entries_closed" } }).map((action) => action.event), ["raffle:draw", "raffle:reset_winners", "raffle:close"]);
  assert.deepEqual(getRaffleActions({ active: { state: "drawing", pendingWinnerSelected: true } }).map((action) => action.event), []);
  assert.deepEqual(getRaffleActions({ active: { state: "winner" } }).map((action) => action.event), ["raffle:close"]);
});

test("prevents duplicate actions while one raffle action is pending", () => {
  const state = { active: { state: "collecting" }, pendingEvent: "raffle:close_entries" };

  assert.equal(canDispatchRaffleAction(state, "raffle:close_entries"), false);
  assert.equal(canDispatchRaffleAction(state, "raffle:close"), false);
});

test("does not expose manual reveal or reset outside entries_closed", () => {
  assert.equal(canDispatchRaffleAction({ active: { state: "drawing", pendingWinnerSelected: true } }, "raffle:reveal_winner"), false);
  assert.equal(canDispatchRaffleAction({ active: { state: "drawing" } }, "raffle:reset_winners"), false);
  assert.equal(canDispatchRaffleAction({ active: { state: "winner" } }, "raffle:reset_winners"), false);
  assert.equal(canDispatchRaffleAction({ active: { state: "entries_closed" } }, "raffle:reset_winners"), true);
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

test("refresh during drawing keeps authoritative revealAt for countdown", () => {
  let state = createInitialRaffleControllerState();
  const revealAt = new Date(10_000).toISOString();
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: { id: "r2", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt }
  });

  assert.equal(state.active.revealAt, revealAt);
  assert.equal(remainingRaffleSeconds(state.active, 6_001), 4);
});

test("applies the same raffle state events for Speaker and Stage controllers", () => {
  const payload = {
    active: { id: "r3", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 }
  };
  const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", payload);
  const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", payload);

  assert.deepEqual(getRaffleActions(speaker), getRaffleActions(stage));
});

test("winners reset event keeps Speaker and Stage synchronized", () => {
  const payload = {
    active: { id: "r4", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 },
    previousWinnerCount: 0
  };
  const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:winners_reset", payload);
  const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:winners_reset", payload);

  assert.deepEqual(speaker.active, stage.active);
  assert.equal(speaker.active.entryCount, 2);
  assert.equal(speaker.active.eligibleCount, 2);
});

test("state audienceCount updates connectedAudienceCount", () => {
  const state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 });

  assert.equal(state.connectedAudienceCount, 2);
});

test("collecting renders connected audience, ticket count, and Cerrar tómbola", () => {
  let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 });
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: { id: "r5", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 }
  });

  const html = renderRaffleController(state);
  assert.match(html, /CONECTADOS<\/span><strong>2<\/strong>/);
  assert.match(html, /BOLETOS<\/span><strong>0<\/strong>/);
  assert.match(html, /Cerrar tómbola/);
  assert.match(html, /secondary danger raffle-action/);
});

test("entries_closed renders frozen participant and eligible counts", () => {
  let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 4 });
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: { id: "r6", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 1 }
  });

  const html = renderRaffleController(state);
  assert.match(html, /PARTICIPANTES<\/span><strong>2<\/strong>/);
  assert.match(html, /ELEGIBLES<\/span><strong>1<\/strong>/);
  assert.doesNotMatch(html, /CONECTADOS/);
});

test("entries_closed uses slide confirmation instead of a normal draw button", () => {
  const state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r7", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  };

  const html = renderRaffleController(state);
  assert.match(html, /data-raffle-slide-confirm/);
  assert.match(html, /Desliza para iniciar sorteo/);
  assert.doesNotMatch(html, /data-raffle-action="raffle:draw"/);
  assert.match(html, /Restablecer ganadores/);
  assert.match(html, /Cerrar sorteo/);
});

test("slide confirmation emits raffle:draw exactly once", () => {
  const emitted = [];
  let state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r8", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  };
  const slider = { dataset: {}, style: { setProperty() {} } };
  const dispatch = createSlideConfirmDispatcher({
    getState: () => state,
    emit: (eventName) => emitted.push(eventName),
    setPending: (eventName) => { state = { ...state, pendingEvent: eventName }; }
  });

  assert.equal(dispatch(slider), true);
  assert.equal(dispatch(slider), false);
  assert.deepEqual(emitted, ["raffle:draw"]);
  assert.equal(state.pendingEvent, "raffle:draw");
});

test("pending state blocks repeated slide confirmation", () => {
  const emitted = [];
  const state = {
    ...createInitialRaffleControllerState(),
    pendingEvent: "raffle:draw",
    active: { id: "r9", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  };
  let restored = false;
  const dispatch = createSlideConfirmDispatcher({
    getState: () => state,
    emit: (eventName) => emitted.push(eventName),
    setPending() {},
    reset: () => { restored = true; }
  });

  assert.equal(dispatch({ dataset: {} }), false);
  assert.equal(restored, true);
  assert.deepEqual(emitted, []);
});

test("rejection clears pending state and restores the slide control", () => {
  let state = {
    ...createInitialRaffleControllerState(),
    pendingEvent: "raffle:draw",
    active: { id: "r10", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  };
  state = reduceRaffleControllerState(state, "raffle:rejected", { reason: "no_eligible_entries" });

  const html = renderRaffleController(state);
  assert.equal(state.pendingEvent, "");
  assert.match(html, /No hay participantes elegibles/);
  assert.match(html, /data-raffle-slide-confirm/);
  assert.doesNotMatch(html, /data-slide-completed/);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});

test("drawing renders automatic countdown without manual action", () => {
  const state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r11", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt: new Date(Date.now() + 5_000).toISOString() }
  };

  const html = renderRaffleController(state);
  assert.match(html, /Sorteando/);
  assert.match(html, /REVELACIÓN EN/);
  assert.doesNotMatch(html, /Mostrar ganador/);
});

test("visual key preview does not create individual selectable actions", () => {
  const html = renderRaffleController(createInitialRaffleControllerState());

  assert.match(html, /data-raffle-create="visual_key"/);
  assert.match(html, /Usa una dinámica visual preparada/);
  assert.match(html, /Vista previa de claves visuales temporales/);
  assert.doesNotMatch(html, /data-raffle-create="visual_key_1"/);
  assert.doesNotMatch(html, /data-raffle-create="visual_key_2"/);
  assert.doesNotMatch(html, /data-raffle-create="visual_key_3"/);
  assert.doesNotMatch(html, /data-raffle-create="visual_key_4"/);
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
