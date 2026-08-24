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
      (document.getElementById("viewer") || document.body).appendChild(host);
      return host;
    }

    function clearTimers() {
      if (hideTimer) clearTimeoutFn(hideTimer);
      if (concealTimer) clearTimeoutFn(concealTimer);
      hideTimer = null;
      concealTimer = null;
    }

    function matchLogoSurface(image, surface) {
      const sample = () => {
        try {
          const width = Math.min(64, image.naturalWidth || 0);
          const height = Math.min(64, image.naturalHeight || 0);
          if (!width || !height) return;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(image, 0, 0, width, height);
          const pixels = context.getImageData(0, 0, width, height).data;
          const colors = new Map();
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              if (x > 2 && x < width - 3 && y > 2 && y < height - 3) continue;
              const offset = (y * width + x) * 4;
              if (pixels[offset + 3] < 220) continue;
              const red = Math.round(pixels[offset] / 16) * 16;
              const green = Math.round(pixels[offset + 1] / 16) * 16;
              const blue = Math.round(pixels[offset + 2] / 16) * 16;
              const key = `${red},${green},${blue}`;
              colors.set(key, (colors.get(key) || 0) + 1);
            }
          }
          const background = [...colors.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
          if (background) surface.style.setProperty("--brand-logo-surface", `rgb(${background})`);
        } catch (_error) {
          // A logo from another origin simply keeps the neutral fallback surface.
        }
      };
      if (image.complete) sample();
      else image.addEventListener("load", sample, { once: true });
    }

    function hide() {
      generation += 1;
      clearTimers();
      if (!host || host.hidden) return;
      host.classList.add("is-exiting");
      host.classList.remove("is-visible");
      if (reducedMotion?.matches) {
        host.hidden = true;
        host.classList.remove("is-exiting");
        host.replaceChildren();
        return;
      }
      const currentGeneration = generation;
      concealTimer = setTimeoutFn(() => {
        if (generation !== currentGeneration) return;
        host.hidden = true;
        host.classList.remove("is-exiting");
        host.replaceChildren();
      }, 760);
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

      const sponsor = document.createElement("span");
      sponsor.className = "brand-mention-sponsor-label";
      sponsor.textContent = "Con la colaboración de";

      const logo = document.createElement("span");
      logo.className = "brand-mention-card-logo";
      const image = document.createElement("img");
      image.src = String(mention.logo_src || "");
      image.alt = "Logo de " + mention.name;
      logo.appendChild(image);
      matchLogoSurface(image, logo);

      const copy = document.createElement("span");
      copy.className = "brand-mention-card-copy";
      const name = document.createElement("strong");
      const pitch = document.createElement("span");
      pitch.className = "brand-mention-card-pitch";
      const linkRow = document.createElement("span");
      linkRow.className = "brand-mention-card-link";
      const domain = document.createElement("em");
      name.textContent = mention.name;
      pitch.textContent = String(mention.pitch || "");
      domain.textContent = String(mention.display_domain || new URL(targetUrl).hostname.replace(/^www\./i, ""));

      const arrow = document.createElement("img");
      arrow.className = "brand-mention-card-arrow";
      arrow.src = "/audience/external-link.png";
      arrow.alt = "";
      arrow.setAttribute("aria-hidden", "true");
      linkRow.append(domain, arrow);
      copy.append(name, pitch, linkRow);
      link.append(logo, copy);
      container.replaceChildren(sponsor, link);
      container.hidden = false;
      container.classList.remove("is-visible", "is-exiting");
      container.getBoundingClientRect?.();
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
