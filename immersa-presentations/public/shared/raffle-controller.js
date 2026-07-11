(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaRaffleControls = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const SlideConfirm = root.ImmersaSlideConfirm || (typeof require === "function" ? require("./slide-confirm") : null);
  const TEMP_VISUAL_KEY_OPTIONS = [
    { id: "visual_key_1", label: "Clave A", tone: "cyan", correct: true },
    { id: "visual_key_2", label: "Clave B", tone: "violet", correct: false },
    { id: "visual_key_3", label: "Clave C", tone: "orange", correct: false },
    { id: "visual_key_4", label: "Clave D", tone: "green", correct: false }
  ];
  const RAFFLE_MODES = [
    { id: "visual_key", label: "Clave visual", description: "Usa una dinámica visual preparada" },
    { id: "poll", label: "Encuesta" },
    { id: "free", label: "Libre" }
  ];
  const RAFFLE_EVENTS = new Set(["raffle:create", "raffle:close_entries", "raffle:draw", "raffle:reveal_winner", "raffle:close", "raffle:reset_winners"]);
  const SLIDE_COMPLETE_RATIO = SlideConfirm?.COMPLETE_THRESHOLD || 0.82;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function createRaffleConfig(mode) {
    if (mode === "visual_key") {
      return {
        mode,
        title: "Sorteo",
        prompt: "Elige la clave visual correcta",
        entryKey: TEMP_VISUAL_KEY_OPTIONS.find((option) => option.correct).id,
        options: TEMP_VISUAL_KEY_OPTIONS.map(({ id, label }) => ({ id, label }))
      };
    }
    if (mode === "poll") {
      return {
        mode,
        title: "Sorteo",
        prompt: "Elige una opción",
        options: [
          { id: "raffle_poll_1", label: "Opción 1" },
          { id: "raffle_poll_2", label: "Opción 2" }
        ]
      };
    }
    return { mode: "free", title: "Sorteo" };
  }

  function createInitialRaffleControllerState() {
    return { active: null, previousWinnerCount: 0, activeInteraction: null, connectedAudienceCount: 0, pendingEvent: "", error: "" };
  }

  function normalizeControllerState(payload) {
    return { active: payload?.active || null, previousWinnerCount: Number(payload?.previousWinnerCount || 0) };
  }

  function activeFromEventPayload(payload) {
    return payload?.raffle || payload?.active || payload || null;
  }

  function numericCount(value, fallback = 0) {
    const count = Number(value);
    return Number.isFinite(count) ? count : fallback;
  }

  function errorMessage(reason) {
    const messages = {
      active_interaction_exists: "Cierra la encuesta activa antes de iniciar un sorteo.",
      active_raffle_exists: "Ya hay un sorteo activo.",
      invalid_raffle_mode: "Este modo de sorteo no está disponible.",
      visual_key_requires_four_options: "Clave visual necesita cuatro opciones.",
      entry_key_required: "Clave visual necesita una respuesta correcta.",
      entry_key_must_match_option: "La respuesta correcta debe existir entre las cuatro opciones.",
      poll_options_required: "Encuesta necesita al menos dos opciones.",
      no_eligible_entries: "No hay participantes elegibles.",
      no_connected_eligible_entries: "No hay participantes elegibles conectados."
    };
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
    if (eventName === "raffle:closed") return { ...next, active: null, pendingEvent: "", error: "" };
    if (eventName === "raffle:state" || eventName === "raffle:winners_reset") {
      const normalized = normalizeControllerState(payload);
      return { ...next, active: normalized.active, previousWinnerCount: normalized.previousWinnerCount, pendingEvent: "", error: "" };
    }
    if (["raffle:active", "raffle:entries_closed", "raffle:drawing", "raffle:winner"].includes(eventName)) {
      return { ...next, active: activeFromEventPayload(payload), pendingEvent: "", error: "" };
    }
    return next;
  }

  function modeLabel(mode) {
    return RAFFLE_MODES.find((item) => item.id === mode)?.label || "Sorteo";
  }

  function entryCount(active) {
    return Number(active?.entryCount ?? active?.entries?.length ?? 0);
  }

  function eligibleCount(active) {
    return Number(active?.eligibleCount ?? 0);
  }

  function winnerLabel(active) {
    const winner = active?.winner || active?.winners?.[0] || null;
    const label = winner?.label || winner?.name;
    return label ? String(label) : "Ganador seleccionado";
  }

  function revealTimestamp(active) {
    const timestamp = Date.parse(active?.revealAt || active?.drawingEndsAt || "");
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function remainingRaffleSeconds(active, nowMs = Date.now()) {
    const timestamp = revealTimestamp(active);
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.ceil((timestamp - nowMs) / 1000));
  }

  function getRaffleActions(state) {
    const active = state?.active;
    if (!active || active.state === "closed") return [];
    if (active.state === "collecting") return [
      { event: "raffle:close_entries", label: "Cerrar tómbola", primary: true },
      { event: "raffle:close", label: "Cancelar sorteo", danger: true, secondary: true }
    ];
    if (active.state === "entries_closed") return [
      { event: "raffle:draw", label: "Desliza para iniciar sorteo", primary: true, slide: true },
      { event: "raffle:reset_winners", label: "Restablecer ganadores" },
      { event: "raffle:close", label: "Cerrar sorteo" }
    ];
    if (active.state === "drawing") return [];
    if (active.state === "winner") return [
      { event: "raffle:close", label: "Cerrar sorteo", primary: true }
    ];
    return [];
  }

  function canDispatchRaffleAction(state, eventName) {
    if (!RAFFLE_EVENTS.has(eventName) || state?.pendingEvent) return false;
    if (eventName === "raffle:create") return !state?.active && !state?.activeInteraction;
    return getRaffleActions(state).some((action) => action.event === eventName && !action.disabled);
  }

  function resetSlideConfirm(slider) {
    SlideConfirm?.reset(slider);
  }

  function createSlideConfirmDispatcher({ getState, emit, setPending, reset = resetSlideConfirm }) {
    let completed = false;
    return function dispatchSlideConfirm(slider) {
      if (completed) return false;
      if (!canDispatchRaffleAction(getState(), "raffle:draw")) {
        reset(slider);
        return false;
      }
      completed = true;
      if (slider) slider.dataset.slideCompleted = "true";
      setPending("raffle:draw");
      emit("raffle:draw");
      return true;
    };
  }

  function renderVisualKeyPreview() {
    return '<div class="raffle-visual-preview" aria-label="Vista previa de claves visuales temporales">' + TEMP_VISUAL_KEY_OPTIONS.map((option) => '<span class="raffle-visual-card is-' + option.tone + '" aria-hidden="true">' + escapeHtml(option.label.replace("Clave ", "")) + '</span>').join("") + '</div>';
  }

  function renderSelection(state) {
    const disabled = Boolean(state.activeInteraction || state.pendingEvent);
    const warning = state.activeInteraction ? '<p class="raffle-warning">Cierra la encuesta activa antes de iniciar un sorteo.</p>' : "";
    const buttons = RAFFLE_MODES.map((mode) => '<button type="button" class="raffle-mode-card" data-raffle-create="' + mode.id + '" ' + (disabled ? 'disabled' : '') + '><strong>' + mode.label + '</strong>' + (mode.description ? '<span class="raffle-mode-description">' + escapeHtml(mode.description) + '</span>' : "") + (mode.id === "visual_key" ? renderVisualKeyPreview() : "") + '</button>').join("");
    return '<section class="raffle-section"><div class="raffle-heading"><span>Sorteos</span><h2>Sorteo</h2><p>Elige un modo para crear la convocatoria.</p></div>' + warning + '<div class="raffle-mode-grid">' + buttons + '</div></section>';
  }

  function renderStats(active, state) {
    if (active.state === "collecting") {
      return '<div class="raffle-stats"><div><span>CONECTADOS</span><strong>' + numericCount(state.connectedAudienceCount) + '</strong></div><div><span>BOLETOS</span><strong>' + entryCount(active) + '</strong></div></div>';
    }
    return '<div class="raffle-stats"><div><span>PARTICIPANTES</span><strong>' + entryCount(active) + '</strong></div><div><span>ELEGIBLES</span><strong>' + eligibleCount(active) + '</strong></div></div>';
  }

  function renderSlideConfirm(state) {
    return SlideConfirm.markup({
      label: "Desliza para iniciar sorteo",
      className: "raffle-slide-confirm is-raffle",
      disabled: Boolean(state.pendingEvent),
      dataAttribute: "data-raffle-slide-confirm"
    });
  }

  function renderActionButtons(actions, state, extraClass = "") {
    return '<div class="raffle-actions ' + extraClass + '">' + actions.map((action) => '<button type="button" class="' + (action.primary ? 'primary ' : '') + (action.danger ? 'danger ' : '') + (action.secondary ? 'secondary ' : '') + 'raffle-action" data-raffle-action="' + action.event + '" ' + (action.disabled || state.pendingEvent ? 'disabled' : '') + '>' + action.label + '</button>').join("") + '</div>';
  }

  function renderActions(active, state) {
    const actions = getRaffleActions(state);
    if (active.state === "entries_closed") {
      return '<div class="raffle-action-stack">' + renderSlideConfirm(state) + renderActionButtons(actions.filter((action) => action.event !== "raffle:draw"), state, "is-secondary") + '</div>';
    }
    return renderActionButtons(actions, state, active.state === "collecting" ? "is-collecting" : "");
  }

  function renderActive(active, state) {
    const statusText = { collecting: "Participación abierta", entries_closed: "Participación cerrada", drawing: "Sorteando...", winner: "Tenemos ganador" }[active.state] || "Sorteo";
    const winner = active.state === "winner" ? '<div class="raffle-winner"><span>Ganador</span><strong>' + escapeHtml(winnerLabel(active)) + '</strong></div>' : "";
    const remaining = active.state === "drawing" ? remainingRaffleSeconds(active) : null;
    const countdown = active.state === "drawing" && remaining !== null ? '<div class="raffle-countdown"><span>REVELACIÓN EN</span><strong>' + remaining + 's</strong></div>' : "";
    return '<section class="raffle-section"><div class="raffle-heading"><span>' + escapeHtml(modeLabel(active.mode)) + '</span><h2>' + escapeHtml(statusText) + '</h2></div>' + renderStats(active, state) + winner + countdown + renderActions(active, state) + '</section>';
  }

  function renderRaffleController(state) {
    const error = state.error ? '<p class="raffle-error" role="status">' + escapeHtml(state.error) + '</p>' : "";
    return error + (state.active ? renderActive(state.active, state) : renderSelection(state));
  }

  function createController(socket) {
    let state = createInitialRaffleControllerState();
    let currentTab = "polls";
    let renderQueued = false;
    let countdownTimer = null;

    function setPending(eventName) {
      state = { ...state, pendingEvent: eventName, error: "" };
      scheduleRender();
    }

    function update(eventName, payload) {
      state = reduceRaffleControllerState(state, eventName, payload);
      syncCountdownTimer();
      scheduleRender();
    }

    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      const render = () => { renderQueued = false; renderAllHosts(); };
      if (root.requestAnimationFrame) root.requestAnimationFrame(render);
      else setTimeout(render, 0);
    }

    function syncCountdownTimer() {
      const shouldTick = state.active?.state === "drawing" && Number.isFinite(revealTimestamp(state.active));
      if (shouldTick && !countdownTimer) {
        countdownTimer = (root.setInterval || setInterval)(() => scheduleRender(), 500);
      }
      if (!shouldTick && countdownTimer) {
        (root.clearInterval || clearInterval)(countdownTimer);
        countdownTimer = null;
      }
    }

    function installSocketHandlers() {
      ["state", "presentation_state", "audience_count", "raffle:state", "raffle:active", "raffle:entries_closed", "raffle:drawing", "raffle:winner", "raffle:closed", "raffle:winners_reset", "raffle:rejected", "interaction:state", "interaction:active"].forEach((eventName) => {
        socket.on(eventName, (payload) => update(eventName, payload));
      });
      socket.on("interaction:closed", () => update("interaction:closed"));
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
      shell.querySelectorAll("[data-raffle-tab]").forEach((button) => button.addEventListener("click", () => { currentTab = button.dataset.raffleTab || "polls"; renderAllHosts(); }));
    }

    function decorateHost(host) {
      if (!host) return;
      ensureShell(host);
      const rafflePanel = host.querySelector("[data-raffle-panel]");
      const existing = host.querySelector(".raffle-existing-content");
      host.querySelectorAll("[data-raffle-tab]").forEach((button) => {
        const active = button.dataset.raffleTab === currentTab;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      if (existing) existing.hidden = currentTab === "raffles";
      if (!rafflePanel) return;
      rafflePanel.hidden = currentTab !== "raffles";
      if (currentTab !== "raffles") return;
      const nextHtml = renderRaffleController(state);
      if (rafflePanel.dataset.raffleHtml === nextHtml) return;
      rafflePanel.dataset.raffleHtml = nextHtml;
      rafflePanel.innerHTML = nextHtml;
      bindRafflePanel(rafflePanel);
    }

    function bindRafflePanel(panel) {
      panel.querySelectorAll("[data-raffle-create]").forEach((button) => button.addEventListener("click", () => {
        if (!canDispatchRaffleAction(state, "raffle:create")) return;
        setPending("raffle:create");
        socket.emit("raffle:create", createRaffleConfig(button.dataset.raffleCreate));
      }));
      panel.querySelectorAll("[data-raffle-action]").forEach((button) => button.addEventListener("click", () => {
        const eventName = button.dataset.raffleAction;
        if (!canDispatchRaffleAction(state, eventName)) return;
        setPending(eventName);
        socket.emit(eventName);
      }));
      const dispatchSlideConfirm = createSlideConfirmDispatcher({ getState: () => state, emit: (eventName) => socket.emit(eventName), setPending });
      panel.querySelectorAll("[data-raffle-slide-confirm]").forEach((slider) => SlideConfirm.attach(slider, {
        isDisabled: () => !canDispatchRaffleAction(state, "raffle:draw"),
        onComplete: () => dispatchSlideConfirm(slider)
      }));
    }

    function renderAllHosts() {
      decorateHost(root.document?.querySelector(".interaction-panel"));
      decorateHost(root.document?.querySelector(".stage-actions-content"));
    }

    function observeHosts() {
      if (!root.document || !root.MutationObserver) return;
      const observer = new root.MutationObserver(() => scheduleRender());
      observer.observe(root.document.body, { childList: true, subtree: true });
    }

    installSocketHandlers();
    observeHosts();
    scheduleRender();
    return { getState: () => state, setTab: (tab) => { currentTab = tab; renderAllHosts(); } };
  }

  function installSocketCapture() {
    if (!root || !root.io || root.__immersaRaffleIoWrapped) return null;
    const originalIo = root.io;
    root.io = function (...args) {
      const socket = originalIo.apply(this, args);
      if (!root.ImmersaRaffleSocket) {
        root.ImmersaRaffleSocket = socket;
        root.ImmersaRaffleController = createController(socket);
      }
      return socket;
    };
    Object.assign(root.io, originalIo);
    root.__immersaRaffleIoWrapped = true;
    return root.io;
  }

  if (root?.document && root?.io) installSocketCapture();

  return {
    TEMP_VISUAL_KEY_OPTIONS,
    RAFFLE_MODES,
    RAFFLE_EVENTS,
    SLIDE_COMPLETE_RATIO,
    createRaffleConfig,
    createInitialRaffleControllerState,
    normalizeControllerState,
    reduceRaffleControllerState,
    getRaffleActions,
    canDispatchRaffleAction,
    createSlideConfirmDispatcher,
    resetSlideConfirm,
    renderRaffleController,
    errorMessage,
    winnerLabel,
    remainingRaffleSeconds,
    installSocketCapture
  };
});
