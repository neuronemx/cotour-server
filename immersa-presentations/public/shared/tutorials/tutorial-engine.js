(() => {
  "use strict";

  const KEY = "immersa:tutorials:v1";
  const enabled = new URLSearchParams(window.location.search).get("tutorial") === "1";
  const state = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) { return {}; }
  };
  const save = (next) => localStorage.setItem(KEY, JSON.stringify(next));

  function createNode(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  class TutorialEngine {
    constructor(definitions) {
      this.definitions = definitions || [];
      this.active = null;
      this.index = 0;
      this.cleanup = [];
      this.nodes = null;
      this.reposition = this.reposition.bind(this);
    }

    mount() {
      if (!enabled || this.nodes) return;
      const overlay = createNode("div", "immersa-tutorial-overlay");
      overlay.hidden = true;
      overlay.innerHTML = '<div class="immersa-tutorial-spotlight"></div><section class="immersa-tutorial-card" role="dialog" aria-live="polite" aria-label="Tutorial IMMERSA"><p class="immersa-tutorial-kicker"></p><h2></h2><p class="immersa-tutorial-copy"></p><div class="immersa-tutorial-actions"><button type="button" data-tutorial-back>Atrás</button><button type="button" data-tutorial-exit>Salir</button><button type="button" data-tutorial-next>Siguiente</button></div></section>';
      document.body.appendChild(overlay);
      const restart = createNode("button", "immersa-tutorial-restart");
      restart.type = "button";
      restart.textContent = "?";
      restart.title = "Reiniciar tutorial";
      restart.setAttribute("aria-label", "Reiniciar tutorial");
      document.body.appendChild(restart);
      this.nodes = { overlay, spotlight: overlay.querySelector(".immersa-tutorial-spotlight"), card: overlay.querySelector(".immersa-tutorial-card"), restart };
      overlay.querySelector("[data-tutorial-back]").addEventListener("click", () => this.previous());
      overlay.querySelector("[data-tutorial-next]").addEventListener("click", () => this.next());
      overlay.querySelector("[data-tutorial-exit]").addEventListener("click", () => this.exit());
      restart.addEventListener("click", () => this.restart());
      window.addEventListener("resize", this.reposition);
      window.addEventListener("scroll", this.reposition, true);
      document.addEventListener("keydown", (event) => { if (event.key === "Escape") this.exit(); });
      this.resume();
    }

    definitionForContext() {
      return this.definitions.find((item) => item.context === document.body.dataset.tutorialContext);
    }

    resume() {
      const definition = this.definitionForContext();
      if (!definition) return;
      const current = state()[definition.id];
      const index = current?.pendingStep ? definition.steps.findIndex((step) => step.id === current.pendingStep) : 0;
      if (current?.completed || index < 0) return;
      this.start(definition, index);
    }

    start(definition, index = 0) {
      this.stopListeners();
      this.active = definition;
      this.index = Math.max(0, index);
      this.render();
    }

    restart() {
      const definition = this.definitionForContext();
      if (!definition) return;
      const all = state();
      delete all[definition.id];
      save(all);
      this.start(definition);
    }

    current() { return this.active?.steps[this.index]; }

    resolve(step) {
      try { return typeof step.target === "function" ? step.target() : document.querySelector(step.target); } catch (_) { return null; }
    }

    render() {
      const step = this.current();
      if (!step) return this.complete();
      this.stopListeners();
      const target = this.resolve(step);
      if (!target) return this.next(true);
      const { overlay, card, spotlight } = this.nodes;
      overlay.hidden = false;
      card.querySelector(".immersa-tutorial-kicker").textContent = `${this.index + 1} de ${this.active.steps.length}`;
      card.querySelector("h2").textContent = step.title;
      card.querySelector(".immersa-tutorial-copy").textContent = step.copy;
      card.querySelector("[data-tutorial-back]").hidden = this.index === 0;
      const next = card.querySelector("[data-tutorial-next]");
      next.hidden = step.type === "action-required";
      spotlight.dataset.placement = step.placement || "bottom";
      target.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
      requestAnimationFrame(this.reposition);

      if (step.type === "action-required") {
        const handler = (event) => {
          window.setTimeout(() => {
            const matches = typeof step.advanceWhen === "function"
              ? step.advanceWhen(event, target)
              : event.type === (step.advanceWhen?.event || "click") && event.target.closest?.(step.advanceWhen?.selector || step.target);
            if (!matches) return;
            if (step.nextContext) {
              this.persist(step.nextContext);
              this.exit();
              return;
            }
            this.next();
          }, 0);
        };
        document.addEventListener(step.advanceWhen?.event || "click", handler, true);
        this.cleanup.push(() => document.removeEventListener(step.advanceWhen?.event || "click", handler, true));
      }
    }

    reposition() {
      const step = this.current();
      const target = step && this.resolve(step);
      if (!target || !this.nodes || this.nodes.overlay.hidden) return;
      const rect = target.getBoundingClientRect();
      const gap = 8;
      const { spotlight, card } = this.nodes;
      Object.assign(spotlight.style, { left: `${Math.max(4, rect.left - gap)}px`, top: `${Math.max(4, rect.top - gap)}px`, width: `${rect.width + gap * 2}px`, height: `${rect.height + gap * 2}px` });
      const placeTop = rect.bottom + 18 > window.innerHeight - 170 && rect.top > 180;
      const top = placeTop ? Math.max(12, rect.top - card.offsetHeight - 18) : Math.min(window.innerHeight - card.offsetHeight - 12, rect.bottom + 18);
      const left = Math.max(12, Math.min(window.innerWidth - card.offsetWidth - 12, rect.left));
      Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    }

    persist(pendingStep) {
      const all = state();
      all[this.active.id] = { version: this.active.version, pendingStep, completed: false };
      save(all);
    }

    previous() { if (this.index > 0) { this.index -= 1; this.render(); } }
    next(skipPersist = false) {
      const step = this.current();
      if (!skipPersist && step?.nextContext) this.persist(step.nextContext);
      this.index += 1;
      this.render();
    }
    exit() { this.stopListeners(); if (this.nodes) this.nodes.overlay.hidden = true; this.active = null; }
    complete() {
      const all = state();
      all[this.active.id] = { version: this.active.version, completed: true };
      save(all);
      this.exit();
    }
    stopListeners() { this.cleanup.splice(0).forEach((fn) => fn()); }
  }

  window.ImmersaTutorials = {
    boot(definitions) { const engine = new TutorialEngine(definitions); window.addEventListener("DOMContentLoaded", () => engine.mount(), { once: true }); return engine; }
  };
})();