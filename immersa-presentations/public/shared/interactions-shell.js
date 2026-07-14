(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.ImmersaInteractionsShell = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const VIEWS = new Set(["home", "polls", "raffles"]);
  const APPROVED_CATEGORY_ICONS = {
    polls: { viewBox: "0 0 24 24", paths: ["M4 5.5h16", "M4 12h16", "M4 18.5h10", "M7 3.5v4", "M14 10v4", "M10 16.5v4"] },
    raffles: { viewBox: "0 0 24 24", paths: ["M5 9h14v11H5z", "M7 9V6.5A2.5 2.5 0 0 1 9.5 4 3.5 3.5 0 0 1 13 7.5V9", "M17 9V6.5A2.5 2.5 0 0 0 14.5 4 3.5 3.5 0 0 0 11 7.5V9", "M12 9v11", "M5 13h14"] },
    contests: { viewBox: "0 0 24 24", paths: ["M8 4h8v4a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 3", "M16 6h3a3 3 0 0 1-3 3", "M12 12v5", "M9 20h6", "M10 17h4"] },
    games: { viewBox: "0 0 24 24", paths: ["M7.5 10h9a4.5 4.5 0 0 1 4.12 6.32 2.05 2.05 0 0 1-3.25.57L15 14.5H9l-2.37 2.39a2.05 2.05 0 0 1-3.25-.57A4.5 4.5 0 0 1 7.5 10z", "M8 12.5v4", "M6 14.5h4", "M16.5 13.25h.01", "M18.5 15.25h.01"] }
  };
  const CATEGORIES = [
    { id: "polls", label: "Encuestas", enabled: true, icon: APPROVED_CATEGORY_ICONS.polls },
    { id: "raffles", label: "Sorteos", enabled: true, icon: APPROVED_CATEGORY_ICONS.raffles },
    { id: "contests", label: "Concursos", enabled: false, icon: APPROVED_CATEGORY_ICONS.contests },
    { id: "games", label: "Juegos", enabled: false, icon: APPROVED_CATEGORY_ICONS.games }
  ];
  function createElement(documentRef, tag, className, text) { const element = documentRef.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function create(options = {}) {
    const root = options.root;
    if (!root || !root.ownerDocument) throw new Error("ImmersaInteractionsShell requires a root element");
    const documentRef = root.ownerDocument;
    let view = "home";
    let locked = false;
    let closeVisible = true;
    let titleVisible = true;
    let destroyed = false;
    const listeners = [];
    const container = createElement(documentRef, "section", "interactions-native-shell");
    container.setAttribute("aria-label", "Interacciones");
    const header = createElement(documentRef, "div", "interactions-shell-header");
    const backButton = createElement(documentRef, "button", "interactions-shell-back", "← Volver");
    backButton.type = "button";
    backButton.dataset.interactionsBack = "true";
    const title = createElement(documentRef, "h2", "interactions-shell-title", "Interacciones");
    const closeButton = createElement(documentRef, "button", "interactions-shell-close", "×");
    closeButton.type = "button";
    closeButton.dataset.interactionsClose = "true";
    closeButton.setAttribute("aria-label", "Cerrar interacciones");
    header.append(backButton, title, closeButton);
    const nav = createElement(documentRef, "div", "interactions-shell-nav");
    nav.setAttribute("aria-label", "Categorías de interacciones");
    const buttons = new Map();
    CATEGORIES.forEach((category) => { const button = createElement(documentRef, "button", "interactions-shell-category"); button.type = "button"; button.dataset.interactionsCategory = category.id; const icon = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "svg") : createElement(documentRef, "svg"); icon.setAttribute("viewBox", category.icon.viewBox); icon.setAttribute("aria-hidden", "true"); category.icon.paths.forEach((pathData) => { const path = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "path") : createElement(documentRef, "path"); path.setAttribute("d", pathData); icon.appendChild(path); }); const label = createElement(documentRef, "span", "interactions-shell-category-label", category.label); button.append(icon, label); button.disabled = !category.enabled; if (!category.enabled) { button.setAttribute("aria-disabled", "true"); button.tabIndex = -1; } nav.appendChild(button); buttons.set(category.id, button); });
    const home = createElement(documentRef, "div", "interactions-shell-home");
    home.innerHTML = '<p>Selecciona una interacción.</p>';
    const content = createElement(documentRef, "div", "interactions-shell-content");
    content.dataset.interactionsContentRoot = "true";
    container.append(header, nav, home, content);
    root.appendChild(container);
    function listen(target, eventName, handler) { target.addEventListener(eventName, handler); listeners.push([target, eventName, handler]); }
    function setView(nextView) { if (!VIEWS.has(nextView)) return false; view = nextView; renderState(); return true; }
    function renderState() {
      title.textContent = view === "polls" ? "Encuestas" : view === "raffles" ? "Sorteos" : "Interacciones";
      title.hidden = !titleVisible;
      backButton.hidden = true;
      backButton.disabled = true;
      closeButton.hidden = !closeVisible || locked;
      home.hidden = view !== "home";
      content.hidden = view === "home";
      buttons.forEach((button, id) => { const active = id === view; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); if (button.getAttribute("aria-disabled") === "true") button.disabled = true; else button.disabled = locked; });
      container.classList.toggle("is-locked", locked);
      container.dataset.view = view;
    }
    listen(nav, "click", (event) => { const button = event.target?.closest?.("[data-interactions-category]"); if (!button || !nav.contains(button) || button.disabled || locked) return; const nextView = button.dataset.interactionsCategory; if (!VIEWS.has(nextView)) return; setView(nextView); options.onSelectCategory?.(nextView); });
    listen(backButton, "click", () => { if (backButton.hidden || locked || view === "home") return; setView("home"); options.onSelectCategory?.("home"); });
    listen(closeButton, "click", () => { options.onRequestClose?.(); });
    renderState();
    return { setView, setLocked(value) { locked = Boolean(value); renderState(); }, setCloseVisible(value) { closeVisible = Boolean(value); renderState(); }, setTitleVisible(value) { titleVisible = Boolean(value); renderState(); }, getContentRoot() { return content; }, getView() { return view; }, destroy() { if (destroyed) return; destroyed = true; listeners.splice(0).forEach(([target, eventName, handler]) => target.removeEventListener(eventName, handler)); container.remove(); } };
  }
  return { create };
});
