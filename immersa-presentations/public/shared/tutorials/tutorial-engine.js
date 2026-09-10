(() => {
  "use strict";
  const KEY = "immersa:tutorials:v2";
  const enabled = new URLSearchParams(window.location.search).get("tutorial") === "1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) { return {}; } };
  const write = (value) => localStorage.setItem(KEY, JSON.stringify(value));

  class TutorialEngine {
    constructor(definitions) { this.definitions = definitions; this.index = 0; this.active = null; this.prepared = new Set(); }
    mount() {
      if (!enabled) return;
      const overlay = document.createElement("div");
      overlay.className = "immersa-tutorial-overlay";
      overlay.hidden = true;
      overlay.innerHTML = '<div class="immersa-tutorial-spotlight"></div><section class="immersa-tutorial-card" role="dialog" aria-modal="true" aria-live="polite"><button class="immersa-tutorial-exit" type="button" aria-label="Salir del tutorial">×</button><p class="immersa-tutorial-kicker"></p><h2></h2><p class="immersa-tutorial-copy"></p><div class="immersa-tutorial-actions"><button type="button" data-back>Atrás</button><button type="button" data-next>Siguiente</button></div></section>';
      document.body.appendChild(overlay);
      this.nodes = { overlay, card: overlay.querySelector(".immersa-tutorial-card"), spotlight: overlay.querySelector(".immersa-tutorial-spotlight") };
      overlay.querySelector("[data-back]").addEventListener("click", () => this.go(-1));
      overlay.querySelector("[data-next]").addEventListener("click", () => this.go(1));
      overlay.querySelector(".immersa-tutorial-exit").addEventListener("click", () => this.exit());
      window.addEventListener("resize", () => this.position());
      const definition = this.definitions.find((item) => item.context === document.body.dataset.tutorialContext);
      if (!definition || read()[definition.id]?.completed) return;
      this.active = definition;
      this.render();
    }
    target(step) { try { return typeof step.target === "function" ? step.target() : document.querySelector(step.target); } catch (_) { return null; } }
    render() {
      const step = this.active?.steps[this.index];
      if (!step) return this.complete();
      this.nodes.overlay.hidden = false;
      document.documentElement.classList.add("immersa-tutorial-lock");
      document.body.classList.add("immersa-tutorial-lock");
      if (!this.prepared.has(step.id)) { this.prepared.add(step.id); step.prepare?.(); }
      const target = this.target(step);
      if (!target) { this.nodes.card.style.visibility = "hidden"; window.setTimeout(() => this.render(), 80); return; }
      const { card, spotlight } = this.nodes;
      card.style.visibility = "visible";
      card.querySelector(".immersa-tutorial-kicker").textContent = `${this.index + 1} de ${this.active.steps.length}`;
      card.querySelector("h2").textContent = step.title;
      card.querySelector(".immersa-tutorial-copy").textContent = step.copy;
      card.querySelector("[data-back]").hidden = this.index === 0;
      card.querySelector("[data-next]").textContent = this.index === this.active.steps.length - 1 ? "Terminar" : "Siguiente";
      target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      requestAnimationFrame(() => this.position());
    }
    position() {
      const step = this.active?.steps[this.index], target = step && this.target(step);
      if (!target || this.nodes.overlay.hidden) return;
      const rect = target.getBoundingClientRect(), gap = 8, { spotlight, card } = this.nodes;
      const left = Math.max(4, rect.left - gap), topEdge = Math.max(4, rect.top - gap), width = rect.width + gap * 2, height = rect.height + gap * 2;
      Object.assign(spotlight.style, { left: `${left}px`, top: `${topEdge}px`, width: `${width}px`, height: `${height}px` });
      const top = rect.bottom + 16 + card.offsetHeight > innerHeight ? Math.max(12, rect.top - card.offsetHeight - 16) : Math.min(innerHeight - card.offsetHeight - 12, rect.bottom + 16);
      Object.assign(card.style, { left: `${Math.max(12, Math.min(innerWidth - card.offsetWidth - 12, rect.left))}px`, top: `${top}px` });
    }
    go(direction) { this.index = Math.max(0, this.index + direction); this.render(); }
    exit() { this.nodes.overlay.hidden = true; document.documentElement.classList.remove("immersa-tutorial-lock"); document.body.classList.remove("immersa-tutorial-lock"); }
    complete() { const all = read(); all[this.active.id] = { completed: true }; write(all); this.exit(); }
  }
  window.ImmersaTutorials = { boot(definitions) { window.addEventListener("DOMContentLoaded", () => new TutorialEngine(definitions).mount(), { once: true }); } };
})();