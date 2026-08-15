(function (root) {
  const STORAGE_KEY = "immersa:presentation-completion";
  const DESTINATIONS = { presenter: "/presentacion-completada", stage: "/operacion-finalizada", audience: "/gracias-por-participar", screen: "/presentacion-finalizada" };
  function showScreenClosure() {
    const overlay = document.createElement("section");
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#090817;color:#fff;font:700 clamp(24px,4vw,54px) Inter,system-ui;text-align:center";
    overlay.innerHTML = '<div><div style="font-size:.32em;letter-spacing:.22em;color:#64e6da;margin-bottom:16px">IMMERSA</div><div>Presentación finalizada</div></div>';
    document.body.appendChild(overlay);
  }
  function create({ socket, role, context = {} } = {}) {
    if (!socket?.on || !DESTINATIONS[role]) return null;
    let handled = false;
    socket.on("presentation:closed", (payload = {}) => {
      if (handled) return;
      handled = true;
      const record = { ...payload, role, deckId: payload.deckId || context.deck || context.deckId || null, savedAt: new Date().toISOString() };
      try { root.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch (_error) {}
      if (role === "screen") showScreenClosure();
      socket.disconnect?.();
      root.setTimeout(() => root.location.replace(DESTINATIONS[role]), role === "screen" ? 1400 : 250);
    });
    return { storageKey: STORAGE_KEY };
  }
  root.ImmersaPresentationCompletion = { create, STORAGE_KEY };
})(window);
