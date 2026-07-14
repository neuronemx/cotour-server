(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.ImmersaInteractionsShell = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function () {
  const VIEWS = new Set(["home", "polls", "raffles"]);
  const CATEGORIES = [
    { id: "polls", label: "Encuestas", enabled: true, icon: "M5 6.5h14M5 12h14M5 17.5h8" },
    { id: "raffles", label: "Sorteos", enabled: true, icon: "M6 8h12v10H6zM8 8V6h8v2M12 8v10M6 12h12" },
    { id: "contests", label: "Concursos", enabled: false, icon: "M8 5h8v3a4 4 0 0 1-8 0V5Zm0 2H5a3 3 0 0 0 3 3m8-3h3a3 3 0 0 1-3 3m-4 2v5m-3 0h6" },
    { id: "games", label: "Juegos", enabled: false, icon: "M7 10h10a4 4 0 0 1 3.6 5.8 2 2 0 0 1-3.2.4L15 14H9l-2.4 2.2a2 2 0 0 1-3.2-.4A4 4 0 0 1 7 10Zm2 2v4m-2-2h4m6-1h.01m-2 2h.01" }
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
    CATEGORIES.forEach((category) => { const button = createElement(documentRef, "button", "interactions-shell-category"); button.type = "button"; button.dataset.interactionsCategory = category.id; const icon = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "svg") : createElement(documentRef, "svg"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); const path = documentRef.createElementNS ? documentRef.createElementNS("http://www.w3.org/2000/svg", "path") : createElement(documentRef, "path"); path.setAttribute("d", category.icon); icon.appendChild(path); const label = createElement(documentRef, "span", "interactions-shell-category-label", category.label); button.append(icon, label); if (!category.enabled) { const badge = createElement(documentRef, "span", "interactions-shell-category-badge", "Próximamente"); button.appendChild(badge); } button.disabled = !category.enabled; if (!category.enabled) button.setAttribute("aria-disabled", "true"); nav.appendChild(button); buttons.set(category.id, button); });
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
