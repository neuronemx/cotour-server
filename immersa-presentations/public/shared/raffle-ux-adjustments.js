(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaRaffleUxAdjustments = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const CONTROLLER_MODE_TITLES = {
    free: "Sorteo Libre",
    visual_key: "Sorteo Clave visual",
    poll: "Sorteo Encuesta"
  };
  const RAW_CONTROLLER_TITLES = {
    Libre: CONTROLLER_MODE_TITLES.free,
    "Clave visual": CONTROLLER_MODE_TITLES.visual_key,
    Encuesta: CONTROLLER_MODE_TITLES.poll
  };
  const ACTIVE_STATUS_TEXTS = new Set(["Participación abierta", "Participación cerrada", "Sorteando...", "Tenemos ganador"]);

  function stripCountdownSuffix(value) {
    return String(value || "").replace(/^(\d+)s$/i, "$1");
  }

  function isActiveStatus(value) {
    return ACTIVE_STATUS_TEXTS.has(String(value || "").trim());
  }

  function fullModeTitle(label) {
    return RAW_CONTROLLER_TITLES[String(label || "").trim()] || String(label || "");
  }

  function adjustControllerHeadingsHtml(html) {
    return String(html || "").replace(/(<div class="raffle-heading"><h2>)(Libre|Clave visual|Encuesta)(<\/h2><p>)(Participación abierta|Participación cerrada|Sorteando\.\.\.|Tenemos ganador)(<\/p><\/div>)/g, (_match, before, title, middle, status, after) => before + fullModeTitle(title) + middle + status + after);
  }

  function adjustRaffleHtml(html) {
    let next = String(html || "").replace(/(<strong>)(\d+)s(<\/strong>)/gi, "$1$2$3");
    next = adjustControllerHeadingsHtml(next);
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

  function adjustControllerActiveHeadings(scope) {
    scope.querySelectorAll?.(".raffle-section").forEach((section) => {
      const heading = section.querySelector?.(".raffle-heading h2");
      const status = section.querySelector?.(".raffle-heading p");
      if (!heading || !status || !isActiveStatus(status.textContent)) return;
      heading.textContent = fullModeTitle(heading.textContent);
      if (heading.textContent.trim() !== CONTROLLER_MODE_TITLES.free || status.textContent.trim() !== "Participación abierta") return;
      section.querySelectorAll(".raffle-stats > div").forEach((item) => {
        const label = item.querySelector("span")?.textContent?.trim().toUpperCase();
        if (label === "BOLETOS") item.remove();
      });
    });
  }

  function adjustRaffleDom(scope = root.document) {
    if (!scope) return;
    adjustCountdowns(scope);
    adjustControllerActiveHeadings(scope);
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
  return { CONTROLLER_MODE_TITLES, stripCountdownSuffix, fullModeTitle, adjustRaffleHtml, adjustRaffleDom, installRaffleUxAdjustments };
});
