(function () {
  const modal = document.getElementById("deckDetailModal");
  const actionSource = document.getElementById("detailActions");
  const tabs = Array.from(modal?.querySelectorAll("[data-deck-tab]") || []);
  const panels = Array.from(modal?.querySelectorAll("[data-deck-panel]") || []);
  if (!modal || !actionSource || !tabs.length || !panels.length) return;

  const moduleDetails = {
    interactions: {
      selector: ".role-interactions",
      slot: "interactions",
      title: "Administrar interacciones",
      detail: "Encuestas, sorteos y dinámicas del deck.",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="15" rx="2"></rect><path d="M6 20.5h12M8 15v-4M12 15V8M16 15v-5M8 7h2"></path></svg>'
    },
    brands: {
      selector: ".role-brand-mentions",
      slot: "brands",
      title: "Administrar marcas",
      detail: "Logo, pitch, enlace, estado y orden de aparición.",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13V9l13-5v14L4 13zM8 14l1.5 5H6l-1-6M17 8a4 4 0 0 1 0 6"></path></svg>'
    },
    video: {
      selector: ".role-videos",
      slot: "video",
      title: "Administrar videos",
      detail: "Asigna archivos locales y define su reproducción.",
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m10 9 5 3-5 3V9z"></path></svg>'
    }
  };

  function activateTab(name, focus = false) {
    tabs.forEach((tab) => {
      const selected = tab.dataset.deckTab === name;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => {
      const selected = panel.dataset.deckPanel === name;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    });
  }

  function decorateModuleAction(button, definition) {
    button.classList.add("deck-detail-module-action");
    button.innerHTML = '<span class="deck-detail-module-icon">' + definition.icon + '</span><span class="deck-detail-module-copy"><strong>' + definition.title + '</strong><small>' + definition.detail + '</small></span><span class="deck-detail-module-arrow" aria-hidden="true">›</span>';
  }

  function clearModuleSlots() {
    modal.querySelectorAll("[data-deck-action-slot]").forEach((slot) => slot.replaceChildren());
  }

  function distributeActions() {
    Object.values(moduleDetails).forEach((definition) => {
      const button = actionSource.querySelector(definition.selector);
      const slot = modal.querySelector('[data-deck-action-slot="' + definition.slot + '"]');
      if (!button || !slot) return;
      decorateModuleAction(button, definition);
      slot.appendChild(button);
    });
  }

  function patchDetailActions() {
    const original = window.renderDetailActions;
    if (typeof original !== "function" || original.__deckManagementShellPatched) return;
    window.renderDetailActions = function deckManagementRenderDetailActions(deck) {
      clearModuleSlots();
      original(deck);
      distributeActions();
    };
    window.renderDetailActions.__deckManagementShellPatched = true;
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.deckTab));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = tabs.length - 1;
      activateTab(tabs[nextIndex].dataset.deckTab, true);
    });
  });

  document.addEventListener("immersa:deck-detail-open", () => activateTab("links"));
  patchDetailActions();
  activateTab("links");
})();
