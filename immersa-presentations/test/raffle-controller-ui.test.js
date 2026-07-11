const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SlideConfirm = require("../public/shared/slide-confirm");
const {
  RAFFLE_MODES,
  INTERACTION_CATEGORIES,
  createRaffleConfig,
  createInitialRaffleControllerState,
  reduceRaffleControllerState,
  getRaffleActions,
  canDispatchRaffleAction,
  createSlideConfirmDispatcher,
  renderInteractionHome,
  renderRaffleController,
  winnerLabel,
  remainingRaffleSeconds,
  isRaffleNavigationLocked,
  SLIDE_COMPLETE_RATIO
} = require("../public/shared/raffle-controller");

function readProjectFile(filePath) { return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8"); }
function scriptSources(html) { return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]); }
function stylesheetSources(html) { return [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map((match) => match[1]); }
function assertSlideConfirmLoadsBeforeRaffleController(filePath) { const sources = scriptSources(readProjectFile(filePath)); const slideConfirmIndex = sources.indexOf("/shared/slide-confirm.js"); const raffleControllerIndex = sources.indexOf("/shared/raffle-controller.js"); assert.notEqual(slideConfirmIndex, -1); assert.notEqual(raffleControllerIndex, -1); assert.equal(slideConfirmIndex < raffleControllerIndex, true); }
function assertInteractionsHomeCssLoaded(filePath) { assert.ok(stylesheetSources(readProjectFile(filePath)).includes("/shared/interactions-home.css")); }
function loadBrowserRaffleControlsWithoutHelper() { const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval }; sandbox.globalThis = sandbox; vm.runInNewContext(readProjectFile("public/shared/raffle-controller.js"), sandbox); return sandbox.ImmersaRaffleControls; }

test("Speaker loads shared helpers and interactions home styles", () => { assertSlideConfirmLoadsBeforeRaffleController("public/presenter/index.html"); assertInteractionsHomeCssLoaded("public/presenter/index.html"); });
test("Stage loads shared helpers and interactions home styles", () => { assertSlideConfirmLoadsBeforeRaffleController("public/stage/index.html"); assertInteractionsHomeCssLoaded("public/stage/index.html"); });

test("interaction home is neutral and renders the four categories", () => {
  const html = renderInteractionHome();
  assert.match(html, /<h2 id="interactionHomeTitle">Interacciones<\/h2>/);
  for (const category of INTERACTION_CATEGORIES) {
    assert.match(html, new RegExp(">" + category.label + "<"));
    assert.match(html, new RegExp(category.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /data-interaction-category="polls"/);
  assert.match(html, /data-interaction-category="raffles"/);
  assert.doesNotMatch(html, /data-interaction-category="contests"/);
  assert.doesNotMatch(html, /data-interaction-category="games"/);
  assert.equal((html.match(/Próximamente/g) || []).length, 2);
  assert.match(html, /disabled aria-disabled="true"/);
  assert.doesNotMatch(html, /data-raffle-create/);
  assert.doesNotMatch(html, /data-interaction-launch/);
});

test("controller shell starts from home and preserves poll nodes", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");
  assert.match(source, /let currentTab = "home"/);
  assert.match(source, /while \(host\.firstChild\) existing\.appendChild\(host\.firstChild\);/);
  assert.doesNotMatch(source, /cloneNode/);
  assert.doesNotMatch(source, /existing\.innerHTML\s*=/);
  assert.match(source, /data-interaction-home/);
  assert.match(source, /data-interaction-category-nav/);
  assert.doesNotMatch(source, /data-raffle-tab="polls"/);
  assert.doesNotMatch(source, /role="tablist"/);
});

test("home navigation opens polls or raffles and back returns to home", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");
  assert.match(source, /currentTab = tab;\s*renderAllHosts\(\);/);
  assert.match(source, /data-interaction-home-back/);
  assert.match(source, /currentTab = "home";\s*renderAllHosts\(\);/);
  assert.match(source, /if \(state\.active \|\| state\.activeInteraction\) return;/);
});

test("active flows reconstruct their direct view instead of the neutral home", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");
  assert.match(source, /else if \(state\.active\) currentTab = "raffles"/);
  assert.match(source, /else if \(state\.activeInteraction\) currentTab = "polls"/);
  assert.match(source, /eventName === "raffle:closed"\) currentTab = "home"/);
  assert.match(source, /eventName === "interaction:closed"\) currentTab = "home"/);
});

test("modal close resets to the neutral home when no flow is active", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");
  assert.match(source, /function isModalToggleOrCloseTarget\(target\)/);
  assert.match(source, /#stageActionsButton/);
  assert.match(source, /!state\.active && !state\.activeInteraction && isModalToggleOrCloseTarget\(event\.target\)/);
  assert.match(source, /currentTab = "home"; clearLocalSetup\(\); scheduleRender\(\);/);
});

test("raffle selection renders modes in the requested order", () => {
  assert.deepEqual(RAFFLE_MODES.map((mode) => mode.id), ["free", "poll", "visual_key"]);
  const html = renderRaffleController(createInitialRaffleControllerState());
  const freeIndex = html.indexOf('data-raffle-create="free"');
  const pollIndex = html.indexOf('data-raffle-create="poll"');
  const visualIndex = html.indexOf('data-raffle-config-mode="visual_key"');
  assert.ok(freeIndex > -1 && pollIndex > -1 && visualIndex > -1);
  assert.ok(freeIndex < pollIndex);
  assert.ok(pollIndex < visualIndex);
  assert.match(html, />Libre</);
  assert.match(html, />Encuesta</);
  assert.match(html, />Clave visual</);
  assert.doesNotMatch(html, /data-raffle-key-option=/);
  assert.doesNotMatch(html, /Abrir participación/);
});

test("browser controller renders fallback UI when slide helper is absent", () => {
  const controls = loadBrowserRaffleControlsWithoutHelper();
  const html = controls.renderRaffleController({ ...controls.createInitialRaffleControllerState(), active: { id: "r-browser", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } });
  assert.match(html, /Desliza para iniciar sorteo/);
  assert.match(html, /interaction-close-slider/);
  assert.match(html, /data-raffle-slide-confirm/);
  assert.match(controls.renderInteractionHome(), /Interacciones/);
});

test("poll launch handlers still emit interaction:launch from Speaker and Stage", () => { const presenter = readProjectFile("public/presenter/presenter.js"); const stage = readProjectFile("public/stage/stage.js"); assert.match(presenter, /data-interaction-launch[\s\S]+socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/); assert.match(stage, /data-interaction-launch[\s\S]+socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/); });

test("maps raffle states to available controller actions", () => { assert.deepEqual(getRaffleActions({ active: { state: "collecting" } }).map((action) => action.event), ["raffle:close_entries", "raffle:close"]); assert.deepEqual(getRaffleActions({ active: { state: "entries_closed" } }).map((action) => action.event), ["raffle:draw", "raffle:reset_winners", "raffle:close"]); assert.deepEqual(getRaffleActions({ active: { state: "drawing", pendingWinnerSelected: true } }).map((action) => action.event), []); assert.deepEqual(getRaffleActions({ active: { state: "winner" } }).map((action) => action.event), ["raffle:close"]); });

test("raffle navigation lock applies to any active raffle and not to setup", () => { assert.equal(isRaffleNavigationLocked(createInitialRaffleControllerState()), false); assert.equal(isRaffleNavigationLocked({ active: null }), false); assert.equal(isRaffleNavigationLocked({ active: { state: "collecting" } }), true); assert.equal(isRaffleNavigationLocked({ active: { state: "entries_closed" } }), true); assert.equal(isRaffleNavigationLocked({ active: { state: "drawing" } }), true); assert.equal(isRaffleNavigationLocked({ active: { state: "winner" } }), true); });

test("external modal close paths are blocked while any raffle is active", () => { const source = readProjectFile("public/shared/raffle-controller.js"); assert.match(source, /function isRaffleNavigationLocked\(state\) \{ return Boolean\(state\?\.active\); \}/); assert.match(source, /function installNavigationLockGuards\(\)/); assert.match(source, /event\.key === "Escape" && isRaffleNavigationLocked\(state\)/); assert.match(source, /isRaffleNavigationLocked\(state\) && isExternalCloseTarget\(event\.target\)/); assert.match(source, /\[data-interaction-panel-close\], \[data-stage-actions-close\], \[data-close-modal\], #interactionToggle/); assert.match(source, /addEventListener\("keydown",[\s\S]+true\)/); assert.match(source, /addEventListener\("click",[\s\S]+true\)/); });

test("prevents duplicate actions while one raffle action is pending", () => { const state = { active: { state: "collecting" }, pendingEvent: "raffle:close_entries" }; assert.equal(canDispatchRaffleAction(state, "raffle:close_entries"), false); assert.equal(canDispatchRaffleAction(state, "raffle:close"), false); });

test("does not expose manual reveal or reset outside entries_closed", () => { assert.equal(canDispatchRaffleAction({ active: { state: "drawing", pendingWinnerSelected: true } }, "raffle:reveal_winner"), false); assert.equal(canDispatchRaffleAction({ active: { state: "drawing" } }, "raffle:reset_winners"), false); assert.equal(canDispatchRaffleAction({ active: { state: "winner" } }, "raffle:reset_winners"), false); assert.equal(canDispatchRaffleAction({ active: { state: "entries_closed" } }, "raffle:reset_winners"), true); });

test("reconstructs raffle controller state from server state after refresh", () => { let state = createInitialRaffleControllerState(); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r1", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }, previousWinnerCount: 1 }); assert.equal(state.active.id, "r1"); assert.equal(state.active.state, "entries_closed"); assert.equal(state.previousWinnerCount, 1); assert.equal(canDispatchRaffleAction(state, "raffle:draw"), true); });

test("refresh during drawing keeps authoritative revealAt for countdown", () => { let state = createInitialRaffleControllerState(); const revealAt = new Date(10_000).toISOString(); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r2", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt } }); assert.equal(state.active.revealAt, revealAt); assert.equal(remainingRaffleSeconds(state.active, 6_001), 4); });

test("applies the same raffle state events for Speaker and Stage controllers", () => { const payload = { active: { id: "r3", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 } }; const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", payload); const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", payload); assert.deepEqual(getRaffleActions(speaker), getRaffleActions(stage)); });

test("winners reset event keeps Speaker and Stage synchronized", () => { const payload = { active: { id: "r4", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }, previousWinnerCount: 0 }; const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:winners_reset", payload); const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:winners_reset", payload); assert.deepEqual(speaker.active, stage.active); assert.equal(speaker.active.entryCount, 2); assert.equal(speaker.active.eligibleCount, 2); });

test("state audienceCount updates connectedAudienceCount", () => { const state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 }); assert.equal(state.connectedAudienceCount, 2); });

test("collecting renders connected audience without ticket metric for all modes", () => { for (const mode of ["free", "visual_key", "poll"]) { let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 }); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r5-" + mode, mode, state: "collecting", entryCount: 0, eligibleCount: 0 } }); const html = renderRaffleController(state); assert.match(html, /CONECTADOS<\/span><strong>2<\/strong>/); assert.doesNotMatch(html, /BOLETOS/); assert.doesNotMatch(html, /Boletos/); assert.match(html, /Cerrar tómbola/); assert.match(html, /data-raffle-action="raffle:close"/); assert.equal(isRaffleNavigationLocked(state), true); } });

test("active raffle titles are complete in every state", () => {
  const modes = [["free", "Sorteo Libre"], ["visual_key", "Sorteo Clave visual"], ["poll", "Sorteo Encuesta"]];
  for (const [mode, title] of modes) {
    for (const raffleState of ["collecting", "entries_closed", "drawing", "winner"]) {
      const html = renderRaffleController({ ...createInitialRaffleControllerState(), active: { id: "r-title", mode, state: raffleState, entryCount: 1, eligibleCount: 1, revealAt: new Date(Date.now() + 5_000).toISOString(), winner: { label: "Mesa 1" } } });
      assert.match(html, new RegExp("<h2>" + title + "<\\/h2>"));
      assert.doesNotMatch(html, new RegExp("<h2>" + (mode === "free" ? "Libre" : mode === "visual_key" ? "Clave visual" : "Encuesta") + "<\\/h2>"));
    }
  }
});

test("entries_closed renders frozen participant and eligible counts", () => { let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 4 }); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r6", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 1 } }); const html = renderRaffleController(state); assert.match(html, /PARTICIPANTES<\/span><strong>2<\/strong>/); assert.match(html, /ELEGIBLES<\/span><strong>1<\/strong>/); assert.doesNotMatch(html, /CONECTADOS/); assert.equal(isRaffleNavigationLocked(state), true); });

test("entries_closed uses shared slide confirmation instead of a normal draw button", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r7", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; const html = renderRaffleController(state); assert.match(html, /interaction-close-slider/); assert.match(html, /interaction-close-slider-track/); assert.match(html, /interaction-close-slider-label/); assert.match(html, /interaction-close-slider-knob/); assert.match(html, /data-raffle-slide-confirm/); assert.match(html, /Desliza para iniciar sorteo/); assert.doesNotMatch(html, /data-raffle-action="raffle:draw"/); assert.match(html, /Restablecer ganadores/); assert.match(html, /Cerrar sorteo/); });

test("raffle slide confirmation shares the close-slider threshold", () => { assert.equal(SLIDE_COMPLETE_RATIO, SlideConfirm.COMPLETE_THRESHOLD); assert.equal(SlideConfirm.COMPLETE_THRESHOLD, 0.82); });

test("slide confirmation emits raffle:draw exactly once", () => { const emitted = []; let state = { ...createInitialRaffleControllerState(), active: { id: "r8", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; const slider = { dataset: {}, style: { setProperty() {} }, classList: { remove() {} } }; const dispatch = createSlideConfirmDispatcher({ getState: () => state, emit: (eventName) => emitted.push(eventName), setPending: (eventName) => { state = { ...state, pendingEvent: eventName }; } }); assert.equal(dispatch(slider), true); assert.equal(dispatch(slider), false); assert.deepEqual(emitted, ["raffle:draw"]); assert.equal(state.pendingEvent, "raffle:draw"); });

test("pending state blocks repeated slide confirmation", () => { const emitted = []; const state = { ...createInitialRaffleControllerState(), pendingEvent: "raffle:draw", active: { id: "r9", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; let restored = false; const dispatch = createSlideConfirmDispatcher({ getState: () => state, emit: (eventName) => emitted.push(eventName), setPending() {}, reset: () => { restored = true; } }); assert.equal(dispatch({ dataset: {} }), false); assert.equal(restored, true); assert.deepEqual(emitted, []); });

test("rejection clears pending state and restores the slide control", () => { let state = { ...createInitialRaffleControllerState(), pendingEvent: "raffle:draw", active: { id: "r10", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; state = reduceRaffleControllerState(state, "raffle:rejected", { reason: "no_eligible_entries" }); const html = renderRaffleController(state); assert.equal(state.pendingEvent, ""); assert.match(html, /No hay participantes elegibles/); assert.match(html, /data-raffle-slide-confirm/); assert.doesNotMatch(html, /data-slide-completed/); assert.doesNotMatch(html, /aria-disabled="true"/); });

test("drawing renders automatic countdown without suffix, manual action, or metrics", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r11", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt: new Date(Date.now() + 5_000).toISOString() } }; const html = renderRaffleController(state); assert.match(html, /Sorteando/); assert.match(html, /REVELACIÓN EN/); assert.doesNotMatch(html, /REVELACIÓN EN<\/span><strong>\d+s<\/strong>/); assert.doesNotMatch(html, /PARTICIPANTES/); assert.doesNotMatch(html, /ELEGIBLES/); assert.doesNotMatch(html, /Mostrar ganador/); assert.equal(isRaffleNavigationLocked(state), true); });

test("winner renders winner block and close action without participant metrics", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r12", mode: "free", state: "winner", entryCount: 2, eligibleCount: 2, winner: { label: "Mesa 4" } } }; const html = renderRaffleController(state); assert.match(html, /<h2>Sorteo Libre<\/h2><p>Tenemos ganador<\/p>/); assert.match(html, /<span>Ganador<\/span><strong>Mesa 4<\/strong>/); assert.match(html, /data-raffle-action="raffle:close"/); assert.match(html, /Cerrar sorteo/); assert.doesNotMatch(html, /PARTICIPANTES/); assert.doesNotMatch(html, /ELEGIBLES/); assert.doesNotMatch(html, /Restablecer ganadores/); assert.equal(isRaffleNavigationLocked(state), true); });

test("visual key selector requires choosing the correct option before creating", () => {
  const emptyHtml = renderRaffleController({ ...createInitialRaffleControllerState(), configMode: "visual_key" });
  const selectedState = reduceRaffleControllerState({ ...createInitialRaffleControllerState(), configMode: "visual_key" }, "raffle:state", { visualKeyDraftEntryKey: "visual_key_2", active: null });
  const selectedHtml = renderRaffleController(selectedState);
  assert.match(emptyHtml, /class="raffle-mode-card raffle-visual-key-card"/);
  assert.match(emptyHtml, /data-raffle-key-option="visual_key_1"/);
  assert.match(emptyHtml, /data-raffle-key-option="visual_key_4"/);
  assert.match(emptyHtml, /data-raffle-create="visual_key" disabled/);
  assert.match(emptyHtml, />A<\/span>/);
  assert.match(emptyHtml, />D<\/span>/);
  assert.doesNotMatch(emptyHtml, /Clave A<\/span>/);
  assert.match(selectedHtml, /data-raffle-key-option="visual_key_2" aria-pressed="true"/);
  assert.match(selectedHtml, /raffle-key-option is-selected/);
  assert.doesNotMatch(selectedHtml, /data-raffle-create="visual_key" disabled/);
});

test("visual key config has no default entryKey and uses the synchronized draft", () => { const emptyConfig = createRaffleConfig("visual_key", createInitialRaffleControllerState()); const selectedState = reduceRaffleControllerState({ ...createInitialRaffleControllerState(), configMode: "visual_key" }, "raffle:state", { visualKeyDraftEntryKey: "visual_key_3", active: null }); const selectedConfig = createRaffleConfig("visual_key", selectedState); assert.equal(emptyConfig.mode, "visual_key"); assert.equal(emptyConfig.title, "Sorteo"); assert.equal(emptyConfig.entryKey, ""); assert.equal(emptyConfig.options.length, 4); assert.equal(selectedConfig.entryKey, "visual_key_3"); assert.equal(selectedConfig.options.some((option) => option.id === selectedConfig.entryKey), true); });

test("winner label avoids exposing audience id when no public label exists", () => { assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id" } }), "Ganador seleccionado"); assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id", label: "Mesa 4" } }), "Mesa 4"); });
