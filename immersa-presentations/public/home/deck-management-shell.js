(function () {
  const modal = document.getElementById("deckDetailModal");
  const actionSource = document.getElementById("detailActions");
  const launchers = document.getElementById("deckEditorLaunchers");
  const shell = modal?.querySelector(".deck-detail-modal");
  const tabs = Array.from(modal?.querySelectorAll("[data-deck-tab]") || []);
  const panels = Array.from(modal?.querySelectorAll("[data-deck-panel]") || []);
  const sections = Array.from(modal?.querySelectorAll("[data-deck-section]") || []);
  const content = modal?.querySelector(".deck-detail-content");
  const previewToggle = document.getElementById("deckPreviewToggle");
  const fileMenu = document.getElementById("deckFileMenu");
  const participationTab = tabs.find((tab) => tab.dataset.deckTab === "participation");
  const brandsTab = tabs.find((tab) => tab.dataset.deckTab === "brands");
  if (!modal || !shell || !actionSource || !launchers || !tabs.length || !panels.length) return;

  function setPreviewExpanded(expanded) {
    previewToggle.setAttribute("aria-expanded", String(expanded));
  }

  previewToggle.addEventListener("click", () => {
    setPreviewExpanded(previewToggle.getAttribute("aria-expanded") !== "true");
  });

  fileMenu.addEventListener("click", (event) => {
    if (event.target.closest(".deck-file-action")) fileMenu.open = false;
  });

  document.addEventListener("click", (event) => {
    if (fileMenu.open && !fileMenu.contains(event.target)) fileMenu.open = false;
  });

  fileMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !fileMenu.open) return;
    event.preventDefault();
    fileMenu.open = false;
    fileMenu.querySelector("summary").focus();
  });

  const moduleDetails = {
    participation: {
      selector: ".role-interactions",
      backdrop: ".interactions-backdrop",
      editor: ".interactions-modal",
      close: ".interactions-close"
    },
    brands: {
      selector: ".role-brand-mentions",
      backdrop: ".brand-mentions-backdrop",
      editor: ".brand-mentions-modal",
      close: ".brand-mentions-close"
    },
    video: {
      selector: ".role-videos",
      backdrop: ".video-editor-backdrop",
      editor: ".video-editor-modal",
      close: ".video-editor-close"
    }
  };

  function activateTab(name, focus = false) {
    const targetTab = tabs.find((tab) => tab.dataset.deckTab === name);
    if (!targetTab || targetTab.disabled || targetTab.hidden) return;
    const section = targetTab.closest("[data-deck-section]")
      || sections.find((item) => item.dataset.deckSection === name);
    if (!section) return;
    const group = section.dataset.deckSection;
    const choices = Array.from(section.querySelectorAll("[data-deck-tab]"))
      .filter((tab) => !tab.disabled && !tab.hidden);
    const selectedTab = choices.includes(targetTab) ? targetTab
      : choices.find((tab) => tab.getAttribute("aria-selected") === "true") || choices[0] || targetTab;
    const activePanel = selectedTab.dataset.deckTab;

    if (modal.dataset.activeDeckTab !== activePanel) content.scrollTop = 0;
    modal.dataset.activeDeckTab = activePanel;
    shell.classList.toggle("has-audiovisual-library", activePanel === "audiovisual");
    sections.forEach((item) => { item.hidden = item !== section; });
    tabs.forEach((tab) => {
      const isMainTab = !tab.closest("[data-deck-section]");
      if (!isMainTab && !section.contains(tab)) return;
      const selected = isMainTab ? tab.dataset.deckTab === group : tab === selectedTab;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => {
      const selected = panel.dataset.deckPanel === activePanel;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    });
    if (focus) targetTab.focus();
    if (activePanel === "audiovisual") {
      document.dispatchEvent(new CustomEvent("immersa:audiovisual-library-visible"));
    }
    if (moduleDetails[activePanel]) mountEditor(activePanel);
    document.dispatchEvent(new CustomEvent("immersa:deck-panel-visible", {detail:{panel:activePanel}}));
  }

  function syncDemoMasterTabs(deck) {
    if (!participationTab) return;
    const demoMasterEnabled = deck?.demoRole === "master" && !deck?.missing;
    const planEnabled = participationTab.dataset.planEnabled === "true";
    const enabled = planEnabled || demoMasterEnabled;
    participationTab.disabled = !enabled;
    participationTab.setAttribute("aria-disabled", String(!enabled));
    participationTab.title = demoMasterEnabled
      ? "Crear o editar interacciones del Deck Demo Maestro"
      : planEnabled
        ? "Crear o editar interacciones"
        : "Disponible en otros planes";
  }

  function restoreEditor(definition) {
    const editor = document.querySelector(definition.editor);
    const backdrop = document.querySelector(definition.backdrop);
    if (!editor || !backdrop || editor.parentElement === backdrop) return;
    editor.classList.remove("is-deck-inline");
    editor.setAttribute("role", "dialog");
    editor.setAttribute("aria-modal", "true");
    const close = editor.querySelector(definition.close);
    if (close) close.hidden = false;
    backdrop.appendChild(editor);
  }

  function restoreEditors() {
    Object.values(moduleDetails).forEach(restoreEditor);
    modal.querySelectorAll("[data-deck-editor-host]").forEach((host) => host.replaceChildren());
  }

  function distributeActions() {
    Object.values(moduleDetails).forEach((definition) => {
      const button = actionSource.querySelector(definition.selector);
      if (button) launchers.appendChild(button);
    });
  }

  function mountEditor(name) {
    const definition = moduleDetails[name];
    const host = modal.querySelector('[data-deck-editor-host="' + name + '"]');
    if (!definition || !host || host.querySelector(definition.editor)) return;
    const launcher = launchers.querySelector(definition.selector);
    if (!launcher) return;
    restoreEditor(definition);
    launcher.click();
    const backdrop = document.querySelector(definition.backdrop);
    const editor = backdrop?.querySelector(definition.editor);
    if (!backdrop || !editor) return;
    backdrop.hidden = true;
    backdrop.setAttribute("aria-hidden", "true");
    editor.classList.add("is-deck-inline");
    editor.setAttribute("role", "region");
    editor.removeAttribute("aria-modal");
    const close = editor.querySelector(definition.close);
    if (close) close.hidden = true;
    host.replaceChildren(editor);
  }

  function patchDetailActions() {
    const original = window.renderDetailActions;
    if (typeof original !== "function" || original.__deckManagementShellPatched) return;
    window.renderDetailActions = function deckManagementRenderDetailActions(deck) {
      restoreEditors();
      launchers.replaceChildren();
      original(deck);
      distributeActions();
      if (brandsTab) {
        const available = Boolean(actionSource.querySelector(".role-audience") && launchers.querySelector(moduleDetails.brands.selector));
        brandsTab.disabled = !available;
        brandsTab.setAttribute("aria-disabled", String(!available));
      }
    };
    window.renderDetailActions.__deckManagementShellPatched = true;
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!tab.disabled) activateTab(tab.dataset.deckTab);
    });
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tablist = tab.closest('[role="tablist"]');
      const availableTabs = tabs.filter((item) => tablist.contains(item) && !item.disabled && !item.hidden);
      const availableIndex = Math.max(0, availableTabs.indexOf(tab));
      let nextIndex = availableIndex;
      if (event.key === "ArrowLeft") nextIndex = (availableIndex - 1 + availableTabs.length) % availableTabs.length;
      if (event.key === "ArrowRight") nextIndex = (availableIndex + 1) % availableTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = availableTabs.length - 1;
      availableTabs[nextIndex].click();
      availableTabs[nextIndex].focus();
    });
  });

  document.addEventListener("immersa:deck-detail-open", (event) => {
    setPreviewExpanded(false);
    fileMenu.open = false;
    fileMenu.hidden = !Array.from(fileMenu.querySelectorAll(".deck-file-action")).some((button) => !button.hidden);
    syncDemoMasterTabs(event.detail?.deck);
    activateTab("links");
  });
  document.addEventListener("immersa:deck-detail-close", restoreEditors);
  document.addEventListener("immersa:deck-video-slide-request", (event) => {
    const slideId = String(event.detail?.slideId || "");
    if (!slideId) return;
    window.ImmersaVideoEditor?.selectSlide(slideId, event.detail?.deck?.deckId);
    activateTab("video", true);
  });
  patchDetailActions();
  activateTab("links");
})();
