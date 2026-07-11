(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaRaffleUxAdjustments = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function stripCountdownSuffix(value) {
    return String(value || "").replace(/^(\d+)s$/i, "$1");
  }

  function adjustRaffleHtml(html) {
    let next = String(html || "").replace(/(<strong>)(\d+)s(<\/strong>)/gi, "$1$2$3");
    next = next.replace(/<h2>Libre<\/h2><p>Participación abierta<\/p>/g, "<h2>Sorteo Libre</h2><p>Participación abierta</p>");
    if (next.includes("<h2>Sorteo Libre</h2><p>Participación abierta</p>")) {
      next = next.replace(/<div class="raffle-stats"><div><span>CONECTADOS<\/span><strong>([^<]*)<\/strong><\/div><div><span>BOLETOS<\/span><strong>[^<]*<\/strong><\/div><\/div>/g, '<div class="raffle-stats"><div><span>CONECTADOS</span><strong>$1</strong></div></div>');
    }
    return next;
  }

  function adjustCountdowns(scope) {
    scope.querySelectorAll?.(".raffle-countdown strong, .raffle-public-countdown strong, .raffle-screen-countdown strong").forEach((node) => {
      node.textContent = stripCountdownSuffix(node.textContent);
    });
  }

  function adjustControllerFreeCollecting(scope) {
    scope.querySelectorAll?.(".raffle-section").forEach((section) => {
      const heading = section.querySelector?.(".raffle-heading h2");
      const status = section.querySelector?.(".raffle-heading p");
      if (!heading || !status) return;
      if (heading.textContent.trim() !== "Libre" || status.textContent.trim() !== "Participación abierta") return;
      heading.textContent = "Sorteo Libre";
      section.querySelectorAll(".raffle-stats > div").forEach((item) => {
        const label = item.querySelector("span")?.textContent?.trim().toUpperCase();
        if (label === "BOLETOS") item.remove();
      });
    });
  }

  function adjustRaffleDom(scope = root.document) {
    if (!scope) return;
    adjustCountdowns(scope);
    adjustControllerFreeCollecting(scope);
  }

  function installRaffleUxAdjustments() {
    if (!root.document || root.__immersaRaffleUxAdjustmentsInstalled) return;
    root.__immersaRaffleUxAdjustmentsInstalled = true;
    const schedule = () => {
      if (root.requestAnimationFrame) root.requestAnimationFrame(() => adjustRaffleDom(root.document));
      else setTimeout(() => adjustRaffleDom(root.document), 0);
    };
    schedule();
    if (root.MutationObserver) {
      new root.MutationObserver(schedule).observe(root.document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  if (root?.document) installRaffleUxAdjustments();
  return { stripCountdownSuffix, adjustRaffleHtml, adjustRaffleDom, installRaffleUxAdjustments };
});
