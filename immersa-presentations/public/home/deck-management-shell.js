(function () {
  const modal = document.getElementById("deckDetailModal");
  const actionSource = document.getElementById("detailActions");
  const launchers = document.getElementById("deckEditorLaunchers");
  const shell = modal?.querySelector(".deck-detail-modal");
  const tabs = Array.from(modal?.querySelectorAll("[data-deck-tab]") || []);
  const panels = Array.from(modal?.querySelectorAll("[data-deck-panel]") || []);
  if (!modal || !shell || !actionSource || !launchers || !tabs.length || !panels.length) return;

  const moduleDetails = {
    interactions: {
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
    shell.classList.toggle("is-compact-header", name !== "links");
    modal.dataset.activeDeckTab = name;
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
    if (moduleDetails[name]) mountEditor(name);
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
