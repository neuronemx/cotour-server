(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaRaffleControls = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function loadSlideConfirm() {
    if (root.ImmersaSlideConfirm) return root.ImmersaSlideConfirm;
    if (typeof require === "function") {
      try { return require("./slide-confirm"); } catch (_error) {}
    }
    return null;
  }

  const sharedSlideConfirm = loadSlideConfirm();
  const TEMP_VISUAL_KEY_OPTIONS = [
    { id: "visual_key_1", label: "Clave A", tone: "cyan" },
    { id: "visual_key_2", label: "Clave B", tone: "violet" },
    { id: "visual_key_3", label: "Clave C", tone: "orange" },
    { id: "visual_key_4", label: "Clave D", tone: "green" }
  ];
  const RAFFLE_MODES = [
    { id: "free", label: "Libre" },
    { id: "poll", label: "Encuesta" },
    { id: "visual_key", label: "Clave visual" }
  ];
  const RAFFLE_EVENTS = new Set(["raffle:create", "raffle:close_entries", "raffle:draw", "raffle:reveal_winner", "raffle:close", "raffle:reset_winners"]);
  const SLIDE_COMPLETE_RATIO = sharedSlideConfirm?.COMPLETE_THRESHOLD || 0.82;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function fallbackSlideMarkup({ label, className = "", disabled = false, dataAttribute = "data-slide-confirm" } = {}) {
    const classes = ["interaction-close-slider", className, disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
    const disabledState = disabled ? ' aria-disabled="true"' : "";
    return '<div class="' + escapeHtml(classes) + '" ' + dataAttribute + ' role="button" aria-label="' + escapeHtml(label) + '" tabindex="0"' + disabledState + ' style="--close-progress:0;--close-x:0px"><span class="interaction-close-slider-track"></span><span class="interaction-close-slider-label">' + escapeHtml(label) + '</span><span class="interaction-close-slider-knob" aria-hidden="true">›</span></div>';
  }

  function fallbackSlideReset(control) {
    if (!control) return;
    control.style?.setProperty?.("--close-progress", "0");
    control.style?.setProperty?.("--close-x", "0px");
    control.classList?.remove?.("is-complete", "is-pending");
    if (control.dataset) delete control.dataset.slideCompleted;
  }

  function fallbackSlideSetPending(control, pending = true) {
    if (!control) return;
    control.classList?.toggle?.("is-pending", Boolean(pending));
    control.classList?.toggle?.("is-disabled", Boolean(pending));
    control.setAttribute?.("aria-disabled", String(Boolean(pending)));
    if (!control.dataset) return;
    if (pending) control.dataset.slideCompleted = "true";
    else delete control.dataset.slideCompleted;
  }

  function fallbackSlideAttach(control, { onComplete, isDisabled = () => false } = {}) {
    if (!control) return null;
    let dragging = false;
    let startX = 0;
    let maxX = 1;
    let progress = 0;
    let completed = false;
    const disabled = () => completed || control.classList.contains("is-disabled") || control.getAttribute("aria-disabled") === "true" || Boolean(isDisabled());
    const update = (clientX) => {
      progress = Math.max(0, Math.min(1, (clientX - startX) / maxX));
      control.style.setProperty("--close-progress", String(progress));
      control.style.setProperty("--close-x", Math.round(progress * maxX) + "px");
      control.classList.toggle("is-complete", progress >= SLIDE_COMPLETE_RATIO);
    };
    const complete = () => {
      if (disabled()) { fallbackSlideReset(control); return false; }
      completed = true;
      fallbackSlideSetPending(control, true);
      onComplete?.(control);
      return true;
    };
    const finish = (event) => {
      if (!dragging) return;
      dragging = false;
      control.releasePointerCapture?.(event?.pointerId);
      if (progress >= SLIDE_COMPLETE_RATIO) complete();
      else fallbackSlideReset(control);
    };
    control.addEventListener("pointerdown", (event) => {
      if (disabled()) return;
      if (event.button !== undefined && event.button !== 0) return;
      const rect = control.getBoundingClientRect();
      const knob = control.querySelector(".interaction-close-slider-knob");
      maxX = Math.max(1, rect.width - (knob?.offsetWidth || 38) - 8);
      startX = event.clientX;
      dragging = true;
      control.setPointerCapture?.(event.pointerId);
      update(event.clientX);
      event.preventDefault?.();
    });
    control.addEventListener("pointermove", (event) => { if (dragging) update(event.clientX); });
    control.addEventListener("pointerup", finish);
    control.addEventListener("pointercancel", (event) => { finish(event); fallbackSlideReset(control); });
    control.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      complete();
    });
    return { reset: () => { completed = false; fallbackSlideReset(control); }, setPending: (pending) => fallbackSlideSetPending(control, pending) };
  }

  const SlideConfirm = sharedSlideConfirm || {
    COMPLETE_THRESHOLD: SLIDE_COMPLETE_RATIO,
    markup: fallbackSlideMarkup,
    attach: fallbackSlideAttach,
    reset: fallbackSlideReset,
    setPending: fallbackSlideSetPending
  };

  function visualKeyOptionIds() { return TEMP_VISUAL_KEY_OPTIONS.map((option) => option.id); }
  function visualKeyDisplayLabel(option) { return String(option?.label || "").replace(/^Clave\s+/i, "") || String(option?.id || "").slice(-1).toUpperCase(); }

  function createRaffleConfig(mode, state = {}) {
    if (mode === "visual_key") return { mode, title: "Sorteo", prompt: "Elige una opción", entryKey: state.visualKeyDraftEntryKey || "", options: TEMP_VISUAL_KEY_OPTIONS.map(({ id, label }) => ({ id, label })) };
    if (mode === "poll") return { mode, title: "Sorteo", prompt: "Elige una opción", options: [{ id: "raffle_poll_1", label: "Opción 1" }, { id: "raffle_poll_2", label: "Opción 2" }] };
    return { mode: "free", title: "Sorteo" };
  }

  function createInitialRaffleControllerState() {
    return { active: null, previousWinnerCount: 0, activeInteraction: null, connectedAudienceCount: 0, visualKeyDraftEntryKey: "", configMode: "", pendingEvent: "", error: "" };
  }
  function withLocalCountdown(active, receivedAtLocalMs = Date.now()) { const remainingMs = Number(active?.countdownRemainingMs); if (!active || active.state !== "drawing" || !Number.isFinite(remainingMs)) return active || null; return { ...active, __countdownRemainingMs: Math.max(0, remainingMs), __countdownReceivedAtLocalMs: receivedAtLocalMs }; }
  function normalizeControllerState(payload) { return { active: withLocalCountdown(payload?.active || null), previousWinnerCount: Number(payload?.previousWinnerCount || 0), visualKeyDraftEntryKey: String(payload?.visualKeyDraftEntryKey || "") }; }
  function activeFromEventPayload(payload) { return withLocalCountdown(payload?.raffle || payload?.active || payload || null); }
  function numericCount(value, fallback = 0) { const count = Number(value); return Number.isFinite(count) ? count : fallback; }
  function errorMessage(reason) {
    const messages = { active_interaction_exists: "Cierra la encuesta activa antes de iniciar un sorteo.", active_raffle_exists: "Ya hay un sorteo activo.", invalid_raffle_mode: "Este modo de sorteo no está disponible.", visual_key_requires_four_options: "Clave visual necesita cuatro opciones.", entry_key_required: "Elige la opción correcta antes de abrir la participación.", entry_key_must_match_option: "La respuesta correcta debe existir entre las cuatro opciones.", poll_options_required: "Encuesta necesita al menos dos opciones.", no_eligible_entries: "No hay participantes elegibles.", no_connected_eligible_entries: "No hay participantes elegibles conectados." };
    return messages[reason] || "No se pudo completar la acción. Intenta de nuevo.";
  }

  function reduceRaffleControllerState(state, eventName, payload = {}) {
    const next = { ...state };
    if (eventName === "state" || eventName === "presentation_state") return { ...next, connectedAudienceCount: numericCount(payload?.audienceCount, next.connectedAudienceCount) };
    if (eventName === "audience_count") return { ...next, connectedAudienceCount: numericCount(payload, next.connectedAudienceCount) };
    if (eventName === "interaction:state") return { ...next, activeInteraction: payload?.active || null };
    if (eventName === "interaction:active") return { ...next, activeInteraction: payload || null };
    if (eventName === "interaction:closed") return { ...next, activeInteraction: null };
    if (eventName === "raffle:rejected") return { ...next, pendingEvent: "", error: errorMessage(payload?.reason || "raffle_rejected") };
    if (eventName === "raffle:closed") return { ...next, active: null, visualKeyDraftEntryKey: "", configMode: "", pendingEvent: "", error: "" };
    if (eventName === "raffle:state" || eventName === "raffle:winners_reset") {
      const normalized = normalizeControllerState(payload);
      const draft = normalized.visualKeyDraftEntryKey;
      return { ...next, active: normalized.active, previousWinnerCount: normalized.previousWinnerCount, visualKeyDraftEntryKey: normalized.active || next.configMode === "visual_key" || draft ? draft : "", configMode: normalized.active ? "" : (draft ? "visual_key" : next.configMode), pendingEvent: "", error: "" };
    }
    if (["raffle:active", "raffle:entries_closed", "raffle:drawing", "raffle:winner"].includes(eventName)) return { ...next, active: activeFromEventPayload(payload), configMode: "", pendingEvent: "", error: "" };
    return next;
  }

  function modeLabel(mode) { return RAFFLE_MODES.find((item) => item.id === mode)?.label || "Sorteo"; }
  function activeModeTitle(mode) { return "Sorteo " + modeLabel(mode); }
  function entryCount(active) { return Number(active?.entryCount ?? active?.entries?.length ?? 0); }
  function eligibleCount(active) { return Number(active?.eligibleCount ?? 0); }
  function winnerLabel(active) { const winner = active?.winner || active?.winners?.[0] || null; const label = winner?.label || winner?.name; return label ? String(label) : "Ganador seleccionado"; }
  function revealTimestamp(active) { const timestamp = Date.parse(active?.revealAt || active?.drawingEndsAt || ""); return Number.isFinite(timestamp) ? timestamp : null; }
  function remainingRaffleSeconds(active, nowMs = Date.now()) { const localRemaining = Number(active?.__countdownRemainingMs); const receivedAt = Number(active?.__countdownReceivedAtLocalMs); if (Number.isFinite(localRemaining)) { const elapsed = Number.isFinite(receivedAt) ? Math.max(0, nowMs - receivedAt) : 0; return Math.max(0, Math.ceil((localRemaining - elapsed) / 1000)); } const serverRemaining = Number(active?.countdownRemainingMs); if (Number.isFinite(serverRemaining)) return Math.max(0, Math.ceil(serverRemaining / 1000)); const timestamp = revealTimestamp(active); if (!Number.isFinite(timestamp)) return null; return Math.max(0, Math.ceil((timestamp - nowMs) / 1000)); }
  function isRaffleNavigationLocked(state) { return Boolean(state?.active); }
  function isExternalCloseTarget(target) { return Boolean(target?.closest?.("[data-interaction-panel-close], [data-stage-actions-close], #interactionToggle")); }
  function blockEvent(event) { event.preventDefault?.(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); }

  function getRaffleActions(state) {
    const active = state?.active;
    if (!active || active.state === "closed") return [];
    if (active.state === "collecting") return [{ event: "raffle:close_entries", label: "Cerrar tómbola", primary: true }, { event: "raffle:close", label: "Cancelar sorteo", danger: true, secondary: true }];
    if (active.state === "entries_closed") return [{ event: "raffle:draw", label: "Desliza para iniciar sorteo", primary: true, slide: true }, { event: "raffle:reset_winners", label: "Restablecer ganadores" }, { event: "raffle:close", label: "Cerrar sorteo" }];
    if (active.state === "drawing") return [];
    if (active.state === "winner") return [{ event: "raffle:close", label: "Cerrar sorto", primary: true }].map((action) => ({ ...action, label: "Cerrar sorteo" }));
    return [];
  }
  function canCreateMode(state, mode) { if (state?.active || state?.activeInteraction || state?.pendingEvent) return false; if (mode === "visual_key") return visualKeyOptionIds().includes(state.visualKeyDraftEntryKey); return true; }
  function canDispatchRaffleAction(state, eventName) { if (!RAFFLE_EVENTS.has(eventName) || state?.pendingEvent) return false; if (eventName === "raffle:create") return !state?.active && !state?.activeInteraction; return getRaffleActions(state).some((action) => action.event === eventName && !action.disabled); }
  function resetSlideConfirm(slider) { SlideConfirm.reset(slider); }
  function createSlideConfirmDispatcher({ getState, emit, setPending, reset = resetSlideConfirm }) {
    let completed = false;
    return function dispatchSlideConfirm(slider) {
      if (completed) return false;
      if (!canDispatchRaffleAction(getState(), "raffle:draw")) { reset(slider); return false; }
      completed = true;
      if (slider?.dataset) slider.dataset.slideCompleted = "true";
      setPending("raffle:draw");
      emit("raffle:draw");
      return true;
    };
  }

  function renderVisualKeyConfig(state, disabled) {
    const selected = state.visualKeyDraftEntryKey || "";
    const options = TEMP_VISUAL_KEY_OPTIONS.map((option) => {
      const active = option.id === selected;
      const activeStyle = active ? ' style="border-width:2px;transform:scale(1.04);box-shadow:0 0 0 3px rgba(104,216,204,.22),0 0 26px rgba(104,216,204,.32),inset 0 1px 0 rgba(255,255,255,.24);"' : "";
      return '<button type="button" class="raffle-key-option ' + (active ? 'is-selected' : '') + '" data-raffle-key-option="' + option.id + '" aria-pressed="' + String(active) + '" data-raffle-key-label="' + escapeHtml(visualKeyDisplayLabel(option)) + '" aria-label="Opción correcta ' + escapeHtml(visualKeyDisplayLabel(option)) + '" ' + (disabled ? 'disabled' : '') + activeStyle + '><span>' + escapeHtml(visualKeyDisplayLabel(option)) + '</span></button>';
    }).join("");
    const createDisabled = disabled || !selected;
    const disabledStyle = createDisabled ? ' style="opacity:.42;filter:grayscale(.4);cursor:not-allowed;box-shadow:none;"' : "";
    return '<div class="raffle-mode-card raffle-visual-key-card"><strong>Clave visual</strong><div class="raffle-key-options" role="group" aria-label="Opción correcta">' + options + '</div><button type="button" class="primary raffle-create-visual ' + (createDisabled ? 'is-disabled' : '') + '" data-raffle-create="visual_key" ' + (createDisabled ? 'disabled' : '') + disabledStyle + '>Abrir participación</button></div>';
  }

  function renderSelection(state) {
    const disabled = Boolean(state.activeInteraction || state.pendingEvent);
    const warning = state.activeInteraction ? '<p class="raffle-warning">Cierra la encuesta activa antes de iniciar un sorteo.</p>' : "";
    if (state.configMode === "visual_key") return '<section class="raffle-section"><div class="raffle-heading"><p>Elige la opción que se mostrará en Screen.</p></div>' + warning + renderVisualKeyConfig(state, disabled) + '</section>';
    const modeButtons = RAFFLE_MODES.map((mode) => {
      const attrs = mode.id === "visual_key" ? 'data-raffle-config-mode="visual_key"' : 'data-raffle-create="' + mode.id + '"';
      return '<button type="button" class="raffle-mode-card" ' + attrs + ' ' + (!canCreateMode(state, mode.id) && mode.id !== "visual_key" ? 'disabled' : '') + '><strong>' + mode.label + '</strong></button>';
    }).join("");
    return '<section class="raffle-section"><div class="raffle-heading"><p>Elige un modo para crear la convocatoria.</p></div>' + warning + '<div class="raffle-mode-grid">' + modeButtons + '</div></section>';
  }
  function renderStats(active, state) { if (active.state === "collecting") return '<div class="raffle-stats"><div><span>CONECTADOS</span><strong>' + numericCount(state.connectedAudienceCount) + '</strong></div></div>'; if (active.state === "entries_closed") { const eligible = eligibleCount(active); const eligibleMarkup = eligible > 0 ? '<div><span>ELEGIBLES</span><strong>' + eligible + '</strong></div>' : ""; return '<div class="raffle-stats"><div><span>PARTICIPANTES</span><strong>' + entryCount(active) + '</strong></div>' + eligibleMarkup + '</div>'; } return ""; }
  function renderSlideConfirm(state) { return SlideConfirm.markup({ label: "Desliza para iniciar sorteo", className: "raffle-slide-confirm is-raffle", disabled: Boolean(state.pendingEvent), dataAttribute: "data-raffle-slide-confirm" }); }
  function renderActionButtons(actions, state, extraClass = "") { return '<div class="raffle-actions ' + extraClass + '">' + actions.map((action) => '<button type="button" class="' + (action.primary ? 'primary ' : '') + (action.danger ? 'danger ' : '') + (action.secondary ? 'secondary ' : '') + 'raffle-action" data-raffle-action="' + action.event + '" ' + (action.disabled || state.pendingEvent ? 'disabled' : '') + '>' + action.label + '</button>').join("") + '</div>'; }
  function renderActions(active, state) { const actions = getRaffleActions(state); if (active.state === "entries_closed") return '<div class="raffle-action-stack">' + renderSlideConfirm(state) + renderActionButtons(actions.filter((action) => action.event !== "raffle:draw"), state, "is-secondary") + '</div>'; return renderActionButtons(actions, state, active.state === "collecting" ? "is-collecting" : ""); }
  function renderActive(active, state) { const statusText = { collecting: "Participación abierta", entries_closed: "Participación cerrada", drawing: "Sorteando...", winner: "Tenemos ganador" }[active.state] || "Sorteo"; const winner = active.state === "winner" ? '<div class="raffle-winner"><span>Ganador</span><strong>' + escapeHtml(winnerLabel(active)) + '</strong></div>' : ""; const remaining = active.state === "drawing" ? remainingRaffleSeconds(active) : null; const countdown = active.state === "drawing" && remaining !== null ? '<div class="raffle-countdown"><span>REVELACIÓN EN</span><strong>' + remaining + '</strong></div>' : ""; return '<section class="raffle-section"><div class="raffle-heading"><h2>' + escapeHtml(activeModeTitle(active.mode)) + '</h2><p>' + escapeHtml(statusText) + '</p></div>' + renderStats(active, state) + winner + countdown + renderActions(active, state) + '</section>'; }
  function renderRaffleController(state) { const error = state.error ? '<p class="raffle-error" role="status">' + escapeHtml(state.error) + '</p>' : ""; return error + (state.active ? renderActive(state.active, state) : renderSelection(state)); }

  function createController(socket, options = {}) {
    let state = createInitialRaffleControllerState();
    let currentTab = "polls";
    let renderQueued = false;
    let countdownTimer = null;
    const legacyIntegration = options.installLegacyIntegration !== false;
    const explicitHosts = [];
    function clearLocalSetup() { state = { ...state, visualKeyDraftEntryKey: "", configMode: "", pendingEvent: "", error: "" }; }
    function setPending(eventName) { state = { ...state, pendingEvent: eventName, error: "" }; scheduleRender(); }
    function update(eventName, payload) { const wasLocked = isRaffleNavigationLocked(state); state = reduceRaffleControllerState(state, eventName, payload); if (eventName === "raffle:closed" && wasLocked) currentTab = "polls"; if (eventName === "raffle:closed") currentTab = "polls"; else if (state.active) currentTab = "raffles"; syncCountdownTimer(); options.onStateChange?.(state, eventName); scheduleRender(); }
    function scheduleRender() { if (renderQueued) return; renderQueued = true; const render = () => { renderQueued = false; renderAllHosts(); }; if (root.requestAnimationFrame) root.requestAnimationFrame(render); else setTimeout(render, 0); }
    function syncCountdownTimer() { const shouldTick = state.active?.state === "drawing" && (Number.isFinite(Number(state.active.__countdownRemainingMs)) || Number.isFinite(Number(state.active.countdownRemainingMs)) || Number.isFinite(revealTimestamp(state.active))); if (shouldTick && !countdownTimer) countdownTimer = (root.setInterval || setInterval)(() => scheduleRender(), 500); if (!shouldTick && countdownTimer) { (root.clearInterval || clearInterval)(countdownTimer); countdownTimer = null; } }
    function installSocketHandlers() { ["state", "presentation_state", "audience_count", "raffle:state", "raffle:active", "raffle:entries_closed", "raffle:drawing", "raffle:winner", "raffle:closed", "raffle:winners_reset", "raffle:rejected", "interaction:state", "interaction:active"].forEach((eventName) => { socket.on(eventName, (payload) => update(eventName, payload)); }); socket.on("interaction:closed", () => update("interaction:closed")); }
    function installNavigationLockGuards() {
      if (!root.document || root.__immersaRaffleNavigationGuard) return;
      root.document.addEventListener("keydown", (event) => { if (event.key === "Escape" && isRaffleNavigationLocked(state)) blockEvent(event); }, true);
      root.document.addEventListener("click", (event) => { if (isRaffleNavigationLocked(state) && isExternalCloseTarget(event.target)) blockEvent(event); }, true);
      root.__immersaRaffleNavigationGuard = true;
    }
    function ensureShell(host) {
      if (!host || host.querySelector(".raffle-tab-shell")) return;
      const existing = root.document.createElement("div");
      existing.className = "raffle-existing-content";
      while (host.firstChild) existing.appendChild(host.firstChild);
      const shell = root.document.createElement("div");
      shell.className = "raffle-tab-shell";
      shell.innerHTML = '<div class="raffle-tabs" role="tablist" aria-label="Acciones"><button type="button" data-raffle-tab="polls">Encuestas</button><button type="button" data-raffle-tab="raffles">Sorteos</button></div><div class="raffle-panel" data-raffle-panel></div>';
      host.appendChild(shell);
      host.appendChild(existing);
      shell.querySelectorAll("[data-raffle-tab]").forEach((button) => button.addEventListener("click", () => { if (state.active && button.dataset.raffleTab !== "raffles") return; if (button.dataset.raffleTab !== "raffles") clearLocalSetup(); currentTab = button.dataset.raffleTab || "polls"; renderAllHosts(); }));
    }
    function decorateHost(host) {
      if (!host) return;
      ensureShell(host);
      const inRaffleSubview = currentTab === "raffles";
      host.classList.toggle("is-raffle-subview", inRaffleSubview);
      const tabs = host.querySelector(".raffle-tabs");
      const rafflePanel = host.querySelector("[data-raffle-panel]");
      const existing = host.querySelector(".raffle-existing-content");
      if (tabs) { tabs.hidden = inRaffleSubview; tabs.classList.toggle("is-hidden", inRaffleSubview); tabs.style.display = inRaffleSubview ? "none" : ""; }
      host.querySelectorAll("[data-raffle-tab]").forEach((button) => { const active = button.dataset.raffleTab === currentTab; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
      if (existing) existing.hidden = inRaffleSubview;
      if (!rafflePanel) return;
      rafflePanel.hidden = !inRaffleSubview;
      if (!inRaffleSubview) return;
      let nextHtml = "";
      const backMarkup = isRaffleNavigationLocked(state) ? "" : '<button type="button" class="raffle-back-button" data-raffle-back>← Volver</button>';
      try { nextHtml = (state.active ? "" : backMarkup) + renderRaffleController(state); }
      catch (error) { console.error?.("Immersa raffle controller render failed", error); nextHtml = (state.active ? "" : backMarkup) + renderSelection({ ...state, active: null, pendingEvent: "" }); }
      if (rafflePanel.dataset.raffleHtml === nextHtml) return;
      rafflePanel.dataset.raffleHtml = nextHtml;
      rafflePanel.innerHTML = nextHtml;
      bindRafflePanel(rafflePanel);
    }
    function bindRafflePanel(panel) {
      panel.querySelector("[data-raffle-back]")?.addEventListener("click", () => { if (state.active) return; clearLocalSetup(); currentTab = "polls"; renderAllHosts(); });
      panel.querySelectorAll("[data-raffle-config-mode]").forEach((button) => button.addEventListener("click", () => { if (state.active || state.pendingEvent) return; state = { ...state, configMode: button.dataset.raffleConfigMode || "", visualKeyDraftEntryKey: "", error: "" }; renderAllHosts(); }));
      panel.querySelectorAll("[data-raffle-key-option]").forEach((button) => button.addEventListener("click", () => { if (state.active || state.pendingEvent) return; socket.emit("raffle:configure_visual_key", { entryKey: button.dataset.raffleKeyOption }); }));
      panel.querySelectorAll("[data-raffle-create]").forEach((button) => button.addEventListener("click", () => { const mode = button.dataset.raffleCreate; if (!canDispatchRaffleAction(state, "raffle:create") || !canCreateMode(state, mode)) return; setPending("raffle:create"); socket.emit("raffle:create", createRaffleConfig(mode, state)); }));
      panel.querySelectorAll("[data-raffle-action]").forEach((button) => button.addEventListener("click", () => { const eventName = button.dataset.raffleAction; if (!canDispatchRaffleAction(state, eventName)) return; setPending(eventName); socket.emit(eventName); }));
      const dispatchSlideConfirm = createSlideConfirmDispatcher({ getState: () => state, emit: (eventName) => socket.emit(eventName), setPending });
      panel.querySelectorAll("[data-raffle-slide-confirm]").forEach((slider) => SlideConfirm.attach(slider, { isDisabled: () => !canDispatchRaffleAction(state, "raffle:draw"), onComplete: () => dispatchSlideConfirm(slider) }));
    }
    function decorateExplicitHost(hostConfig) {
      const host = hostConfig?.root;
      if (!host) return;
      const active = hostConfig.isActive ? Boolean(hostConfig.isActive()) : true;
      host.hidden = !active;
      if (!active) return;
      let nextHtml = "";
      try { nextHtml = renderRaffleController(state); }
      catch (error) { console.error?.("Immersa raffle controller render failed", error); nextHtml = renderSelection({ ...state, active: null, pendingEvent: "" }); }
      if (host.dataset.raffleHtml === nextHtml) return;
      host.dataset.raffleHtml = nextHtml;
      host.innerHTML = nextHtml;
      bindRafflePanel(host);
    }
    function renderAllHosts() {
      explicitHosts.forEach(decorateExplicitHost);
      if (!legacyIntegration) return;
      decorateHost(root.document?.querySelector(".stage-actions-content"));
    }
    function observeHosts() { if (!root.document || !root.MutationObserver) return; const observer = new root.MutationObserver(() => scheduleRender()); observer.observe(root.document.body, { childList: true, subtree: true }); }
    installSocketHandlers(); if (legacyIntegration) { installNavigationLockGuards(); observeHosts(); } scheduleRender(); return { getState: () => state, isNavigationLocked: () => isRaffleNavigationLocked(state), mountHost: (hostConfig) => { if (!hostConfig?.root) return null; explicitHosts.push(hostConfig); scheduleRender(); return { unmount: () => { const index = explicitHosts.indexOf(hostConfig); if (index >= 0) explicitHosts.splice(index, 1); } }; }, setTab: (tab) => { if (tab !== "raffles" && state.active) return false; if (tab !== "raffles") clearLocalSetup(); currentTab = tab; renderAllHosts(); return true; } };
  }

  function shouldAutoInstallSocketCapture(pathname) { return !/^\/(?:speaker|presenter|stage)(?:\/|$)/.test(String(pathname || "")); }

  function installSocketCapture() {
    if (!root || !root.io || root.__immersaRaffleIoWrapped) return null;
    const originalIo = root.io;
    root.io = function (...args) { const socket = originalIo.apply(this, args); if (!root.ImmersaRaffleSocket) { root.ImmersaRaffleSocket = socket; root.ImmersaRaffleController = createController(socket); } return socket; };
    Object.assign(root.io, originalIo);
    root.__immersaRaffleIoWrapped = true;
    return root.io;
  }

  if (root?.document && root?.io && shouldAutoInstallSocketCapture(root.location?.pathname || "")) installSocketCapture();
  return { TEMP_VISUAL_KEY_OPTIONS, RAFFLE_MODES, RAFFLE_EVENTS, SLIDE_COMPLETE_RATIO, createRaffleConfig, createInitialRaffleControllerState, withLocalCountdown, normalizeControllerState, reduceRaffleControllerState, getRaffleActions, canDispatchRaffleAction, canCreateMode, createSlideConfirmDispatcher, resetSlideConfirm, renderRaffleController, errorMessage, winnerLabel, remainingRaffleSeconds, isRaffleNavigationLocked, installSocketCapture, shouldAutoInstallSocketCapture, createController };
});
