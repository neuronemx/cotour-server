(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.ImmersaInteractionsShell = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const VIEWS = new Set(["home", "polls", "raffles", "games"]);
  const APPROVED_CATEGORY_ICONS = {
    polls: { viewBox: "0 0 24 24", rects: [{ x: "3.5", y: "3.5", width: "17", height: "15", rx: "2" }], paths: ["M6 20.5h12M8 15v-4M12 15V8M16 15v-5M8 7h2"] },
    raffles: { viewBox: "0 0 24 24", rects: [], paths: ["M3 8h18v13H3zM3 8h18M12 8v13M7.5 8a2.5 2.5 0 1 1 0-5C9.2 3 10.6 4.5 12 8M16.5 8a2.5 2.5 0 1 0 0-5C14.8 3 13.4 4.5 12 8"] },
    contests: { viewBox: "0 0 24 24", rects: [], paths: ["M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a2 2 0 0 0 2 2M17 6h3a2 2 0 0 1-2 2"] },
    games: { viewBox: "0 0 24 24", rects: [{ x: "3", y: "6.5", width: "8", height: "13", rx: "2" }, { x: "13", y: "6.5", width: "8", height: "13", rx: "2" }], paths: ["M6.5 13h1.8M15.7 13h1.8"] }
  };
  const CATEGORIES = [
    { id: "polls", label: "Encuestas", enabled: true, icon: APPROVED_CATEGORY_ICONS.polls },
    { id: "raffles", label: "Sorteos", enabled: true, icon: APPROVED_CATEGORY_ICONS.raffles },
    { id: "contests", label: "Concursos", enabled: false, icon: APPROVED_CATEGORY_ICONS.contests },
    { id: "games", label: "Juegos", enabled: true, icon: APPROVED_CATEGORY_ICONS.games }
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
    CATEGORIES.forEach((category) => { const button = createElement(documentRef, "button", "interactions-shell-category"); button.type = "button"; button.dataset.interactionsCategory = category.id; const icon = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "svg") : createElement(documentRef, "svg"); icon.setAttribute("viewBox", category.icon.viewBox); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("fill", "none"); icon.setAttribute("stroke", "currentColor"); icon.setAttribute("stroke-width", "2"); icon.setAttribute("stroke-linecap", "round"); icon.setAttribute("stroke-linejoin", "round"); category.icon.rects.forEach((rectAttrs) => { const rect = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "rect") : createElement(documentRef, "rect"); Object.keys(rectAttrs).forEach((name) => rect.setAttribute(name, rectAttrs[name])); icon.appendChild(rect); }); category.icon.paths.forEach((pathData) => { const path = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "path") : createElement(documentRef, "path"); path.setAttribute("d", pathData); icon.appendChild(path); }); const label = createElement(documentRef, "span", "interactions-shell-category-label", category.label); button.append(icon, label); button.disabled = !category.enabled; if (!category.enabled) { button.setAttribute("aria-disabled", "true"); button.tabIndex = -1; } nav.appendChild(button); buttons.set(category.id, button); });
    const home = createElement(documentRef, "div", "interactions-shell-home");
    home.innerHTML = '<p>Selecciona una interacción.</p>';
    const content = createElement(documentRef, "div", "interactions-shell-content");
    content.dataset.interactionsContentRoot = "true";
    container.append(header, nav, home, content);
    root.appendChild(container);
    function listen(target, eventName, handler) { target.addEventListener(eventName, handler); listeners.push([target, eventName, handler]); }
    function setView(nextView) { if (!VIEWS.has(nextView)) return false; view = nextView; renderState(); return true; }
    function renderState() {
      title.textContent = "Interacciones";
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