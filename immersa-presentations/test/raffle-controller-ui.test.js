const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const SlideConfirm = require("../public/shared/slide-confirm");
const { RAFFLE_REVEAL_DELAY_MS } = require("../raffle-store");
const {
  createRaffleConfig,
  createInitialRaffleControllerState,
  withLocalCountdown,
  RAFFLE_MODES,
  reduceRaffleControllerState,
  getRaffleActions,
  canDispatchRaffleAction,
  createSlideConfirmDispatcher,
  createController,
  renderRaffleController,
  winnerLabel,
  remainingRaffleSeconds,
  isRaffleNavigationLocked,
  shouldAutoInstallSocketCapture,
  SLIDE_COMPLETE_RATIO
} = require("../public/shared/raffle-controller");

function readProjectFile(filePath) { return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8"); }
function scriptSources(html) { return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]); }
function assertSlideConfirmLoadsBeforeRaffleController(filePath) { const sources = scriptSources(readProjectFile(filePath)); const slideConfirmIndex = sources.findIndex((source) => source.startsWith("/shared/slide-confirm.js")); const raffleControllerIndex = sources.indexOf("/shared/raffle-controller.js"); assert.notEqual(slideConfirmIndex, -1); assert.notEqual(raffleControllerIndex, -1); assert.equal(slideConfirmIndex < raffleControllerIndex, true); }
function loadBrowserRaffleControlsWithoutHelper() { const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval }; sandbox.globalThis = sandbox; vm.runInNewContext(readProjectFile("public/shared/raffle-controller.js"), sandbox); return sandbox.ImmersaRaffleControls; }

test("Speaker loads slide-confirm before raffle-controller", () => { assertSlideConfirmLoadsBeforeRaffleController("public/presenter/index.html"); });
test("Stage loads slide-confirm before raffle-controller", () => { assertSlideConfirmLoadsBeforeRaffleController("public/stage/index.html"); });

test("raffle visual css matches poll card geometry, typography, hover, selection, and stats pill", () => {
  const css = readProjectFile("public/shared/raffle-controller.css");
  const interactionsCss = readProjectFile("public/shared/interactions.css");
  assert.match(css, /\.raffle-mode-card,[\s\S]+\.stage-actions-card \.raffle-mode-card \{[\s\S]+height: auto !important;[\s\S]+min-height: 64px !important;[\s\S]+grid-template-columns: minmax\(0, 1fr\);[\s\S]+gap: 4px;[\s\S]+padding: 12px 44px 12px 12px !important;[\s\S]+border-radius: 14px !important;[\s\S]+transform: none !important;/);
  assert.match(interactionsCss, /\.interaction-panel button\.interaction-choice,[\s\S]+min-height: 64px;[\s\S]+border-radius: 14px !important;[\s\S]+padding: 12px 44px 12px 12px;/);
  assert.doesNotMatch(css, /\.stage-actions-card \.raffle-mode-card \{ min-height: 36px; \}/);
  assert.doesNotMatch(css, /\.stage-actions-card \.raffle-mode-card \{ height: auto; padding: 11px; border-radius: 16px; \}/);
  assert.match(css, /\.raffle-mode-card strong,[\s\S]+\.stage-actions-card \.raffle-mode-card strong \{[\s\S]+font-family: Poppins, Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-size: 13px;[\s\S]+font-weight: 500;/);
  assert.match(css, /\.raffle-mode-description,[\s\S]+\.stage-actions-card \.raffle-mode-description \{[\s\S]+font-family: Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-size: 11px;[\s\S]+font-weight: 400;/);
  assert.match(css, /\.raffle-mode-card:hover:not\(:disabled\),[\s\S]+\.stage-actions-card \.raffle-mode-card:hover:not\(:disabled\) \{[\s\S]+transform: none !important;/);
  assert.doesNotMatch(css, /\.raffle-mode-card:hover:not\(:disabled\) \{[\s\S]*?translateY\(-1px\);[\s\S]*?\}/);
  assert.doesNotMatch(css, /\.raffle-mode-card:hover:not\(:disabled\) \{[\s\S]*?scale\([\s\S]*?\}/);
  assert.match(css, /\.raffle-mode-card\.is-selected,[\s\S]+\.stage-actions-card \.raffle-mode-card\.is-selected \{[\s\S]+border: 1\.5px solid transparent !important;[\s\S]+var\(--immersa-gradient\) border-box !important;[\s\S]+box-shadow: none !important;/);
  assert.match(css, /\.raffle-stats-pill \{[\s\S]+display: flex;[\s\S]+border-radius: 999px;/);
  assert.match(css, /\.raffle-stat-item \{[\s\S]+white-space: nowrap;/);
  assert.match(css, /\.raffle-actions\.is-secondary \{[\s\S]+display: flex;[\s\S]+align-items: center;[\s\S]+gap: 8px;[\s\S]+padding-top: 2px;[\s\S]+border-top: 0 !important;/);
  assert.doesNotMatch(css, /\.raffle-actions\.is-secondary \{[^}]*border-top: 1px solid/);
  assert.match(css, /\.raffle-actions\.is-secondary \.raffle-action\.danger\[data-raffle-action="raffle:close"\] \{[\s\S]+margin-left: auto;/);
  assert.match(css, /\.raffle-countdown \{[\s\S]+min-height: 68px;[\s\S]+place-items: center;[\s\S]+color: #378add;[\s\S]+background: transparent;[\s\S]+border: 0;[\s\S]+border-radius: 0;[\s\S]+box-shadow: none;/);
  assert.match(css, /\.raffle-countdown strong \{[\s\S]+font-family: Poppins, Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-size: 38px;[\s\S]+color: #378add;/);
});


test("raffle controller resets incomplete local visual key drafts without socket emissions", () => {
  const handlers = {};
  const emitted = [];
  const socket = { on: (eventName, handler) => { handlers[eventName] = handler; }, emit: (...args) => emitted.push(args) };
  const controller = createController(socket, { installLegacyIntegration: false });
  handlers["raffle:state"]?.({ active: null, previousWinnerCount: 2, visualKeyDraftEntryKey: "visual_key_2" });
  assert.equal(controller.getState().configMode, "visual_key");
  assert.equal(controller.getState().visualKeyDraftEntryKey, "visual_key_2");
  assert.equal(controller.resetLocalSetup(), true);
  assert.equal(controller.getState().configMode, "");
  assert.equal(controller.getState().visualKeyDraftEntryKey, "");
  assert.equal(controller.getState().pendingEvent, "");
  assert.equal(controller.getState().previousWinnerCount, 2);
  const html = renderRaffleController(controller.getState());
  assert.match(html, /<h2>Sorteos disponibles<\/h2>/);
  assert.doesNotMatch(html, /<h2>Clave visual<\/h2>/);
  assert.deepEqual(emitted, []);

  handlers["raffle:active"]?.({ id: "r-active", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 });
  assert.equal(controller.resetLocalSetup(), false);
  assert.equal(controller.getState().active.id, "r-active");
});

test("raffle selection renders the three approved neutral modes", () => {
  const html = renderRaffleController(createInitialRaffleControllerState());
  assert.match(html, /data-raffle-config-mode="visual_key"/);
  assert.match(html, /data-raffle-create="poll"/);
  assert.match(html, /data-raffle-create="free"/);
  assert.match(html, />Clave visual</);
  assert.match(html, />Encuesta</);
  assert.match(html, />Libre</);
  assert.doesNotMatch(html, /data-raffle-key-option=/);
  assert.doesNotMatch(html, /Abrir participación/);
  assert.doesNotMatch(html, /Usa una dinámica visual preparada/);
});

test("browser controller renders fallback UI when slide helper is absent", () => {
  const controls = loadBrowserRaffleControlsWithoutHelper();
  const html = controls.renderRaffleController({ ...controls.createInitialRaffleControllerState(), active: { id: "r-browser", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } });
  assert.match(html, /Desliza para iniciar sorteo/);
  assert.match(html, /interaction-close-slider/);
  assert.match(html, /data-raffle-slide-confirm/);
  assert.match(controls.renderRaffleController(controls.createInitialRaffleControllerState()), /data-raffle-config-mode="visual_key"/);
});

test("raffle shell preserves poll nodes instead of cloning or replacing them", () => { const source = readProjectFile("public/shared/raffle-controller.js"); assert.match(source, /while \(host\.firstChild\) existing\.appendChild\(host\.firstChild\);/); assert.doesNotMatch(source, /cloneNode/); assert.doesNotMatch(source, /existing\.innerHTML\s*=/); assert.doesNotMatch(source, /\.raffle-existing-content[\s\S]{0,120}innerHTML\s*=/); });

test("raffle subview hides tabs and conditionally provides a back control", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");
  assert.match(source, /host\.classList\.toggle\("is-raffle-subview", inRaffleSubview\)/);
  assert.match(source, /tabs\.hidden = inRaffleSubview/);
  assert.match(source, /tabs\.classList\.toggle\("is-hidden", inRaffleSubview\)/);
  assert.match(source, /tabs\.style\.display = inRaffleSubview \? "none" : ""/);
  assert.match(source, /const backMarkup = isRaffleNavigationLocked\(state\) \? "" : '<button type="button" class="raffle-back-button" data-raffle-back>← Volver<\/button>'/);
  assert.match(source, /currentTab = "polls"; renderAllHosts\(\);/);
});

test("raffle selector hierarchy uses a single section heading", () => { const html = renderRaffleController(createInitialRaffleControllerState()); assert.doesNotMatch(html, /<span>Sorteos<\/span>/i); assert.equal((html.match(/<h2>/g) || []).length, 1); assert.match(html, /<h2>Sorteos disponibles<\/h2><p>Elige un modo para crear la convocatoria\.<\/p>/); });


test("raffle active status text is mode-aware for poll collecting only", () => {
  const base = createInitialRaffleControllerState();
  const freeHtml = renderRaffleController({ ...base, active: { id: "r-free", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 } });
  const pollHtml = renderRaffleController({ ...base, active: { id: "r-poll", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 } });
  const visualHtml = renderRaffleController({ ...base, active: { id: "r-visual", mode: "visual_key", state: "collecting", entryCount: 0, eligibleCount: 0 } });
  assert.match(freeHtml, /<h2>Sorteo Libre<\/h2><p>Participación abierta<\/p>/);
  assert.match(pollHtml, /<h2>Sorteo Encuesta<\/h2><p>Participación con pregunta o evaluación<\/p>/);
  assert.match(visualHtml, /<h2>Sorteo Clave visual<\/h2><p>Participación abierta<\/p>/);
  assert.match(renderRaffleController({ ...base, active: { id: "r-closed", mode: "poll", state: "entries_closed", entryCount: 1, eligibleCount: 1 } }), /<p>Participación cerrada<\/p>/);
  assert.match(renderRaffleController({ ...base, active: { id: "r-drawing", mode: "poll", state: "drawing", revealAt: new Date(Date.now() + 5000).toISOString() } }), /<p>Sorteando\.\.\.<\/p>/);
  assert.match(renderRaffleController({ ...base, active: { id: "r-winner", mode: "poll", state: "winner", winner: { label: "Mesa 1" } } }), /<p>Tenemos ganador<\/p>/);
});

test("active raffle hierarchy uses mode title and state text", () => { let state = createInitialRaffleControllerState(); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r-active", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 } }); const html = renderRaffleController(state); assert.match(html, /<h2>Sorteo Libre<\/h2><p>Participación abierta<\/p>/); assert.doesNotMatch(html, /<span>Sorteos<\/span>/i); assert.doesNotMatch(html, /<h2>Participación abierta<\/h2>/); assert.match(html, /data-raffle-action="raffle:close_entries"/); assert.match(html, /data-raffle-action="raffle:close"/); });

test("poll launch handlers still emit interaction:launch from Speaker and Stage", () => { const presenter = readProjectFile("public/presenter/presenter.js"); const stage = readProjectFile("public/stage/stage.js"); assert.match(presenter, /data-interaction-launch[\s\S]+socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/); assert.match(stage, /data-interaction-launch[\s\S]+socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/); });

test("maps raffle states to available controller actions", () => { const collecting = getRaffleActions({ active: { state: "collecting" } }); const closed = getRaffleActions({ active: { state: "entries_closed" } }); const winner = getRaffleActions({ active: { state: "winner" } }); assert.deepEqual(collecting.map((action) => action.event), ["raffle:close_entries", "raffle:close"]); assert.equal(collecting.find((action) => action.event === "raffle:close").label, "Cancelar sorteo"); assert.deepEqual(closed.map((action) => action.event), ["raffle:draw", "raffle:reset_winners", "raffle:close"]); assert.deepEqual(closed.find((action) => action.event === "raffle:close"), { event: "raffle:close", label: "Cancelar sorteo", danger: true, secondary: true }); assert.deepEqual(getRaffleActions({ active: { state: "drawing", pendingWinnerSelected: true } }).map((action) => action.event), []); assert.deepEqual(winner, [{ event: "raffle:close", label: "Cerrar sorteo", primary: true }]); });

test("raffle navigation lock applies to any active raffle and not to setup", () => { assert.equal(isRaffleNavigationLocked(createInitialRaffleControllerState()), false); assert.equal(isRaffleNavigationLocked({ active: null }), false); assert.equal(isRaffleNavigationLocked({ active: { state: "collecting" } }), true); assert.equal(isRaffleNavigationLocked({ active: { state: "entries_closed" } }), true); assert.equal(isRaffleNavigationLocked({ active: { state: "drawing" } }), true); assert.equal(isRaffleNavigationLocked({ active: { state: "winner" } }), true); });

test("locked raffle states do not expose back navigation or alternate exits", () => { const drawingHtml = renderRaffleController({ ...createInitialRaffleControllerState(), active: { id: "r-lock-drawing", mode: "free", state: "drawing", revealAt: new Date(Date.now() + 5_000).toISOString() } }); const winnerHtml = renderRaffleController({ ...createInitialRaffleControllerState(), active: { id: "r-lock-winner", mode: "free", state: "winner", winner: { label: "Mesa 4" } } }); assert.doesNotMatch(drawingHtml, /Volver/); assert.doesNotMatch(winnerHtml, /Volver/); assert.doesNotMatch(drawingHtml, /data-raffle-action=/); assert.match(winnerHtml, /data-raffle-action="raffle:close"/); assert.doesNotMatch(winnerHtml, /data-raffle-action="raffle:reset_winners"/); });

test("external modal close paths are blocked while any raffle is active", () => { const source = readProjectFile("public/shared/raffle-controller.js"); assert.match(source, /function isRaffleNavigationLocked\(state\) \{ return Boolean\(state\?\.active\); \}/); assert.match(source, /function installNavigationLockGuards\(\)/); assert.match(source, /event\.key === "Escape" && isRaffleNavigationLocked\(state\)/); assert.match(source, /isRaffleNavigationLocked\(state\) && isExternalCloseTarget\(event\.target\)/); assert.match(source, /\[data-interaction-panel-close\], \[data-stage-actions-close\], #interactionToggle/); assert.match(source, /addEventListener\("keydown",[\s\S]+true\)/); assert.match(source, /addEventListener\("click",[\s\S]+true\)/); });

test("closing a locked winner returns controllers to the initial interactions view", () => { const source = readProjectFile("public/shared/raffle-controller.js"); assert.match(source, /const wasLocked = isRaffleNavigationLocked\(state\)/); assert.match(source, /eventName === "raffle:closed" && wasLocked\) currentTab = "polls"/); });

test("prevents duplicate actions while one raffle action is pending", () => { const state = { active: { state: "collecting" }, pendingEvent: "raffle:close_entries" }; assert.equal(canDispatchRaffleAction(state, "raffle:close_entries"), false); assert.equal(canDispatchRaffleAction(state, "raffle:close"), false); });

test("does not expose manual reveal or reset outside entries_closed", () => { assert.equal(canDispatchRaffleAction({ active: { state: "drawing", pendingWinnerSelected: true } }, "raffle:reveal_winner"), false); assert.equal(canDispatchRaffleAction({ active: { state: "drawing" } }, "raffle:reset_winners"), false); assert.equal(canDispatchRaffleAction({ active: { state: "winner" } }, "raffle:reset_winners"), false); assert.equal(canDispatchRaffleAction({ active: { state: "entries_closed" } }, "raffle:reset_winners"), true); });

test("reconstructs raffle controller state from server state after refresh", () => { let state = createInitialRaffleControllerState(); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r1", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }, previousWinnerCount: 1 }); assert.equal(state.active.id, "r1"); assert.equal(state.active.state, "entries_closed"); assert.equal(state.previousWinnerCount, 1); assert.equal(canDispatchRaffleAction(state, "raffle:draw"), true); });

test("refresh during drawing keeps authoritative revealAt for countdown", () => { let state = createInitialRaffleControllerState(); const revealAt = new Date(10_000).toISOString(); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r2", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt } }); assert.equal(state.active.revealAt, revealAt); assert.equal(remainingRaffleSeconds(state.active, 6_001), 4); });

test("applies the same raffle state events for Speaker and Stage controllers", () => { const payload = { active: { id: "r3", mode: "poll", state: "collecting", entryCount: 0, eligibleCount: 0 } }; const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", payload); const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:state", payload); assert.deepEqual(getRaffleActions(speaker), getRaffleActions(stage)); });

test("winners reset event keeps Speaker and Stage synchronized", () => { const payload = { active: { id: "r4", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 }, previousWinnerCount: 0 }; const speaker = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:winners_reset", payload); const stage = reduceRaffleControllerState(createInitialRaffleControllerState(), "raffle:winners_reset", payload); assert.deepEqual(speaker.active, stage.active); assert.equal(speaker.active.entryCount, 2); assert.equal(speaker.active.eligibleCount, 2); });

test("state audienceCount updates connectedAudienceCount", () => { const state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 }); assert.equal(state.connectedAudienceCount, 2); });

test("collecting renders connected audience without ticket metric for all modes", () => { for (const mode of ["free", "visual_key", "poll"]) { let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 2 }); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r5-" + mode, mode, state: "collecting", entryCount: 0, eligibleCount: 0 } }); const html = renderRaffleController(state); assert.match(html, /<div class="raffle-stats-pill"><span class="raffle-stat-item"><span>Conectados<\/span><strong>2<\/strong><\/span><span class="raffle-stat-divider" aria-hidden="true"><\/span><span class="raffle-stat-item"><span>Elegibles<\/span><strong>0<\/strong><\/span><\/div>/); assert.doesNotMatch(html, /BOLETOS/);
    assert.doesNotMatch(html, /class="raffle-stats"><div>/); assert.doesNotMatch(html, /Boletos/); assert.match(html, /Cerrar tómbola/); assert.match(html, /data-raffle-action="raffle:close"/); assert.equal(isRaffleNavigationLocked(state), true); } });

test("collecting keeps Cancelar sorteo as the explicit exit", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r5", mode: "free", state: "collecting", entryCount: 0, eligibleCount: 0 } }; const html = renderRaffleController(state); assert.match(html, /data-raffle-action="raffle:close"/); assert.match(html, /Cancelar sorteo/); assert.doesNotMatch(html, /Volver/); });

test("entries_closed renders connected and eligible counts in one pill", () => { let state = reduceRaffleControllerState(createInitialRaffleControllerState(), "state", { audienceCount: 4 }); state = reduceRaffleControllerState(state, "raffle:state", { active: { id: "r6", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 1 } }); const html = renderRaffleController(state); assert.match(html, /<div class="raffle-stats-pill">/); assert.match(html, /<span>Conectados<\/span><strong>4<\/strong>/); assert.match(html, /<span>Elegibles<\/span><strong>1<\/strong>/); assert.doesNotMatch(html, /PARTICIPANTES/); assert.doesNotMatch(html, /class="raffle-stats"><div>/); assert.equal(isRaffleNavigationLocked(state), true); });

test("entries_closed uses shared slide confirmation instead of a normal draw button", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r7", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; const html = renderRaffleController(state); assert.match(html, /interaction-close-slider/); assert.match(html, /interaction-close-slider-track/); assert.match(html, /interaction-close-slider-label/); assert.match(html, /interaction-close-slider-knob/); assert.match(html, /data-raffle-slide-confirm/); assert.match(html, /Desliza para iniciar sorteo/); assert.doesNotMatch(html, /data-raffle-action="raffle:draw"/); assert.match(html, /Restablecer ganadores/); assert.match(html, /class="danger secondary raffle-action" data-raffle-action="raffle:close" [^>]*>Cancelar sorteo<\/button>/); assert.doesNotMatch(html, /Cerrar sorteo/); });

test("raffle slide confirmation shares the close-slider threshold", () => { assert.equal(SLIDE_COMPLETE_RATIO, SlideConfirm.COMPLETE_THRESHOLD); assert.equal(SlideConfirm.COMPLETE_THRESHOLD, 0.82); });

test("slide confirmation emits raffle:draw exactly once", () => { const emitted = []; let state = { ...createInitialRaffleControllerState(), active: { id: "r8", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; const slider = { dataset: {}, style: { setProperty() {} }, classList: { remove() {} } }; const dispatch = createSlideConfirmDispatcher({ getState: () => state, emit: (eventName) => emitted.push(eventName), setPending: (eventName) => { state = { ...state, pendingEvent: eventName }; } }); assert.equal(dispatch(slider), true); assert.equal(dispatch(slider), false); assert.deepEqual(emitted, ["raffle:draw"]); assert.equal(state.pendingEvent, "raffle:draw"); });

test("pending state blocks repeated slide confirmation", () => { const emitted = []; const state = { ...createInitialRaffleControllerState(), pendingEvent: "raffle:draw", active: { id: "r9", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; let restored = false; const dispatch = createSlideConfirmDispatcher({ getState: () => state, emit: (eventName) => emitted.push(eventName), setPending() {}, reset: () => { restored = true; } }); assert.equal(dispatch({ dataset: {} }), false); assert.equal(restored, true); assert.deepEqual(emitted, []); });

test("rejection clears pending state and restores the slide control", () => { let state = { ...createInitialRaffleControllerState(), pendingEvent: "raffle:draw", active: { id: "r10", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } }; state = reduceRaffleControllerState(state, "raffle:rejected", { reason: "no_eligible_entries" }); const html = renderRaffleController(state); assert.equal(state.pendingEvent, ""); assert.match(html, /No hay participantes elegibles/); assert.match(html, /data-raffle-slide-confirm/); assert.doesNotMatch(html, /data-slide-completed/); assert.doesNotMatch(html, /aria-disabled="true"/); });

test("drawing renders automatic countdown without manual action or metrics", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r11", mode: "free", state: "drawing", entryCount: 2, eligibleCount: 2, revealAt: new Date(Date.now() + 5_000).toISOString() } }; const html = renderRaffleController(state); assert.match(html, /Sorteando/); assert.match(html, /<div class="raffle-countdown" role="status" aria-live="polite" aria-label="Cuenta regresiva"><strong>5<\/strong><\/div>/); assert.doesNotMatch(html, /REVELACIÓN EN/); assert.doesNotMatch(html, /<span>REVELACIÓN EN<\/span>/); assert.doesNotMatch(html, /PARTICIPANTES/); assert.doesNotMatch(html, /Elegibles/); assert.doesNotMatch(html, /<strong>2<\/strong>/); assert.doesNotMatch(html, /Mostrar ganador/); assert.equal(isRaffleNavigationLocked(state), true); });

test("winner renders winner block and close action without participant metrics", () => { const state = { ...createInitialRaffleControllerState(), active: { id: "r12", mode: "free", state: "winner", entryCount: 2, eligibleCount: 2, winner: { label: "Mesa 4" } } }; const html = renderRaffleController(state); assert.match(html, /<h2>Sorteo Libre<\/h2><p>Tenemos ganador<\/p>/); assert.match(html, /<span>Ganador<\/span><strong>Mesa 4<\/strong>/); assert.match(html, /data-raffle-action="raffle:close"/); assert.match(html, /Cerrar sorteo/); assert.doesNotMatch(html, /PARTICIPANTES/); assert.doesNotMatch(html, /Elegibles/); assert.doesNotMatch(html, /Restablecer ganadores/); assert.equal(isRaffleNavigationLocked(state), true); });

test("visual key selector requires choosing the correct option before creating", () => {
  const emptyHtml = renderRaffleController({ ...createInitialRaffleControllerState(), configMode: "visual_key" });
  const selectedState = reduceRaffleControllerState({ ...createInitialRaffleControllerState(), configMode: "visual_key" }, "raffle:state", { visualKeyDraftEntryKey: "visual_key_2", active: null });
  const selectedHtml = renderRaffleController(selectedState);
  assert.match(emptyHtml, /class="raffle-mode-card raffle-visual-key-card"/);
  assert.match(emptyHtml, /data-raffle-key-option="visual_key_1"/);
  assert.match(emptyHtml, /data-raffle-key-option="visual_key_4"/);
  assert.match(emptyHtml, /data-raffle-create="visual_key" disabled/);
  assert.match(selectedHtml, /data-raffle-key-option="visual_key_2" aria-pressed="true"/);
  assert.doesNotMatch(selectedHtml, /data-raffle-create="visual_key" disabled/);
  assert.doesNotMatch(emptyHtml, /Usa una dinámica visual preparada/);
});

test("visual key config has no default entryKey and uses the synchronized draft", () => { const emptyConfig = createRaffleConfig("visual_key", createInitialRaffleControllerState()); const selectedState = reduceRaffleControllerState({ ...createInitialRaffleControllerState(), configMode: "visual_key" }, "raffle:state", { visualKeyDraftEntryKey: "visual_key_3", active: null }); const selectedConfig = createRaffleConfig("visual_key", selectedState); assert.equal(emptyConfig.mode, "visual_key"); assert.equal(emptyConfig.title, "Sorteo"); assert.equal(emptyConfig.entryKey, ""); assert.equal(emptyConfig.options.length, 4); assert.equal(selectedConfig.entryKey, "visual_key_3"); assert.equal(selectedConfig.options.some((option) => option.id === selectedConfig.entryKey), true); });

test("winner label avoids exposing audience id when no public label exists", () => { assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id" } }), "Ganador seleccionado"); assert.equal(winnerLabel({ winner: { audienceId: "sensitive-id", label: "Mesa 4" } }), "Mesa 4"); });



test("socket capture auto-install skips Speaker and Stage explicit routes", () => {
  assert.equal(shouldAutoInstallSocketCapture("/speaker"), false);
  assert.equal(shouldAutoInstallSocketCapture("/speaker/a_example"), false);
  assert.equal(shouldAutoInstallSocketCapture("/presenter"), false);
  assert.equal(shouldAutoInstallSocketCapture("/presenter/a_example"), false);
  assert.equal(shouldAutoInstallSocketCapture("/stage"), false);
  assert.equal(shouldAutoInstallSocketCapture("/stage/a_example"), false);
});


test("raffle mode order is Libre, Encuesta, Clave visual", () => {
  assert.deepEqual(RAFFLE_MODES.map((mode) => mode.id), ["free", "poll", "visual_key"]);
  const html = renderRaffleController(createInitialRaffleControllerState());
  assert.equal(html.indexOf("<strong>Libre</strong>") < html.indexOf("<strong>Encuesta</strong>"), true);
  assert.equal(html.indexOf("<strong>Encuesta</strong>") < html.indexOf("<strong>Clave visual</strong>"), true);
});

test("eligible metric is hidden when zero and visible when positive", () => {
  const zeroHtml = renderRaffleController({ ...createInitialRaffleControllerState(), active: { id: "r-e0", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 0 } });
  const positiveHtml = renderRaffleController({ ...createInitialRaffleControllerState(), active: { id: "r-e2", mode: "free", state: "entries_closed", entryCount: 2, eligibleCount: 2 } });
  assert.match(zeroHtml, /<span>Elegibles<\/span><strong>0<\/strong>/);
  assert.match(positiveHtml, /<span>Elegibles<\/span><strong>2<\/strong>/);
});

test("controller countdown renders stable five second sequence without seconds suffix", () => {
  const nowMs = 50_000;
  const active = { id: "r-count", mode: "free", state: "drawing", revealAt: new Date(nowMs + RAFFLE_REVEAL_DELAY_MS).toISOString() };
  const originalNow = Date.now;
  Date.now = () => nowMs;
  try {
    const html = renderRaffleController({ ...createInitialRaffleControllerState(), active });
    assert.match(html, /<div class="raffle-countdown" role="status" aria-live="polite" aria-label="Cuenta regresiva"><strong>5<\/strong><\/div>/);
    assert.doesNotMatch(html, /REVELACIÓN EN/);
    assert.doesNotMatch(html, /<strong>[1-5]s<\/strong>/);
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual([0, 1000, 2000, 3000, 4000].map((elapsed) => remainingRaffleSeconds(active, nowMs + elapsed)), [5, 4, 3, 2, 1]);
});


test("controller countdown uses server relative remaining time despite client clock skew", () => {
  const serverRevealAt = new Date(100_000).toISOString();
  const payload = { id: "r-skew", mode: "free", state: "drawing", revealAt: serverRevealAt, countdownRemainingMs: 5_000 };
  const clientAhead = withLocalCountdown(payload, 102_000);
  const clientBehind = withLocalCountdown(payload, 98_000);

  assert.equal(remainingRaffleSeconds(clientAhead, 102_000), 5);
  assert.equal(remainingRaffleSeconds(clientBehind, 98_000), 5);
  assert.equal(remainingRaffleSeconds(clientAhead, 103_000), 4);
  assert.deepEqual([0, 1000, 2000, 3000, 4000].map((elapsed) => remainingRaffleSeconds(clientAhead, 102_000 + elapsed)), [5, 4, 3, 2, 1]);

  const lateJoin = withLocalCountdown({ ...payload, countdownRemainingMs: 2_800 }, 120_000);
  assert.equal(remainingRaffleSeconds(lateJoin, 120_000), 3);
});

test("slide-confirm skips UX adjustment autoload for Speaker and Presenter", () => {
  assert.equal(SlideConfirm.shouldLoadRaffleUxAdjustments("/speaker/a_example"), false);
  assert.equal(SlideConfirm.shouldLoadRaffleUxAdjustments("/presenter/a_example"), false);
  assert.equal(SlideConfirm.shouldLoadRaffleUxAdjustments("/stage/a_example"), true);
  assert.equal(SlideConfirm.shouldLoadRaffleUxAdjustments("/audience/a_example"), true);
  assert.equal(SlideConfirm.shouldLoadRaffleUxAdjustments("/screen/a_example"), true);
});

test("Speaker uses native shell mount and explicit raffle host", () => {
  const presenterHtml = readProjectFile("public/presenter/index.html");
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenterHtml, /\/shared\/interactions-shell\.js/);
  assert.match(presenter, /interactionShellMount\.className = "interactions-shell-mount"/);
  assert.match(presenter, /ImmersaInteractionsShell\.create/);
  assert.match(presenter, /raffleController\.mountHost\(\{ role: "presenter", root: raffleRenderer, isActive: \(\) => interactionShell\.getView\(\) === "raffles" \}\)/);
  assert.doesNotMatch(presenter, /raffle-existing-content/);
  assert.doesNotMatch(presenter, /MutationObserver/);
  assert.doesNotMatch(presenter, /stopImmediatePropagation/);
});



test("Speaker uses sibling stable renderers for polls and raffles", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /let pollsRenderer = null;[\s\S]+let raffleRenderer = null;/);
  assert.match(presenter, /pollsRenderer = document\.createElement\("div"\);[\s\S]+pollsRenderer\.className = "interaction-polls-renderer"/);
  assert.match(presenter, /raffleRenderer = document\.createElement\("div"\);[\s\S]+raffleRenderer\.className = "interaction-raffle-renderer"/);
  assert.match(presenter, /interactionShell\.getContentRoot\(\)\.append\(pollsRenderer, raffleRenderer, assessmentRenderer, contestRenderer\)/);
  assert.match(presenter, /raffleController\.mountHost\(\{ role: "presenter", root: raffleRenderer, isActive: \(\) => interactionShell\.getView\(\) === "raffles" \}\)/);
  assert.doesNotMatch(presenter, /root: interactionShell\.getContentRoot\(\)/);
  assert.match(presenter, /pollsRenderer\.hidden = interactionShell\.getView\(\) !== "polls"/);
  assert.match(presenter, /raffleRenderer\.hidden = interactionShell\.getView\(\) !== "raffles"/);
});

test("Speaker returns home only on real interaction close events", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /onRequestClose: closeInteractionPanelRequest/);
  assert.match(presenter, /function setInteractionPanelOpen\(open\) \{[\s\S]+if \(!open\) resetInactiveRaffleDraft\(\);[\s\S]+interactionPanelOpen = Boolean\(open\);/);
  assert.match(presenter, /function toggleInteractionPanel\(\) \{ if \(interactionPanelOpen && hasActiveInteractionShellLock\(\)\) return;/);
  assert.match(presenter, /event\.key === "Escape" && interactionPanelOpen && !hasActiveInteractionShellLock\(\)/);
  assert.match(presenter, /shell\.setCloseVisible\(!locked\)/);
  assert.match(presenter, /shell\.setTitleVisible\?\.\(true\)/);
  assert.match(presenter, /eventName === "raffle:closed"\) returnInteractionsHome\(\)/);
  assert.match(presenter, /socket\.on\("interaction:closed", \(\) => \{[\s\S]+returnInteractionsHome\(\); \}\)/);
  assert.match(presenter, /function activeInteractionView\(\) \{ return activeInteraction \? "polls" : \(raffleController\?\.getState\?\.\(\)\.active \? "raffles" : knowledgeActivityView\(\) \|\| "home"\); \}/);
});



test("poll idle selection starts empty and launch disabled until explicit choice", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /let selectedInteractionId = ""/);
  assert.match(presenter, /function clearSelectedInteraction\(\) \{ selectedInteractionId = ""; \}/);
  assert.match(presenter, /loadInteractions\(\)[\s\S]+clearSelectedInteraction\(\); renderInteractionPanel\(\);/);
  assert.match(presenter, /function selectedInteraction\(\) \{ return selectedInteractionId \? interactions\.find/);
  assert.match(presenter, /const selected = selectedInteraction\(\);[\s\S]+data-interaction-launch ' \+ \(!selected \? 'disabled' : ''\)/);
  assert.doesNotMatch(presenter, /selectDefaultInteraction/);
  assert.doesNotMatch(presenter, /\|\| interactions\[0\]/);
});


test("poll idle renders list when interactions exist without selected poll", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /const hasInteractions = interactions\.length > 0;[\s\S]+const selected = selectedInteraction\(\);/);
  assert.match(presenter, /panel\.innerHTML = '<div class="interaction-panel-heading"><h2>Encuestas disponibles<\/h2><p>Selecciona una encuesta para lanzarla\.<\/p><\/div>' \+ \(hasInteractions \? interactionListMarkup\(false\) : '<p>Este deck aún no tiene interacciones\.<\/p>'\)/);
  assert.match(presenter, /data-interaction-launch ' \+ \(!selected \? 'disabled' : ''\)/);
  assert.match(presenter, /panel\.querySelectorAll\("\[data-interaction-select\]"\)[\s\S]+selectedInteractionId = button\.dataset\.interactionSelect/);
  assert.match(presenter, /socket\.emit\("interaction:launch", \{ interactionId: selected\?\.id \}\)/);
});

test("poll empty state depends on interactions length, not selected fallback", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /function selectedInteraction\(\) \{ return selectedInteractionId \? interactions\.find/);
  assert.doesNotMatch(presenter, /selected \? '<p>Selecciona una encuesta/);
  assert.doesNotMatch(presenter, /\|\| interactions\[0\]/);
  assert.doesNotMatch(presenter, /selectDefaultInteraction/);
});

test("poll selection clears on idle X close and interaction closed", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /function resetInactiveRaffleDraft\(\) \{ if \(hasActiveInteractionShellLock\(\)\) return false; return raffleController\?\.resetLocalSetup\?\.\(\) \|\| false; \}/);
  assert.match(presenter, /function closeInteractionPanelRequest\(\) \{[\s\S]+clearSelectedInteraction\(\);[\s\S]+returnInteractionsHome\(\);/);
  assert.match(presenter, /socket\.on\("interaction:closed", \(\) => \{[\s\S]+clearSelectedInteraction\(\);[\s\S]+returnInteractionsHome\(\); \}\)/);
  assert.match(presenter, /if \(activeInteraction\?\.id\) selectedInteractionId = String\(activeInteraction\.id\)/);
});

test("generic shell section titles are hidden outside general home", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.match(presenter, /shell\.setTitleVisible\?\.\(true\)/);
});

test("poll home copy uses a section title without duplicating the generic shell title", () => {
  const presenter = readProjectFile("public/presenter/presenter.js");
  assert.doesNotMatch(presenter, /<h2>Encuestas<\/h2>/);
  assert.match(presenter, /Encuestas disponibles/);
  assert.match(presenter, /Selecciona una encuesta para lanzarla\./);
  assert.doesNotMatch(presenter, /data-interaction-panel-close/);
});

test("active raffle uses contextual title without countdown suffix", () => {
  const html = renderRaffleController({ ...createInitialRaffleControllerState(), active: { id: "r-title", mode: "visual_key", state: "drawing", revealAt: new Date(Date.now() + 5_000).toISOString() } });
  assert.match(html, /<h2>Sorteo Clave visual<\/h2>/);
  assert.doesNotMatch(html, /<h2>Sorteos<\/h2>/);
  assert.doesNotMatch(html, /s<\/strong>/);
});

test("raffle controller auto-install skips explicit Speaker and Stage hosts", () => {
  const source = readProjectFile("public/shared/raffle-controller.js");
  assert.match(source, /const legacyIntegration = options\.installLegacyIntegration !== false/);
  assert.match(source, /mountHost: \(hostConfig\) =>/);
  assert.match(source, /if \(!legacyIntegration\) return;/);
  assert.match(source, /decorateHost\(root\.document\?\.querySelector\("\.stage-actions-content"\)\)/);
  assert.match(source, /speaker\|presenter\|stage/);
  assert.doesNotMatch(source, /decorateHost\(root\.document\?\.querySelector\("\.interaction-panel"\)\)/);
  assert.match(source, /shouldAutoInstallSocketCapture\(root\.location\?\.pathname \|\| ""\)/);
});

test("Stage loads interactions shell before raffle controller", () => {
  const sources = scriptSources(readProjectFile("public/stage/index.html"));
  const shellIndex = sources.findIndex((source) => source.startsWith("/shared/interactions-shell.js"));
  assert.ok(shellIndex > -1);
  assert.ok(sources.indexOf("/shared/raffle-controller.js") > -1);
  assert.equal(shellIndex < sources.indexOf("/shared/raffle-controller.js"), true);
});

test("Stage uses native interactions shell with persistent sibling hosts", () => {
  const stage = readProjectFile("public/stage/stage.js");
  assert.match(stage, /stageActionsModal\.innerHTML = '[\s\S]+interactions-shell-mount/);
  assert.match(stage, /if \(interactionShell \|\| !window\.ImmersaInteractionsShell \|\| !interactionShellMount\) return interactionShell/);
  assert.match(stage, /ImmersaInteractionsShell\.create/);
  assert.match(stage, /pollsRenderer = document\.createElement\("div"\);[\s\S]+pollsRenderer\.className = "interaction-polls-renderer"/);
  assert.match(stage, /raffleRenderer = document\.createElement\("div"\);[\s\S]+raffleRenderer\.className = "interaction-raffle-renderer"/);
  assert.match(stage, /interactionShell\.getContentRoot\(\)\.append\(pollsRenderer, raffleRenderer, assessmentRenderer, contestRenderer\)/);
  assert.match(stage, /pollsRenderer\.hidden = interactionShell\.getView\(\) !== "polls"/);
  assert.match(stage, /raffleRenderer\.hidden = interactionShell\.getView\(\) !== "raffles"/);
});

test("Stage creates explicit non-legacy raffle controller and mounts role stage", () => {
  const stage = readProjectFile("public/stage/stage.js");
  assert.match(stage, /createController\(socket, \{ installLegacyIntegration: false/);
  assert.match(stage, /raffleController\.mountHost\(\{ role: "stage", root: raffleRenderer, isActive: \(\) => interactionShell\.getView\(\) === "raffles" \}\)/);
  assert.doesNotMatch(stage, /MutationObserver/);
  assert.doesNotMatch(stage, /stopImmediatePropagation/);
  assert.doesNotMatch(stage, /cloneNode/);
});

test("Stage poll idle requires explicit selection and clears it on close", () => {
  const stage = readProjectFile("public/stage/stage.js");
  assert.match(stage, /let selectedInteractionId = ""/);
  assert.match(stage, /function clearSelectedInteraction\(\) \{ selectedInteractionId = ""; \}/);
  assert.match(stage, /loadInteractions\(\)[\s\S]+clearSelectedInteraction\(\);[\s\S]+renderStageActionsPanel\(\);/);
  assert.match(stage, /function selectedInteraction\(\) \{\n  return selectedInteractionId \? interactions\.find/);
  assert.match(stage, /<div class="interaction-panel-heading"><h2 id="stageActionsTitle">Encuestas disponibles<\/h2><p>Selecciona una encuesta para lanzarla\.<\/p><\/div>' \+ \(interactions\.length \? interactionListMarkup\(\)/);
  assert.match(stage, /data-interaction-launch ' \+ \(!selected \? 'disabled' : ''\)/);
  assert.match(stage, /function resetInactiveRaffleDraft\(\) \{ if \(hasActiveInteractionShellLock\(\)\) return false; return raffleController\?\.resetLocalSetup\?\.\(\) \|\| false; \}/);
  assert.match(stage, /function closeStageActionsRequest\(\) \{[\s\S]+clearSelectedInteraction\(\);[\s\S]+resetInactiveRaffleDraft\(\);[\s\S]+returnInteractionsHome\(\);/);
  assert.doesNotMatch(stage, /selectDefaultInteraction/);
  assert.doesNotMatch(stage, /\|\| interactions\[0\]/);
});

test("Stage locks active poll and raffle views against all external closes", () => {
  const stage = readProjectFile("public/stage/stage.js");
  assert.match(stage, /function activeInteractionView\(\) \{ return activeInteraction \? "polls" : \(raffleController\?\.getState\?\.\(\)\.active \? "raffles" : knowledgeActivityView\(\) \|\| "home"\); \}/);
  assert.match(stage, /function hasActiveInteractionShellLock\(\) \{ return Boolean\(activeInteraction \|\| raffleController\?\.getState\?\.\(\)\.active \|\| knowledgeActivityView\(\)\); \}/);
  assert.match(stage, /shell\.setLocked\(locked\)/);
  assert.match(stage, /shell\.setCloseVisible\(!locked\)/);
  assert.match(stage, /if \(locked && !stageActionsOpen\) setStageActionsOpen\(true\)/);
  assert.match(stage, /if \(hasActiveInteractionShellLock\(\)\) return;[\s\S]+clearSelectedInteraction\(\);[\s\S]+returnInteractionsHome\(\);[\s\S]+closeStageActions\(\);/);
  assert.match(stage, /stageActionsButton\?\.addEventListener\("click", \(\) => \{ if \(stageActionsOpen\) closeStageActionsRequest\(\); else openStageActions\(\); \}\)/);
  assert.match(stage, /if \(stageActionsOpen\) closeStageActionsRequest\(\);/);
});

test("Stage close events return the shell home and raffle state uses shared countdown", () => {
  const stage = readProjectFile("public/stage/stage.js");
  const controller = readProjectFile("public/shared/raffle-controller.js");
  assert.match(stage, /eventName === "raffle:closed"\) returnInteractionsHome\(\)/);
  assert.match(stage, /socket\.on\("interaction:closed", \(\) => \{[\s\S]+clearSelectedInteraction\(\);[\s\S]+returnInteractionsHome\(\); \}\)/);
  assert.match(controller, /countdownRemainingMs/);
  assert.match(controller, /remainingRaffleSeconds\(active\)/);
});

test("Stage modal relies on the shell close button and has an accessible dialog name", () => {
  const stage = readProjectFile("public/stage/stage.js");
  const css = readProjectFile("public/stage/stage.css");
  const shell = readProjectFile("public/shared/interactions-shell.js");
  assert.doesNotMatch(stage, /class=\"stage-actions-close\"/);
  assert.doesNotMatch(css, /\.stage-actions-close/);
  assert.match(stage, /role="dialog" aria-modal="true" aria-label="Interacciones"/);
  assert.match(shell, /"interactions-shell-close"/);
  assert.match(shell, /title\.textContent = "Interacciones"/);
  assert.doesNotMatch(shell, /title\.textContent = view === "polls" \? "Encuestas"/);
});

test("Stage hides the generic shell title immediately for idle poll and raffle categories", () => {
  const stage = readProjectFile("public/stage/stage.js");
  assert.match(stage, /onSelectCategory: \(view\) => \{[\s\S]+if \(view === "polls"\) renderStageActionsPanel\(\);[\s\S]+if \(view === "raffles"\) \{ syncRendererVisibility\(\); raffleController\?\.setTab\?\.\("raffles"\); \}[\s\S]+syncInteractionShellState\(\);[\s\S]+\}/);
  assert.match(stage, /shell\.setTitleVisible\?\.\(true\)/);
  assert.match(stage, /function returnInteractionsHome\(\) \{[\s\S]+shell\.setTitleVisible\?\.\(true\);[\s\S]+shell\.setView\("home"\);/);
});

test("slide scrims are scoped to the slide layer in Speaker and Stage", () => {
  const speakerHtml = readProjectFile("public/presenter/index.html");
  const stageHtml = readProjectFile("public/stage/index.html");
  const css = readProjectFile("public/shared/interactions.css");
  assert.doesNotMatch(css, /presenter-shell\.interaction-panel-open::before/);
  assert.equal((speakerHtml.match(/class="interaction-slide-scrim"/g) || []).length, 1);
  assert.match(speakerHtml, /class="stream-area"[\s\S]+<img id="slide" alt="Lámina actual">\s+<div class="interaction-slide-scrim" aria-hidden="true"><\/div>\s+<div id="reactions"/);
  assert.equal((stageHtml.match(/class="interaction-slide-scrim"/g) || []).length, 1);
  assert.match(stageHtml, /<div class="screen-frame">[\s\S]+<img id="slide" alt="Slide en vivo">\s+<div class="interaction-slide-scrim" aria-hidden="true"><\/div>\s+<div id="stageLiveText"/);
  assert.doesNotMatch(stageHtml, /stage-actions-backdrop/);
});

test("shared slide scrim uses canonical values and scoped activation", () => {
  const css = readProjectFile("public/shared/interactions.css");
  const scrim = css.match(/\.interaction-slide-scrim \{[\s\S]+?\n\}/)?.[0] || "";
  assert.match(scrim, /position: absolute;/);
  assert.match(scrim, /inset: 0;/);
  assert.match(scrim, /z-index: 2;/);
  assert.match(scrim, /background: rgba\(2, 4, 8, \.22\);/);
  assert.match(scrim, /backdrop-filter: blur\(4px\);/);
  assert.match(scrim, /-webkit-backdrop-filter: blur\(4px\);/);
  assert.match(scrim, /pointer-events: none;/);
  assert.match(scrim, /opacity: 0;/);
  assert.match(scrim, /visibility: hidden;/);
  assert.doesNotMatch(scrim, /blur\((?:[5-9]|[1-9]\d)px\)|saturate|\n\s*filter:|\.2[3-9]|\.68/);
  assert.match(css, /\.presenter-shell\.interaction-panel-open \.interaction-slide-scrim,\nbody\.stage-actions-open \.interaction-slide-scrim \{\n  opacity: 1;\n  visibility: visible;\n\}/);
});

test("Stage modal no longer renders a fullscreen visual backdrop and syncs body visual state", () => {
  const stage = readProjectFile("public/stage/stage.js");
  const css = readProjectFile("public/stage/stage.css");
  assert.doesNotMatch(stage, /stage-actions-backdrop|data-stage-actions-close/);
  assert.doesNotMatch(css, /stage-actions-backdrop/);
  assert.doesNotMatch(stage, /stageActionsModal\.addEventListener\("click"/);
  assert.match(css, /\.stage-actions-modal \{ pointer-events: none; \}/);
  assert.match(css, /\.stage-actions-card \{[\s\S]+pointer-events: auto;[\s\S]+width: min\(352px, calc\(100vw - 28px\)\);/);
  assert.match(stage, /function syncStageActionsVisualState\(\) \{\n  document\.body\.classList\.toggle\("stage-actions-open", stageActionsOpen\);\n\}/);
  assert.match(stage, /function openStageActions\(\) \{[\s\S]+stageActionsOpen = true;\n  syncStageActionsVisualState\(\);/);
  assert.match(stage, /function closeStageActions\(\) \{[\s\S]+stageActionsOpen = false;\n  syncStageActionsVisualState\(\);/);
  assert.match(stage, /function setStageActionsOpen\(open\) \{[\s\S]+if \(!open\) resetInactiveRaffleDraft\(\);[\s\S]+stageActionsOpen = Boolean\(open\);\n  syncStageActionsVisualState\(\);/);
});

test("slide overlays and controls stay above the scoped interaction scrim", () => {
  const stageCss = readProjectFile("public/stage/stage.css");
  const presenterCss = readProjectFile("public/presenter/presenter.css");
  const sharedCss = readProjectFile("public/shared/interactions.css");
  assert.match(sharedCss, /\.interaction-slide-scrim \{[\s\S]+z-index: 2;/);
  assert.match(stageCss, /\.live-text-overlay \{[\s\S]+z-index: 5;/);
  assert.match(stageCss, /\.stage-qr-overlay \{[\s\S]+z-index: 6;/);
  assert.match(stageCss, /\.main-controls \{[\s\S]+z-index: 7;/);
  assert.match(presenterCss, /\.reaction-layer \{[\s\S]+z-index: 3;/);
  assert.match(presenterCss, /\.main-controls \{[\s\S]+z-index: 7;/);
  assert.match(presenterCss, /\.top-actions \{[\s\S]+z-index: 8;/);
  assert.doesNotMatch(sharedCss, /presenter-shell\.interaction-panel-open::before|\.presenter-shell\s*\{[\s\S]+backdrop-filter|\.stage-shell\s*\{[\s\S]+backdrop-filter|\.stream-area\s*\{[\s\S]+backdrop-filter|\.screen-frame\s*\{[\s\S]+backdrop-filter/);
});

test("Stage production controls remain wired independently of the click-through scrim", () => {
  const stage = readProjectFile("public/stage/stage.js");
  const liveTextControl = readProjectFile("public/shared/live-text-control.js");
  assert.match(stage, /prevSlide\.addEventListener\("click", \(\) => emitStageSlide\(currentSlideIndex - 1\)\)/);
  assert.match(stage, /nextSlide\.addEventListener\("click", \(\) => emitStageSlide\(currentSlideIndex \+ 1\)\)/);
  assert.match(stage, /qrToggle\.addEventListener\("change", \(\) => \{/);
  assert.match(stage, /reactionsToggle\.addEventListener\("change", \(\) => updateOverlay/);
  assert.match(stage, /ImmersaLiveTextControl\?\.create\(\{[\s\S]+button: liveTextButton/);
  assert.match(liveTextControl, /button\.addEventListener\("click", \(\) => \{/);
  assert.match(stage, /stageActionsButton\?\.addEventListener\("click", \(\) => \{ if \(stageActionsOpen\) closeStageActionsRequest\(\); else openStageActions\(\); \}\)/);
  assert.match(stage, /if \(stageActionsOpen\) closeStageActionsRequest\(\);/);
  assert.match(stage, /function closeStageActionsRequest\(\) \{[\s\S]+if \(hasActiveInteractionShellLock\(\)\) return;/);
});
