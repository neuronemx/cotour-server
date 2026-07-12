(function (root) {
  "use strict";

  const TAB_DEFS = [
    {
      id: "polls",
      label: "Encuestas",
      enabled: true,
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18M8 17V9m4 8V5m4 12v-6"></path></svg>'
    },
    {
      id: "raffles",
      label: "Sorteos",
      enabled: true,
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18v13H3zM3 8l2-4h14l2 4M12 4v17M3 8h18"></path></svg>'
    },
    {
      id: "contests",
      label: "Concursos",
      enabled: false,
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a2 2 0 0 0 2 2M17 6h3a2 2 0 0 1-2 2"></path></svg>'
    },
    {
      id: "games",
      label: "Juegos",
      enabled: false,
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM14 6.5h5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM6.8 13h2.4M15.8 13h2.4"></path></svg>'
    }
  ];

  const HARD_CLOSE_TARGETS = "[data-interaction-panel-close], [data-stage-actions-close], [data-close-modal]";
  let syncQueued = false;
  let pollSelectionArmed = false;
  let previousLocked = false;

  function controller() {
    return root.ImmersaRaffleController || null;
  }

  function controllerState() {
    try { return controller()?.getState?.() || {}; }
    catch (_error) { return {}; }
  }

  function isLocked() {
    const state = controllerState();
    return Boolean(state.active || state.activeInteraction);
  }

  function inferSelected(host, state) {
    if (state.active) return "raffles";
    if (state.activeInteraction) return "polls";
    const rafflePanel = host.querySelector("[data-raffle-panel]");
    const existing = host.querySelector(".raffle-existing-content");
    if (rafflePanel && !rafflePanel.hidden) return "raffles";
    if (existing && !existing.hidden) return "polls";
    return "";
  }

  function tabsMarkup() {
    return TAB_DEFS.map((tab) => {
      const disabled = tab.enabled ? "" : ' disabled aria-disabled="true"';
      return '<button type="button" class="interaction-top-tab" data-interaction-top-tab="' + tab.id + '" role="tab" aria-selected="false"' + disabled + '>' + tab.icon + '<span>' + tab.label + '</span></button>';
    }).join("");
  }

  function ensureHeader(host) {
    if (!host || host.querySelector("[data-interaction-persistent-header]")) return;
    const header = root.document.createElement("section");
    header.className = "interaction-persistent-header";
    header.setAttribute("data-interaction-persistent-header", "");
    header.innerHTML = '<h2>Interacciones</h2><div class="interaction-top-tabs" role="tablist" aria-label="Tipos de interacción">' + tabsMarkup() + '</div>';
    const shell = host.querySelector(".raffle-tab-shell");
    if (shell) host.insertBefore(header, shell);
    else host.prepend(header);

    header.querySelectorAll("[data-interaction-top-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        if (isLocked() || button.disabled) return;
        const tab = button.dataset.interactionTopTab;
        if (tab !== "polls" && tab !== "raffles") return;
        if (tab === "polls") pollSelectionArmed = false;
        controller()?.setTab?.(tab);
        scheduleSync();
      });
    });
  }

  function normalizePollSelection(host, selected, locked) {
    if (selected !== "polls" || locked) return;
    const existing = host.querySelector(".raffle-existing-content");
    if (!existing) return;

    if (!pollSelectionArmed) {
      existing.querySelectorAll("[data-interaction-select]").forEach((button) => {
        button.classList.remove("is-selected");
        button.setAttribute("aria-selected", "false");
      });
      const launch = existing.querySelector("[data-interaction-launch]");
      if (launch) launch.disabled = true;
    }
  }

  function syncHost(host) {
    if (!host) return;
    ensureHeader(host);
    const state = controllerState();
    const locked = Boolean(state.active || state.activeInteraction);
    const selected = inferSelected(host, state);

    host.classList.toggle("is-interaction-locked", locked);
    host.classList.toggle("has-interaction-category", Boolean(selected));
    host.dataset.interactionCategory = selected;

    host.querySelectorAll("[data-interaction-top-tab]").forEach((button) => {
      const active = button.dataset.interactionTopTab === selected;
      const unavailable = button.getAttribute("aria-disabled") === "true";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.disabled = unavailable || locked;
    });

    const homePanel = host.querySelector("[data-interaction-home]");
    if (homePanel && !selected) {
      const prompt = '<div class="interaction-empty-state">Selecciona una interacción.</div>';
      if (homePanel.innerHTML !== prompt) homePanel.innerHTML = prompt;
      homePanel.hidden = false;
    }

    host.querySelectorAll(".interaction-home-back, .raffle-back-button, [data-interaction-home-back], [data-raffle-back]").forEach((node) => node.remove());
    normalizePollSelection(host, selected, locked);

    const card = host.closest(".stage-actions-card");
    if (card) card.classList.toggle("is-interaction-locked", locked);
  }

  function syncAll() {
    syncQueued = false;
    const locked = isLocked();
    if (previousLocked && !locked) pollSelectionArmed = false;
    previousLocked = locked;
    syncHost(root.document?.querySelector(".interaction-panel"));
    syncHost(root.document?.querySelector(".stage-actions-content"));
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    (root.requestAnimationFrame || root.setTimeout)(syncAll, 0);
  }

  function captureInteractionSelection(event) {
    const button = event.target?.closest?.("[data-interaction-select]");
    if (!button || isLocked()) return;
    pollSelectionArmed = true;
  }

  function presenterPanelOpen() {
    return Boolean(root.document?.querySelector(".presenter-shell.interaction-panel-open"));
  }

  function stagePanelOpen() {
    return Boolean(root.document?.querySelector(".stage-actions-modal.is-open"));
  }

  function isClosingControl(target) {
    if (!target?.closest) return false;
    if (target.closest(HARD_CLOSE_TARGETS)) return true;
    if (target.closest("#interactionToggle")) return presenterPanelOpen();
    if (target.closest("#stageActionsButton")) return stagePanelOpen();
    return false;
  }

  function blockIfLocked(event) {
    if (!isLocked()) return;
    if (event.type === "keydown" && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      return;
    }
    if (isClosingControl(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }
  }

  function install() {
    if (!root.document || root.__immersaInteractionShellPolish) return;
    root.__immersaInteractionShellPolish = true;
    root.document.addEventListener("pointerdown", captureInteractionSelection, true);
    root.document.addEventListener("keydown", blockIfLocked, true);
    root.document.addEventListener("click", blockIfLocked, true);
    const observer = new MutationObserver(scheduleSync);
    observer.observe(root.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "aria-hidden"] });
    root.setInterval?.(scheduleSync, 350);
    scheduleSync();
  }

  if (root.document) install();
})(typeof window !== "undefined" ? window : globalThis);
