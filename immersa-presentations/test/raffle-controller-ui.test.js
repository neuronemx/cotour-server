const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SlideConfirm = require("../public/shared/slide-confirm");
const {
  createRaffleConfig,
  createInitialRaffleControllerState,
  reduceRaffleControllerState,
  getRaffleActions,
  canDispatchRaffleAction,
  createSlideConfirmDispatcher,
  renderRaffleController,
  winnerLabel,
  remainingRaffleSeconds,
  isRaffleNavigationLocked,
  SLIDE_COMPLETE_RATIO
} = require("../public/shared/raffle-controller");

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8");
}

function scriptSources(html) {
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
}

function assertSlideConfirmLoadsBeforeRaffleController(filePath) {
  const sources = scriptSources(readProjectFile(filePath));
  const slideConfirmIndex = sources.indexOf("/shared/slide-confirm.js");
  const raffleControllerIndex = sources.indexOf("/shared/raffle-controller.js");

  assert.notEqual(slideConfirmIndex, -1);
  assert.notEqual(raffleControllerIndex, -1);
  assert.equal(slideConfirmIndex < raffleControllerIndex, true);
}

function loadBrowserRaffleControlsWithoutHelper() {
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readProjectFile("public/shared/raffle-controller.js"), sandbox);
  return sandbox.ImmersaRaffleControls;
}

test("Speaker loads slide-confirm before raffle-controller", () => {
  assertSlideConfirmLoadsBeforeRaffleController("public/presenter/index.html");
});

test("Stage loads slide-confirm before raffle-controller", () => {
  assertSlideConfirmLoadsBeforeRaffleController("public/stage/index.html");
});

test("raffle selection renders the three approved modes", () => {
  const html = renderRaffleController(createInitialRaffleControllerState());

  assert.match(html, /data-raffle-create="visual_key"/);
  assert.match(html, /data-raffle-create="poll"/);
  assert.match(html, /data-raffle-create="free"/);
  assert.match(html, />Clave visual</);
  assert.match(html, />Encuesta</);
  assert.match(html, />Libre</);
  assert.doesNotMatch(html, /Usa una dinámica visual preparada/);
});

test("browser controller renders fallback UI when slide helper is absent", () => {
  const controls = loadBrowserRaffleControlsWithoutHelper();
  const html = controls.renderRaffleController({
    ...controls.createInitialRaffleControllerState(),
    active: { id: "r-browser", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  });

  assert.match(html, /Desliza para iniciar sorteo/);
  assert.match(html, /interaction-close-slider/);
  assert.match(html, /data-raffle-slide-confirm/);
  assert.match(controls.renderRaffleController(controls.createInitialRaffleControllerState()), /data-raffle-create="visual_key"/);
});

test("raffle shell preserves poll nodes instead of cloning or replacing them", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");

  assert.match(source, /while \(host\.firstChild\) existing\.appendChild\(host\.firstChild\);/);
  assert.doesNotMatch(source, /cloneNode/);
  assert.doesNotMatch(source, /existing\.innerHTML\s*=/);
  assert.doesNotMatch(source, /\.raffle-existing-content[\s\S]{0,120}innerHTML\s*=/);
});

test("raffle subview hides tabs and conditionally provides a back control", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");

  assert.match(source, /host\.classList\.toggle\("is-raffle-subview", inRaffleSubview\)/);
  assert.match(source, /tabs\.hidden = inRaffleSubview/);
  assert.match(source, /tabs\.classList\.toggle\("is-hidden", inRaffleSubview\)/);
  assert.match(source, /tabs\.style\.display = inRaffleSubview \? "none" : ""/);
  assert.match(source, /const backMarkup = isRaffleNavigationLocked\(state\) \? "" : '<button type="button" class="raffle-back-button" data-raffle-back>← Volver<\/button>'/);
  assert.match(source, /currentTab = "polls"; renderAllHosts\(\);/);
});

test("raffle selector hierarchy has no duplicate labels", () => {
  const html = renderRaffleController(createInitialRaffleControllerState());

  assert.doesNotMatch(html, /<span>Sorteos<\/span>/i);
  assert.equal((html.match(/<h2>Sorteo<\/h2>/g) || []).length, 1);
  assert.equal((html.match(/<h2>/g) || []).length, 1);
  assert.match(html, /<p>Elige un modo para crear la convocatoria\.<\/p>/);
});

test("active raffle hierarchy uses mode title and state text", () => {
  let state = createInitialRaffleControllerState();
  state = reduceRaffleControllerState(state, "raffle:state", {
    active: { id: "r-active", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 }
  });

  const html = renderRaffleController(state);
  assert.match(html, /<h2>Libre<\/h2><p>Participación abierta<\/p>/);
  assert.doesNotMatch(html, /<span>Sorteos<\/span>/i);
  assert.doesNotMatch(html, /<h2>Participación abierta<\/h2>/);
  assert.match(html, /data-raffle-action="raffle:close_entries"/);
  assert.match(html, /data-raffle-action="raffle:close"/);
});

test("poll launch handlers still emit interaction:launch from Speaker and Stage", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  const stage = readProjectFile("public/stage/stage.js");

  assert.match(presenter, /data-interaction-launch[\s\S]+socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/);
  assert.match(stage, /data-interaction-launch[\s\S]+socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/);
});

test("maps raffle states to available controller actions", () => {
  assert.deepEqual(getRaffleActions({ active: { state: "collecting" } }).map((action) => action.event), ["raffle:close_entries", "raffle:close"]);
  assert.deepEqual(getRaffleActions({ active: { state: "entries_closed" } }).map((action) => action.event), ["raffle:draw", "raffle:reset_winners", "raffle:close"]);
  assert.deepEqual(getRaffleActions({ active: { state: "drawing", pendingWinnerSelected: true } }).map((action) => action.event), []);
  assert.deepEqual(getRaffleActions({ active: { state: "winner" } }).map((action) => action.event), ["raffle:close"]);
});

test("raffle navigation lock applies only to drawing and winner", () => {
  assert.equal(isRaffleNavigationLocked({ active: { state: "collecting" } }), false);
  assert.equal(isRaffleNavigationLocked({ active: { state: "entries_closed" } }), false);
  assert.equal(isRaffleNavigationLocked({ active: { state: "drawing" } }), true);
  assert.equal(isRaffleNavigationLocked({ active: { state: "winner" } }), true);
});

test("locked raffle states do not expose back navigation or alternate exits", () => {
  const drawingHtml = renderRaffleController({
    ...createInitialRaffleControllerState(),
    active: { id: "r-lock-drawing", mode: "free", state: "drawing", revealAt: new Date(Date.now() + 5_000).toISOString() }
  });
  const winnerHtml = renderRaffleController({
    ...createInitialRaffleControllerState(),
    active: { id: "r-lock-winner", mode: "free", state: "winner", winner: { label: "Mesa 4" } }
  });

  assert.doesNotMatch(drawingHtml, /Volver/);
  assert.doesNotMatch(winnerHtml, /Volver/);
  assert.doesNotMatch(drawingHtml, /data-raffle-action=/);
  assert.match(winnerHtml, /data-raffle-action="raffle:close"/);
  assert.doesNotMatch(winnerHtml, /data-raffle-action="raffle:reset_winners"/);
});

test("external modal close paths are blocked while raffle navigation is locked", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");

  assert.match(source, /function installNavigationLockGuards\(\)/);
  assert.match(source, /event\.key === "Escape" && isRaffleNavigationLocked\(state\)/);
  assert.match(source, /isRaffleNavigationLocked\(state\) && isExternalCloseTarget\(event\.target\)/);
  assert.match(source, /\[data-interaction-panel-close\], \[data-stage-actions-close\], #interactionToggle/);
  assert.match(source, /addEventListener\("keydown",[\s\S]+true\)/);
  assert.match(source, /addEventListener\("click",[\s\S]+true\)/);
});

test("closing a locked winner returns controllers to the initial interactions view", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");

  assert.match(source, /const wasLocked = isRaffleNavigationLocked\(state\)/);
  assert.match(source, /eventName === "raffle:closed" && wasLocked\) currentTab = "polls"/);
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
    active: { id: "r1", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 },
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
  const payload = { active: { id: "r3", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 } };
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
  assert.match(html, /danger secondary raffle-action/);
  assert.equal(isRaffleNavigationLocked(state), false);
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
  assert.equal(isRaffleNavigationLocked(state), false);
});

test("entries_closed uses shared slide confirmation instead of a normal draw button", () => {
  const state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r7", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  };

  const html = renderRaffleController(state);
  assert.match(html, /interaction-close-slider/);
  assert.match(html, /interaction-close-slider-track/);
  assert.match(html, /interaction-close-slider-label/);
  assert.match(html, /interaction-close-slider-knob/);
  assert.match(html, /data-raffle-slide-confirm/);
  assert.match(html, /Desliza para iniciar sorteo/);
  assert.doesNotMatch(html, /data-raffle-action="raffle:draw"/);
  assert.match(html, /Restablecer ganadores/);
  assert.match(html, /Cerrar sorteo/);
});

test("raffle slide confirmation shares the close-slider threshold", () => {
  assert.equal(SLIDE_COMPLETE_RATIO, SlideConfirm.COMPLETE_THRESHOLD);
  assert.equal(SlideConfirm.COMPLETE_THRESHOLD, 0.82);
});

test("slide confirmation emits raffle:draw exactly once", () => {
  const emitted = [];
  let state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r8", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }
  };
  const slider = { dataset: {}, style: { setProperty() {} }, classList: { remove() {} } };
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

test("drawing renders automatic countdown without manual action or metrics", () => {
  const state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r11", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt: new Date(Date.now() + 5_000).toISOString() }
  };

  const html = renderRaffleController(state);
  assert.match(html, /Sorteando/);
  assert.match(html, /REVELACIÓN EN/);
  assert.doesNotMatch(html, /PARTICIPANTES/);
  assert.doesNotMatch(html, /ELEGIBLES/);
  assert.doesNotMatch(html, /<strong>2<\/strong>/);
  assert.doesNotMatch(html, /Mostrar ganador/);
  assert.equal(isRaffleNavigationLocked(state), true);
});

test("winner renders winner block and close action without participant metrics", () => {
  const state = {
    ...createInitialRaffleControllerState(),
    active: { id: "r12", mode: "free", state: "winner", entryCount: 2, eligibleCount: 2, winner: { label: "Mesa 4" } }
  };

  const html = renderRaffleController(state);
  assert.match(html, /<h2>Libre<\/h2><p>Tenemos ganador<\/p>/);
  assert.match(html, /<span>Ganador<\/span><strong>Mesa 4<\/strong>/);
  assert.match(html, /data-raffle-action="raffle:close"/);
  assert.match(html, /Cerrar sorteo/);
  assert.doesNotMatch(html, /PARTICIPANTES/);
  assert.doesNotMatch(html, /ELEGIBLES/);
  assert.doesNotMatch(html, /Restablecer ganadores/);
  assert.equal(isRaffleNavigationLocked(state), true);
});

test("visual key selector requires choosing the correct option before creating", () => {
  const emptyHtml = renderRaffleController(createInitialRaffleControllerState());
  const selectedState = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    visualKeyDraftEntryKey: "visual_key_2",
    active: null
  });
  const selectedHtml = renderRaffleController(selectedState);

  assert.match(emptyHtml, /class="raffle-mode-card raffle-visual-key-card"/);
  assert.match(emptyHtml, /data-raffle-key-option="visual_key_1"/);
  assert.match(emptyHtml, /data-raffle-key-option="visual_key_4"/);
  assert.match(emptyHtml, /data-raffle-create="visual_key" disabled/);
  assert.match(selectedHtml, /data-raffle-key-option="visual_key_2" aria-pressed="true"/);
  assert.doesNotMatch(selectedHtml, /data-raffle-create="visual_key" disabled/);
  assert.doesNotMatch(emptyHtml, /Usa una dinámica visual preparada/);
});

test("visual key config has no default entryKey and uses the synchronized draft", () => {
  const emptyConfig = createRaffleConfig("visual_key", createInitialRaffleControllerState());
  const selectedState = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", {
    visualKeyDraftEntryKey: "visual_key_3",
    active: null
  });
  const selectedConfig = createRaffleConfig("visual_key", selectedState);

  assert.equal(emptyConfig.mode, "visual_key");
  assert.equal(emptyConfig.title, "Sorteo");
  assert.equal(emptyConfig.entryKey, "");
  assert.equal(emptyConfig.options.length, 4);
  assert.equal(selectedConfig.entryKey, "visual_key_3");
  assert.equal(selectedConfig.options.some((option) => option.id === selectedConfig.entryKey), true);
});

test("winner label avoids exposing audience id when no public label exists", () => {
  assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id" } }), "Ganador seleccionado");
  assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id", label: "Mesa 4" } }), "Mesa 4");
});
