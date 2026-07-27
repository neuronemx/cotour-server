(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.ImmersaInteractionsShell = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const VIEWS = new Set(["home", "polls", "qna", "assessments", "raffles", "contests", "games"]);
  const APPROVED_CATEGORY_ICONS = {
    polls: {
      viewBox: "0 0 24 24",
      paths: [
        "M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6",
        "M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10",
        "M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14",
        "M4 20h14"
      ]
    },
    qna: {
      viewBox: "0 0 24 24",
      paths: ["M8 9h8", "M8 13h6", "M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3"]
    },
    assessments: {
      viewBox: "0 0 24 24",
      paths: ["M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2", "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2", "M9 14l2 2l4 -4"]
    },
    raffles: {
      viewBox: "0 0 24 24",
      paths: ["M3 9a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -2", "M12 8l0 13", "M19 12v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-7", "M7.5 8a2.5 2.5 0 0 1 0 -5a4.8 8 0 0 1 4.5 5a4.8 8 0 0 1 4.5 -5a2.5 2.5 0 0 1 0 5"]
    },
    contests: {
      viewBox: "0 0 24 24",
      paths: ["M8 21l8 0", "M12 17l0 4", "M7 4l10 0", "M17 4v8a5 5 0 0 1 -10 0v-8", "M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"]
    },
    games: {
      viewBox: "0 0 24 24",
      paths: ["M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"]
    }
  };
  const GROUPS = [
    {
      id: "measurement",
      label: "Medición",
      categories: [
        { id: "polls", label: "Encuestas", enabled: true },
        { id: "qna", label: "Preguntas", enabled: true },
        { id: "assessments", label: "Evaluaciones", enabled: true }
      ]
    },
    {
      id: "play",
      label: "Juego y premio",
      categories: [
        { id: "raffles", label: "Sorteos", enabled: true },
        { id: "contests", label: "Concursos", enabled: true },
        { id: "games", label: "Juegos", enabled: true }
      ]
    }
  ];
  const CATEGORIES = GROUPS.flatMap((group) => group.categories);

  function createElement(documentRef, tag, className, text) {
    const element = documentRef.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createIcon(documentRef, iconDefinition) {
    const icon = documentRef.createElementNS
      ? documentRef.createElementNS("http://www.w3.org/2000/svg", "svg")
      : createElement(documentRef, "svg");
    icon.setAttribute("viewBox", iconDefinition.viewBox);
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");
    iconDefinition.paths.forEach((pathData) => {
      const path = documentRef.createElementNS
        ? documentRef.createElementNS("http://www.w3.org/2000/svg", "path")
        : createElement(documentRef, "path");
      path.setAttribute("d", pathData);
      icon.appendChild(path);
    });
    return icon;
  }

  function createCategoryButton(documentRef, category, variant) {
    const button = createElement(documentRef, "button", "interactions-shell-category interactions-shell-category-" + variant);
    button.type = "button";
    button.dataset.interactionsCategory = category.id;
    button.dataset.interactionsVariant = variant;
    button.append(
      createIcon(documentRef, APPROVED_CATEGORY_ICONS[category.id]),
      createElement(documentRef, "span", "interactions-shell-category-label", category.label),
      createElement(documentRef, "span", "interactions-shell-live-label", "En vivo")
    );
    return button;
  }

  function create(options = {}) {
    const root = options.root;
    if (!root || !root.ownerDocument) throw new Error("ImmersaInteractionsShell requires a root element");
    const documentRef = root.ownerDocument;
    let view = "home";
    let liveView = "";
    let locked = false;
    let closeVisible = true;
    let titleVisible = true;
    let destroyed = false;
    const listeners = [];
    const buttons = new Map(CATEGORIES.map((category) => [category.id, []]));

    const container = createElement(documentRef, "section", "interactions-native-shell");
    container.setAttribute("aria-label", "Interacciones");
    const header = createElement(documentRef, "div", "interactions-shell-header");
    const title = createElement(documentRef, "h2", "interactions-shell-title", "Interacciones");
    const closeButton = createElement(documentRef, "button", "interactions-shell-close", "×");
    closeButton.type = "button";
    closeButton.dataset.interactionsClose = "true";
    closeButton.setAttribute("aria-label", "Cerrar interacciones");
    header.append(title, closeButton);

    const home = createElement(documentRef, "div", "interactions-shell-home");
    GROUPS.forEach((group, groupIndex) => {
      const groupNode = createElement(documentRef, "section", "interactions-shell-group");
      groupNode.dataset.interactionsGroup = group.id;
      groupNode.appendChild(createElement(documentRef, "p", "interactions-shell-group-label", group.label));
      const row = createElement(documentRef, "div", "interactions-shell-group-row");
      group.categories.forEach((category) => {
        const button = createCategoryButton(documentRef, category, "expanded");
        row.appendChild(button);
        buttons.get(category.id).push(button);
      });
      groupNode.appendChild(row);
      home.appendChild(groupNode);
      if (groupIndex < GROUPS.length - 1) home.appendChild(createElement(documentRef, "div", "interactions-shell-group-divider"));
    });

    const compact = createElement(documentRef, "div", "interactions-shell-compact");
    compact.setAttribute("aria-label", "Categorías de interacciones");
    CATEGORIES.forEach((category) => {
      const button = createCategoryButton(documentRef, category, "compact");
      compact.appendChild(button);
      buttons.get(category.id).push(button);
    });
    const backButton = createElement(documentRef, "button", "interactions-shell-back", "Regresar");
    backButton.type = "button";
    backButton.dataset.interactionsBack = "true";

    const content = createElement(documentRef, "div", "interactions-shell-content");
    content.dataset.interactionsContentRoot = "true";
    container.append(header, home, compact, backButton, content);
    root.appendChild(container);

    function listen(target, eventName, handler) {
      target.addEventListener(eventName, handler);
      listeners.push([target, eventName, handler]);
    }

    function syncRendererVisibility() {
      content.querySelectorAll?.("[data-interactions-view]").forEach((node) => {
        node.hidden = node.dataset.interactionsView !== view;
      });
    }

    function categoryIsAvailable(id) {
      return buttons.get(id)?.some((button) => !button.hidden && button.getAttribute("aria-disabled") !== "true");
    }

    function setView(nextView) {
      if (!VIEWS.has(nextView)) return false;
      if (nextView !== "home" && !categoryIsAvailable(nextView)) return false;
      view = nextView;
      renderState();
      return true;
    }

    function setCategoryVisible(id, visible) {
      const categoryButtons = buttons.get(id);
      if (!categoryButtons) return false;
      categoryButtons.forEach((button) => { button.hidden = !visible; });
      if (!visible && view === id) setView("home");
      return true;
    }

    function setCategoryEnabled(id, enabled) {
      const categoryButtons = buttons.get(id);
      if (!categoryButtons) return false;
      categoryButtons.forEach((button) => {
        button.disabled = !enabled;
        button.setAttribute("aria-disabled", String(!enabled));
        button.tabIndex = enabled ? 0 : -1;
      });
      if (!enabled && view === id) setView("home");
      return true;
    }

    function renderState() {
      const onHome = view === "home";
      title.textContent = "Interacciones";
      title.hidden = !titleVisible;
      closeButton.hidden = !closeVisible || locked;
      home.hidden = !onHome;
      compact.hidden = onHome;
      backButton.hidden = onHome;
      backButton.disabled = onHome;
      content.hidden = onHome;
      buttons.forEach((categoryButtons, id) => {
        categoryButtons.forEach((button) => {
          const active = id === view;
          const live = id === liveView;
          button.classList.toggle("is-active", active);
          button.classList.toggle("is-live", live);
          button.setAttribute("aria-pressed", String(active));
        });
      });
      container.classList.toggle("is-locked", locked);
      container.classList.toggle("is-compact", !onHome);
      container.dataset.view = view;
      container.dataset.liveView = liveView;
      syncRendererVisibility();
    }

    function onCategoryClick(event) {
      const button = event.target?.closest?.("[data-interactions-category]");
      if (!button || button.disabled || button.hidden) return;
      const nextView = button.dataset.interactionsCategory;
      if (!setView(nextView)) return;
      options.onSelectCategory?.(nextView);
    }

    listen(home, "click", onCategoryClick);
    listen(compact, "click", onCategoryClick);
    listen(backButton, "click", () => {
      if (backButton.hidden || view === "home") return;
      setView("home");
      options.onSelectCategory?.("home");
    });
    listen(closeButton, "click", () => { options.onRequestClose?.(); });

    CATEGORIES.forEach((category) => {
      const visible = options.categoryVisibility?.[category.id] !== false;
      const enabled = options.categoryEnabled?.[category.id] ?? category.enabled;
      setCategoryVisible(category.id, visible);
      setCategoryEnabled(category.id, enabled);
    });
    renderState();

    return {
      setView,
      setCategoryVisible,
      setCategoryEnabled,
      setLiveView(nextView) {
        liveView = VIEWS.has(nextView) && nextView !== "home" ? nextView : "";
        renderState();
      },
      refreshRendererVisibility: syncRendererVisibility,
      setLocked(value) {
        locked = Boolean(value);
        renderState();
      },
      setCloseVisible(value) {
        closeVisible = Boolean(value);
        renderState();
      },
      setTitleVisible(value) {
        titleVisible = Boolean(value);
        renderState();
      },
      getContentRoot() { return content; },
      getView() { return view; },
      getLiveView() { return liveView; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        listeners.splice(0).forEach(([target, eventName, handler]) => target.removeEventListener(eventName, handler));
        container.remove();
      }
    };
  }

  return { create };
});
