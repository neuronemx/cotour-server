(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaRaffleControls = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const TEMP_VISUAL_KEY_OPTIONS = [
    { id: "visual_key_1", label: "Clave A", tone: "cyan", correct: true },
    { id: "visual_key_2", label: "Clave B", tone: "violet", correct: false },
    { id: "visual_key_3", label: "Clave C", tone: "orange", correct: false },
    { id: "visual_key_4", label: "Clave D", tone: "green", correct: false }
  ];
  const RAFFLE_MODES = [
    { id: "visual_key", label: "Clave visual" },
    { id: "poll", label: "Encuesta" },
    { id: "free", label: "Libre" }
  ];
  const RAFFLE_EVENTS = new Set([
    "raffle:create",
    "raffle:close_entries",
    "raffle:draw",
    "raffle:reveal_winner",
    "raffle:close",
    "raffle:reset_winners"
  ]);

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
    return {
      active: null,
      previousWinnerCount: 0,
      activeInteraction: null,
      pendingEvent: "",
      error: ""
    };
  }

  function normalizeControllerState(payload) {
    return {
      active: payload?.active || null,
      previousWinnerCount: Number(payload?.previousWinnerCount || 0)
    };
  }

  function activeFromEventPayload(payload) {
    return payload?.raffle || payload?.active || payload || null;
  }

  function reduceRaffleControllerState(state, eventName, payload = {}) {
    const next = { ...state };
    if (eventName === "interaction:state") {
      next.activeInteraction = payload?.active || null;
      return next;
    }
    if (eventName === "interaction:active") {
      next.activeInteraction = payload || null;
      return next;
    }
    if (eventName === "interaction:closed") {
      next.activeInteraction = null;
      return next;
    }
    if (eventName === "raffle:state" || eventName === "raffle:winners_reset") {
      const normalized = normalizeControllerState(payload);
      next.active = normalized.active;
      next.previousWinnerCount = normalized.previousWinnerCount;
      next.pendingEvent = "";
      next.error = "";
      return next;
    }
    if (eventName === "raffle:closed") {
      next.active = null;
      next.pendingEvent = "";
      next.error = "";
      return next;
    }
    if (eventName === "raffle:rejected") {
      next.pendingEvent = "";
      next.error = errorMessage(payload?.reason || "raffle_rejected");
      return next;
    }
    if (eventName === "raffle:active" || eventName === "raffle:entries_closed" || eventName === "raffle:drawing" || eventName === "raffle:winner") {
      next.active = activeFromEventPayload(payload);
      next.pendingEvent = "";
      next.error = "";
      return next;
    }
    return next;
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

  function getRaffleActions(state) {
    const active = state?.active;
    if (!active || active.state === "closed") return [];
    if (active.state === "collecting") {
      return [
        { event: "raffle:close_entries", label: "Cerrar participación", primary: true },
        { event: "raffle:close", label: "Cancelar sorteo", danger: true }
      ];
    }
    if (active.state === "entries_closed") {
      return [
        { event: "raffle:draw", label: "Iniciar sorteo", primary: true },
        { event: "raffle:close", label: "Cerrar sorteo" }
      ];
    }
    if (active.state === "drawing") {
      return [
        { event: "raffle:reveal_winner", label: "Mostrar ganador", primary: true, disabled: !active.pendingWinnerSelected }
      ];
    }
    if (active.state === "winner") {
      return [
        { event: "raffle:close", label: "Cerrar sorteo", primary: true },
        { event: "raffle:reset_winners", label: "Restablecer ganadores" }
      ];
    }
    return [];
  }

  function canDispatchRaffleAction(state, eventName) {
    if (!RAFFLE_EVENTS.has(eventName)) return false;
    if (state?.pendingEvent) return false;
    if (eventName === "raffle:create") return !state?.active && !state?.activeInteraction;
    return getRaffleActions(state).some((action) => action.event === eventName && !action.disabled);
  }

  function renderVisualKeyPreview() {
    return '<div class="raffle-visual-preview" aria-label="Tarjetas visuales temporales">' + TEMP_VISUAL_KEY_OPTIONS.map((option) => '<span class="raffle-visual-card is-' + option.tone + '">' + escapeHtml(option.label) + '</span>').join("") + '</div>';
  }

  function renderSelection(state) {
    const disabled = Boolean(state.activeInteraction || state.pendingEvent);
    const reason = state.activeInteraction ? '<p class="raffle-warning">Cierra la encuesta activa antes de iniciar un sorteo.</p>' : "";
    const buttons = RAFFLE_MODES.map((mode) => {
      const extra = mode.id === "visual_key" ? renderVisualKeyPreview() : "";
      return '<button type="button" class="raffle-mode-card" data-raffle-create="' + mode.id + '" ' + (disabled ? 'disabled' : '') + '><strong>' + mode.label + '</strong>' + extra + '</button>';
    }).join("");
    return '<section class="raffle-section"><div class="raffle-heading"><span>Sorteos</span><h2>Sorteo</h2><p>Elige un modo para crear la convocatoria.</p></div>' + reason + '<div class="raffle-mode-grid">' + buttons + '</div></section>';
  }

  function renderActive(active, state) {
    const statusText = {
      collecting: "Participación abierta",
      entries_closed: "Participación cerrada",
      drawing: "Sorteando...",
      winner: "Tenemos ganador"
    }[active.state] || "Sorteo";
    const winner = active.state === "winner" ? '<div class="raffle-winner"><span>Ganador</span><strong>' + escapeHtml(winnerLabel(active)) + '</strong></div>' : "";
    const actions = getRaffleActions(state).map((action) => '<button type="button" class="' + (action.primary ? 'primary ' : '') + (action.danger ? 'danger ' : '') + 'raffle-action" data-raffle-action="' + action.event + '" ' + (action.disabled || state.pendingEvent ? 'disabled' : '') + '>' + action.label + '</button>').join("");
    const drawingNote = active.state === "drawing" && !active.pendingWinnerSelected ? '<p class="raffle-warning">Esperando selección de ganador...</p>' : "";
    return '<section class="raffle-section"><div class="raffle-heading"><span>' + escapeHtml(modeLabel(active.mode)) + '</span><h2>' + escapeHtml(statusText) + '</h2></div><div class="raffle-stats"><div><span>Participantes</span><strong>' + entryCount(active) + '</strong></div><div><span>Elegibles</span><strong>' + eligibleCount(active) + '</strong></div></div>' + winner + drawingNote + '<div class="raffle-actions">' + actions + '</div></section>';
  }

  function renderRaffleController(state) {
    const error = state.error ? '<p class="raffle-error" role="status">' + escapeHtml(state.error) + '</p>' : "";
    const body = state.active ? renderActive(state.active, state) : renderSelection(state);
    return error + body;
  }

  function createController(socket) {
    let state = createInitialRaffleControllerState();
    let currentTab = "polls";
    let renderQueued = false;

    function update(eventName, payload) {
      state = reduceRaffleControllerState(state, eventName, payload);
      scheduleRender();
    }

    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      root.requestAnimationFrame?.(() => { renderQueued = false; renderAllHosts(); }) || setTimeout(() => { renderQueued = false; renderAllHosts(); }, 0);
    }

    function installSocketHandlers() {
      socket.on("raffle:state", (payload) => update("raffle:state", payload));
      socket.on("raffle:active", (payload) => update("raffle:active", payload));
      socket.on("raffle:entries_closed", (payload) => update("raffle:entries_closed", payload));
      socket.on("raffle:drawing", (payload) => update("raffle:drawing", payload));
      socket.on("raffle:winner", (payload) => update("raffle:winner", payload));
      socket.on("raffle:closed", (payload) => update("raffle:closed", payload));
      socket.on("raffle:winners_reset", (payload) => update("raffle:winners_reset", payload));
      socket.on("raffle:rejected", (payload) => update("raffle:rejected", payload));
      socket.on("interaction:state", (payload) => update("interaction:state", payload));
      socket.on("interaction:active", (payload) => update("interaction:active", payload));
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
      if (rafflePanel) {
        rafflePanel.hidden = currentTab !== "raffles";
        if (currentTab === "raffles") {
          rafflePanel.innerHTML = renderRaffleController(state);
          bindRafflePanel(rafflePanel);
        }
      }
    }

    function bindRafflePanel(panel) {
      panel.querySelectorAll("[data-raffle-create]").forEach((button) => button.addEventListener("click", () => {
        if (!canDispatchRaffleAction(state, "raffle:create")) return;
        state = { ...state, pendingEvent: "raffle:create", error: "" };
        socket.emit("raffle:create", createRaffleConfig(button.dataset.raffleCreate));
        scheduleRender();
      }));
      panel.querySelectorAll("[data-raffle-action]").forEach((button) => button.addEventListener("click", () => {
        const eventName = button.dataset.raffleAction;
        if (!canDispatchRaffleAction(state, eventName)) return;
        state = { ...state, pendingEvent: eventName, error: "" };
        socket.emit(eventName);
        scheduleRender();
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
    createRaffleConfig,
    createInitialRaffleControllerState,
    normalizeControllerState,
    reduceRaffleControllerState,
    getRaffleActions,
    canDispatchRaffleAction,
    renderRaffleController,
    errorMessage,
    winnerLabel,
    installSocketCapture
  };
});
