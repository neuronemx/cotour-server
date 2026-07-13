(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaRafflePublicUI = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function modeLabel(mode) {
    if (mode === "visual_key") return "Clave visual";
    if (mode === "poll") return "Encuesta";
    if (mode === "free") return "Sorteo abierto";
    return "Sorteo";
  }

  function visualOptionLabel(option) {
    return String(option?.label || option?.id || "").replace(/^Clave\s+/i, "").slice(0, 1).toUpperCase();
  }

  function revealTimestamp(active) {
    const timestamp = Date.parse(active?.revealAt || active?.drawingEndsAt || "");
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function withLocalCountdown(active, receivedAtLocalMs = Date.now()) {
    const remainingMs = Number(active?.countdownRemainingMs);
    if (!active || active.state !== "drawing" || !Number.isFinite(remainingMs)) return active || null;
    return { ...active, __countdownRemainingMs: Math.max(0, remainingMs), __countdownReceivedAtLocalMs: receivedAtLocalMs };
  }

  function remainingSeconds(active, nowMs = Date.now()) {
    const localRemaining = Number(active?.__countdownRemainingMs);
    const receivedAt = Number(active?.__countdownReceivedAtLocalMs);
    if (Number.isFinite(localRemaining)) {
      const elapsed = Number.isFinite(receivedAt) ? Math.max(0, nowMs - receivedAt) : 0;
      return Math.max(0, Math.ceil((localRemaining - elapsed) / 1000));
    }
    const serverRemaining = Number(active?.countdownRemainingMs);
    if (Number.isFinite(serverRemaining)) return Math.max(0, Math.ceil(serverRemaining / 1000));
    const timestamp = revealTimestamp(active);
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.ceil((timestamp - nowMs) / 1000));
  }

  function normalizeRaffleState(stateOrActive) {
    const active = stateOrActive?.active || stateOrActive || null;
    return active && active.state !== "closed" ? active : null;
  }

  function safeOptions(active) {
    return Array.isArray(active?.options) ? active.options.filter((option) => option && option.id && option.label) : [];
  }

  function selectedOptionId(active) {
    return active?.ownSelection?.selectedOptionId || active?.ownEntry?.selectedOptionId || "";
  }

  function screenDisplayOption(active) {
    if (active?.displayOption) return active.displayOption;
    if (!active?.displayOptionId) return null;
    return safeOptions(active).find((option) => option.id === active.displayOptionId) || { id: active.displayOptionId, label: active.displayOptionId };
  }

  function renderOption(option, disabled, selected = false) {
    const asset = option.thumbnail || option.thumb || option.image || option.asset || "";
    const visual = asset
      ? '<span class="raffle-public-option-media"><img src="' + escapeHtml(asset) + '" alt=""></span>'
      : '<span class="raffle-public-option-fallback">' + escapeHtml(option.label).slice(0, 1).toUpperCase() + '</span>';
    return '<button type="button" class="raffle-public-option ' + (selected ? 'is-selected' : '') + '" data-raffle-option="' + escapeHtml(option.id) + '" aria-pressed="' + String(Boolean(selected)) + '" ' + (disabled ? 'disabled' : '') + '>' + visual + '<strong>' + escapeHtml(option.label) + '</strong></button>';
  }

  function renderAudienceCollecting(active) {
    const hasEntry = Boolean(active.ownEntry);
    if (active.mode === "free") {
      return '<h2>Ya estás participando</h2><p>Tu boleto está dentro de la tómbola</p>';
    }
    if (hasEntry) return '<h2>Boleto activo</h2><p>Tu participación quedó registrada.</p>';
    const options = safeOptions(active);
    if (active.mode === "visual_key") {
      const selected = selectedOptionId(active);
      return '<h2>Elige una opción</h2><p>El presentador te dirá la correcta</p><div class="raffle-public-options">' + options.map((option) => renderOption(option, false, option.id === selected)).join("") + '</div>';
    }
    const copy = "Elige una opción para activar tu boleto.";
    return '<h2>' + escapeHtml(modeLabel(active.mode)) + '</h2><p>' + escapeHtml(active.prompt || copy) + '</p><div class="raffle-public-options">' + options.map((option) => renderOption(option, false, option.id === selectedOptionId(active))).join("") + '</div>';
  }

  function renderAudienceEntriesClosed(active) {
    if (active.ownEntry) return '<h2>Boleto activo</h2><p>La tómbola está cerrada. Mantente atento.</p>';
    if (active.mode === "visual_key" && active.ownSelection) return '<h2>Gracias por participar :)</h2>';
    return '<h2>La tómbola ya está cerrada :(</h2><p>Mantente atento a próximos sorteos</p>';
  }

  function renderAudienceDrawing(active, nowMs) {
    const remaining = remainingSeconds(active, nowMs);
    const countdown = remaining === null ? "" : '<div class="raffle-public-countdown"><span>Revelación en</span><strong>' + remaining + '</strong></div>';
    return '<h2>Sorteando...</h2>' + countdown;
  }

  function renderAudienceWinner(active) {
    if (active.isWinner) return '<div class="raffle-public-winner-private"><h2>¡GANASTE!</h2><p>Levanta tu teléfono</p></div>';
    return '<h2>Gracias por participar :)</h2>';
  }

  function renderAudienceRaffle(stateOrActive, privateWinner = false, nowMs = Date.now()) {
    const active = normalizeRaffleState(stateOrActive);
    if (!active) return "";
    const withWinner = privateWinner ? { ...active, isWinner: true } : active;
    const body = withWinner.state === "collecting" ? renderAudienceCollecting(withWinner)
      : withWinner.state === "entries_closed" ? renderAudienceEntriesClosed(withWinner)
      : withWinner.state === "drawing" ? renderAudienceDrawing(withWinner, nowMs)
      : withWinner.state === "winner" ? renderAudienceWinner(withWinner)
      : "";
    if (!body) return "";
    return '<section class="raffle-public-overlay raffle-public-audience is-' + escapeHtml(withWinner.state) + ' is-' + escapeHtml(withWinner.mode) + '" role="dialog" aria-live="polite" aria-label="Sorteo"><div class="raffle-public-card">' + body + '</div></section>';
  }

  function renderScreenCollecting(active) {
    if (active.mode === "free") return '<h2>Sorteo abierto</h2><p>Mantén abierta tu pantalla</p>';
    if (active.mode === "visual_key") {
      const option = screenDisplayOption(active);
      const label = visualOptionLabel(option);
      const display = label ? '<div class="raffle-screen-display-option" aria-label="Opción ' + escapeHtml(label) + '"><strong>' + escapeHtml(label) + '</strong></div>' : "";
      return '<h2>Elige en tu pantalla:</h2>' + display;
    }
    return '<h2>Participa desde tu pantalla</h2>';
  }

  function renderScreenDrawing(active, nowMs) {
    const remaining = remainingSeconds(active, nowMs);
    const number = remaining === null ? "" : '<strong>' + remaining + '</strong>';
    return '<div class="raffle-screen-motion" aria-hidden="true"><span></span><span></span><span></span></div><h2>Sorteando...</h2><div class="raffle-screen-countdown">' + number + '</div>';
  }

  function renderScreenWinner() {
    return '<h2>¡TENEMOS GANADOR!</h2>';
  }

  function renderScreenRaffle(stateOrActive, nowMs = Date.now()) {
    const active = normalizeRaffleState(stateOrActive);
    if (!active) return "";
    const body = active.state === "collecting" ? renderScreenCollecting(active)
      : active.state === "entries_closed" ? '<h2>Tómbola cerrada</h2>'
      : active.state === "drawing" ? renderScreenDrawing(active, nowMs)
      : active.state === "winner" ? renderScreenWinner(active)
      : "";
    if (!body) return "";
    return '<section class="raffle-public-overlay raffle-screen-overlay is-' + escapeHtml(active.state) + ' is-' + escapeHtml(active.mode) + '" role="status" aria-live="polite"><div class="raffle-screen-card">' + body + '</div></section>';
  }

  function installRuntime() {
    if (!root || !root.io || root.__immersaRafflePublicWrapped) return null;
    const originalIo = root.io;
    root.io = function (...args) {
      const socket = originalIo.apply(this, args);
      if (!root.__immersaRafflePublicInstalled) {
        root.__immersaRafflePublicInstalled = true;
        attachRuntime(socket);
      }
      return socket;
    };
    Object.assign(root.io, originalIo);
    root.__immersaRafflePublicWrapped = true;
    return root.io;
  }

  function runtimeRole() {
    if (root.document?.getElementById("viewer")) return "audience";
    if (root.document?.getElementById("screen")) return "screen";
    return "";
  }

  function attachRuntime(socket) {
    const role = runtimeRole();
    if (role !== "audience" && role !== "screen") return;
    const host = role === "audience" ? root.document.getElementById("viewer") : root.document.getElementById("screen");
    if (!host) return;
    let active = null;
    let privateWinner = false;
    let timer = null;
    let pendingEntry = false;
    let rendered = "";

    function clearTimer() {
      if (timer) (root.clearInterval || clearInterval)(timer);
      timer = null;
    }

    function syncTimer() {
      clearTimer();
      if (active?.state === "drawing" && (Number.isFinite(Number(active.__countdownRemainingMs)) || Number.isFinite(Number(active.countdownRemainingMs)) || Number.isFinite(revealTimestamp(active)))) timer = (root.setInterval || setInterval)(render, 500);
    }

    function ensureOverlay() {
      let overlay = host.querySelector("[data-raffle-public-root]");
      if (!overlay) {
        overlay = root.document.createElement("div");
        overlay.dataset.rafflePublicRoot = "true";
        host.appendChild(overlay);
      }
      return overlay;
    }

    function clearOverlay() {
      clearTimer();
      privateWinner = false;
      pendingEntry = false;
      active = null;
      rendered = "";
      host.querySelector("[data-raffle-public-root]")?.remove();
    }

    function render() {
      const html = role === "audience" ? renderAudienceRaffle(active, privateWinner) : renderScreenRaffle(active);
      if (!html) return clearOverlay();
      const overlay = ensureOverlay();
      if (rendered === html) return;
      rendered = html;
      overlay.innerHTML = html;
      bindOverlay(overlay);
    }

    function applyState(payload) {
      active = withLocalCountdown(normalizeRaffleState(payload));
      if (!active) return clearOverlay();
      if (active.state !== "winner") privateWinner = false;
      if (active.ownEntry || active.ownSelection) pendingEntry = false;
      syncTimer();
      render();
    }

    function submitOption(optionId) {
      if (!active || pendingEntry || active.state !== "collecting") return;
      if (active.mode !== "visual_key" && active.ownEntry) return;
      if (active.mode === "visual_key" && selectedOptionId(active) === optionId) return;
      pendingEntry = true;
      if (active.mode === "visual_key") socket.emit("raffle:enter", { optionId });
      if (active.mode === "poll") socket.emit("raffle:submit_poll_response", { optionId });
    }

    function bindOverlay(overlay) {
      if (role !== "audience") return;
      overlay.querySelectorAll("[data-raffle-option]").forEach((button) => {
        button.addEventListener("click", () => submitOption(button.dataset.raffleOption));
      });
    }

    socket.on("raffle:state", applyState);
    socket.on("raffle:active", (payload) => applyState(payload?.raffle || payload));
    socket.on("raffle:entries_closed", (payload) => applyState(payload?.raffle || payload));
    socket.on("raffle:drawing", (payload) => applyState(payload?.raffle || payload));
    socket.on("raffle:winner", (payload = {}) => {
      if (role === "audience" && payload.isWinner) privateWinner = true;
      applyState(payload?.raffle || { ...active, state: "winner", isWinner: role === "audience" && Boolean(payload.isWinner) });
    });
    socket.on("raffle:entry_accepted", (payload = {}) => applyState({ ...active, ownEntry: payload.entry || active?.ownEntry || {} }));
    socket.on("raffle:poll_response_accepted", (payload = {}) => applyState({ ...active, ownEntry: payload.entry || active?.ownEntry || {} }));
    socket.on("raffle:rejected", () => {
      pendingEntry = false;
      render();
    });
    socket.on("raffle:closed", clearOverlay);
  }

  if (root?.document && root?.io) installRuntime();
  return { renderAudienceRaffle, renderScreenRaffle, withLocalCountdown, remainingSeconds, normalizeRaffleState };
});
