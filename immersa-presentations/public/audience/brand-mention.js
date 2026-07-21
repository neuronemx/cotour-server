(function (root) {
  function httpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return parsed.protocol === "https:" && parsed.hostname ? parsed.href : "";
    } catch (_error) {
      return "";
    }
  }

  function createController({ socket, document, now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    if (!socket || !document) return null;
    const reducedMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)");
    let host = null;
    let hideTimer = null;
    let concealTimer = null;
    let generation = 0;

    function ensureHost() {
      if (host) return host;
      host = document.createElement("aside");
      host.className = "brand-mention-host";
      host.hidden = true;
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-label", "Mención de marca");
      document.body.appendChild(host);
      return host;
    }

    function clearTimers() {
      if (hideTimer) clearTimeoutFn(hideTimer);
      if (concealTimer) clearTimeoutFn(concealTimer);
      hideTimer = null;
      concealTimer = null;
    }

    function hide() {
      generation += 1;
      clearTimers();
      if (!host || host.hidden) return;
      host.classList.remove("is-visible");
      if (reducedMotion?.matches) {
        host.hidden = true;
        host.replaceChildren();
        return;
      }
      const currentGeneration = generation;
      concealTimer = setTimeoutFn(() => {
        if (generation !== currentGeneration) return;
        host.hidden = true;
        host.replaceChildren();
      }, 320);
    }

    function show(mention) {
      const targetUrl = httpsUrl(mention?.target_url);
      const visibleUntil = Number(mention?.visible_until);
      const remaining = Number.isFinite(visibleUntil) ? visibleUntil - now() : 0;
      if (!mention?.id || !mention?.name || !targetUrl || remaining <= 0) return hide();
      generation += 1;
      clearTimers();
      const currentGeneration = generation;
      const container = ensureHost();
      const link = document.createElement("a");
      link.className = "brand-mention-card";
      link.href = targetUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", "Abrir sitio de " + mention.name);

      const logo = document.createElement("span");
      logo.className = "brand-mention-card-logo";
      const image = document.createElement("img");
      image.src = String(mention.logo_src || "");
      image.alt = "Logo de " + mention.name;
      logo.appendChild(image);

      const copy = document.createElement("span");
      copy.className = "brand-mention-card-copy";
      const eyebrow = document.createElement("small");
      const name = document.createElement("strong");
      const pitch = document.createElement("span");
      const domain = document.createElement("em");
      eyebrow.textContent = "Mención de marca";
      name.textContent = mention.name;
      pitch.textContent = String(mention.pitch || "");
      domain.textContent = String(mention.display_domain || new URL(targetUrl).hostname.replace(/^www\./i, ""));
      copy.append(eyebrow, name, pitch, domain);

      const arrow = document.createElement("span");
      arrow.className = "brand-mention-card-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↗";
      link.append(logo, copy, arrow);
      container.replaceChildren(link);
      container.hidden = false;
      container.classList.remove("is-visible");
      root.requestAnimationFrame?.(() => {
        if (generation === currentGeneration && !container.hidden) container.classList.add("is-visible");
      });
      if (!root.requestAnimationFrame) container.classList.add("is-visible");
      hideTimer = setTimeoutFn(hide, remaining);
    }

    socket.on("brand_mention:show", show);
    socket.on("brand_mention:hide", hide);
    socket.on("disconnect", hide);
    return { show, hide, element: () => host };
  }

  root.ImmersaBrandMention = { createController };
  if (typeof socket !== "undefined") createController({ socket, document: root.document });
})(typeof window !== "undefined" ? window : globalThis);
