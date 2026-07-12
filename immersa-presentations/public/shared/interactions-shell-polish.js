(function (root) {
  "use strict";

  if (!root.document || root.__immersaInteractionShellStable) return;
  root.__immersaInteractionShellStable = true;

  const document = root.document;
  const hostState = new WeakMap();
  let syncQueued = false;

  const positionStyle = document.createElement("style");
  positionStyle.setAttribute("data-immersa-interaction-position-fix", "");
  positionStyle.textContent = [
    ".interaction-panel { position: fixed !important; }",
    ".stage-actions-card { position: relative !important; }",
    ".interaction-option.is-selected, .interaction-option.is-selected:hover, [data-interaction-select].is-selected, [data-interaction-select].is-selected:hover { border-color: transparent !important; background: linear-gradient(#151827, #151827) padding-box, linear-gradient(135deg, #7f77dd 0%, #378add 55%, #5dcaa5 100%) border-box !important; box-shadow: 0 0 0 1px rgba(93,202,165,.18), 0 8px 22px rgba(55,138,221,.15) !important; }"
  ].join("\n");
  document.head.appendChild(positionStyle);

  if (!document.querySelector('link[href="/shared/interactions-home-recovery.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/shared/interactions-home-recovery.css";
    document.head.appendChild(link);
  }

  function controllerState() {
    try {
      return root.ImmersaRaffleController?.getState?.() || {};
    } catch (_error) {
      return {};
    }
  }

  function activeCategory(state) {
    if (state.active) return "raffles";
    if (state.activeInteraction) return "polls";
    return "";
  }

  function visibleCategory(host) {
    if (host.classList.contains("is-raffle-subview")) return "raffles";
    const existing = host.querySelector(".raffle-existing-content");
    if (existing && !existing.hidden) return "polls";
    return "";
  }

  function isPresenterInteractionPanelOpen() {
    return Boolean(document.querySelector(".presenter-shell.interaction-panel-open"));
  }

  function isStageActionsOpen() {
    return Boolean(document.querySelector(".stage-actions-modal.is-open"));
  }

  function isLockedCloseAttempt(target) {
    if (target?.closest?.("#interactionToggle")) return isPresenterInteractionPanelOpen();
    if (target?.closest?.("#stageActionsButton")) return isStageActionsOpen();
    return Boolean(target?.closest?.("[data-interaction-panel-close], [data-stage-actions-close], [data-close-modal]"));
  }

  function clearDefaultPollSelection(host) {
    host.querySelectorAll("[data-interaction-select]").forEach((button) => {
      button.classList.remove("is-selected");
      button.setAttribute("aria-selected", "false");
      button.setAttribute("aria-pressed", "false");
    });
    const launch = host.querySelector("[data-interaction-launch]");
    if (launch) launch.disabled = true;
  }

  function syncHost(host, state) {
    if (!host) return;

    const lockedCategory = activeCategory(state);
    const category = lockedCategory || visibleCategory(host);
    const previous = hostState.get(host) || { category: "" };

    host.dataset.interactionCategory = category;
    host.classList.toggle("is-interaction-locked", Boolean(lockedCategory));
    host.classList.toggle("is-raffle-subview", category === "raffles");
    host.classList.toggle("is-interaction-home", !category);

    const stageCard = host.closest(".stage-actions-card");
    if (stageCard) stageCard.classList.toggle("is-interaction-locked", Boolean(lockedCategory));

    host.querySelectorAll("[data-interaction-category]").forEach((button) => {
      const tab = button.dataset.interactionCategory || "";
      const active = tab === category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("aria-disabled", lockedCategory ? "true" : "false");
      button.classList.toggle("is-menu-locked", Boolean(lockedCategory));
    });

    if (category === "polls" && previous.category !== "polls" && !state.activeInteraction) {
      clearDefaultPollSelection(host);
    }

    host.querySelectorAll(".interaction-home-back, .raffle-back-button, [data-interaction-home-back], [data-raffle-back]").forEach((node) => node.remove());

    hostState.set(host, { category });
  }

  function syncAll() {
    syncQueued = false;
    const state = controllerState();
    syncHost(document.querySelector(".interaction-panel"), state);
    syncHost(document.querySelector(".stage-actions-content"), state);
  }

  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    (root.requestAnimationFrame || root.setTimeout)(syncAll, 0);
  }

  function blockLockedNavigation(event) {
    const state = controllerState();
    const lockedCategory = activeCategory(state);
    if (!lockedCategory) return;

    if (event.type === "keydown" && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      return;
    }

    const target = event.target;
    const categoryButton = target?.closest?.("[data-interaction-category]");
    const closeTarget = isLockedCloseAttempt(target);

    if (categoryButton || closeTarget) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }
  }

  function showPollSelectionImmediately(event) {
    const button = event.target?.closest?.("[data-interaction-select]");
    if (!button || button.disabled || controllerState().activeInteraction) return;
    const host = button.closest(".raffle-existing-content") || button.parentElement;
    host?.querySelectorAll?.("[data-interaction-select]").forEach((option) => {
      const selected = option === button;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
      option.setAttribute("aria-pressed", String(selected));
    });
    const launch = host?.querySelector?.("[data-interaction-launch]");
    if (launch) launch.disabled = false;
  }

  function forwardCriticalRaffleAction(event) {
    const button = event.target?.closest?.('[data-raffle-action="raffle:close_entries"], [data-raffle-action="raffle:close"]');
    if (!button || button.disabled) return;
    const socket = root.ImmersaRaffleSocket;
    if (!socket?.emit) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();

    button.disabled = true;
    socket.emit(button.dataset.raffleAction);
  }

  document.addEventListener("pointerdown", showPollSelectionImmediately, true);
  document.addEventListener("click", forwardCriticalRaffleAction, true);
  document.addEventListener("click", blockLockedNavigation, true);
  document.addEventListener("keydown", blockLockedNavigation, true);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "class", "aria-hidden"]
  });

  root.setInterval?.(scheduleSync, 300);
  scheduleSync();
})(typeof window !== "undefined" ? window : globalThis);
