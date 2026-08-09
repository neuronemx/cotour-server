const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Shell = require("../public/shared/interactions-shell");

class ClassList { constructor(el){ this.el=el; this.set=new Set(); } add(c){this.set.add(c); this.el.className=[...this.set].join(" ");} remove(c){this.set.delete(c); this.el.className=[...this.set].join(" ");} toggle(c,v){ const on=v===undefined?!this.set.has(c):Boolean(v); if(on)this.add(c); else this.remove(c); } contains(c){return this.set.has(c);} }
class Element {
  constructor(tag, doc){ this.tagName=tag.toUpperCase(); this.ownerDocument=doc; this.children=[]; this.parentNode=null; this.attributes={}; this.dataset={}; this.listeners={}; this.style={}; this.classList=new ClassList(this); this.hidden=false; this.disabled=false; this.textContent=""; }
  set className(v){ this._className=v; this.classList.set=new Set(String(v||"").split(/\s+/).filter(Boolean)); }
  get className(){ return this._className||""; }
  set innerHTML(v){ this._innerHTML=v; this.children=[]; }
  get innerHTML(){ return this._innerHTML||""; }
  append(...nodes){ nodes.forEach((n)=>this.appendChild(n)); }
  appendChild(node){ node.parentNode=this; this.children.push(node); return node; }
  remove(){ if(!this.parentNode)return; const i=this.parentNode.children.indexOf(this); if(i>=0)this.parentNode.children.splice(i,1); this.parentNode=null; }
  setAttribute(name,value){ this.attributes[name]=String(value); if(name==="class")this.className=value; if(name.startsWith("data-")){ const key=name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); this.dataset[key]=String(value); } }
  getAttribute(name){ return this.attributes[name]; }
  addEventListener(type,handler){ (this.listeners[type] ||= []).push(handler); }
  removeEventListener(type,handler){ this.listeners[type]=(this.listeners[type]||[]).filter((item)=>item!==handler); }
  click(){ const event={ target:this }; let node=this; while(node){ (node.listeners.click||[]).forEach((handler)=>handler(event)); node=node.parentNode; } }
  contains(node){ return node===this || this.children.some((child)=>child.contains?.(node)); }
  matches(selector){ if(selector.startsWith(".")) return this.classList.contains(selector.slice(1)); const data=selector.match(/^\[data-([^\]]+)\]$/); if(data){ const key=data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); return Object.prototype.hasOwnProperty.call(this.dataset,key); } return selector.toUpperCase() === this.tagName; }
  closest(selector){ let node=this; while(node){ if(node.matches?.(selector))return node; node=node.parentNode; } return null; }
  querySelectorAll(selector){ const out=[]; const visit=(node)=>{ if(node.matches?.(selector))out.push(node); node.children.forEach(visit); }; this.children.forEach(visit); return out; }
  querySelector(selector){ return this.querySelectorAll(selector)[0]||null; }
}
class Document { createElement(tag){ return new Element(tag,this); } }
function setup(){ const document = new Document(); const root = document.createElement("div"); return { document, root }; }

function category(root, id){ return root.querySelectorAll("[data-interactions-category]").find((button)=>button.dataset.interactionsCategory===id); }

test("interactions shell navigation, lock, close, and destroy", () => {
  const { root } = setup();
  const selected = [];
  let closes = 0;
  const shell = Shell.create({ root, onSelectCategory: (view)=>selected.push(view), onRequestClose: ()=>closes++ });
  assert.equal(shell.getView(), "home");
  assert.equal(root.querySelector("[data-interactions-back]").hidden, true);
  assert.equal(root.querySelector("[data-interactions-back]").textContent, "Regresar");
  assert.equal(root.querySelector("[data-interactions-close]").hidden, false);
  category(root, "polls").click();
  assert.equal(shell.getView(), "polls");
  assert.equal(root.querySelector("[data-interactions-back]").hidden, false);
  category(root, "raffles").click();
  assert.equal(shell.getView(), "raffles");
  category(root, "contests").click();
  category(root, "assessments").click();
  category(root, "qna").click();
  category(root, "games").click();
  assert.deepEqual(selected, ["polls", "raffles", "contests", "assessments", "qna", "games"]);
  shell.setLocked(true);
  category(root, "polls").click();
  assert.equal(shell.getView(), "polls");
  root.querySelector("[data-interactions-back]").click();
  assert.equal(shell.getView(), "home");
  shell.setLocked(false);
  root.querySelector("[data-interactions-back]").click();
  assert.equal(shell.getView(), "home");
  shell.setView("home");
  assert.equal(shell.getView(), "home");
  assert.equal(closes, 0);
  root.querySelector("[data-interactions-close]").click();
  assert.equal(closes, 1);
  shell.setCloseVisible(false);
  assert.equal(root.querySelector("[data-interactions-close]").hidden, true);
  shell.setTitleVisible(false);
  assert.equal(root.querySelector(".interactions-shell-title").hidden, true);
  const close = root.querySelector("[data-interactions-close]");
  shell.destroy();
  assert.equal(root.children.length, 0);
  close.click();
  assert.equal(closes, 1);
});

test("interactions shell source avoids prohibited integration mechanisms", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions-shell.js"), "utf8");
  assert.doesNotMatch(source, /MutationObserver/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /\bio\b/);
  assert.doesNotMatch(source, /document\.addEventListener/);
  assert.doesNotMatch(source, /window\.addEventListener/);
  assert.doesNotMatch(source, /stopImmediatePropagation/);
  assert.doesNotMatch(source, /addEventListener\([^\n]+,\s*true\)/);
});

const APPROVED_CATEGORY_ICONS = {
  polls: { viewBox: "0 0 24 24", paths: ["M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6", "M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10", "M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14", "M4 20h14"] },
  qna: { viewBox: "0 0 24 24", paths: ["M8 9h8", "M8 13h6", "M9 18h-3a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-3l-3 3l-3 -3"] },
  assessments: { viewBox: "0 0 24 24", paths: ["M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2", "M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2", "M9 14l2 2l4 -4"] },
  raffles: { viewBox: "0 0 24 24", paths: ["M3 9a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -2", "M12 8l0 13", "M19 12v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-7", "M7.5 8a2.5 2.5 0 0 1 0 -5a4.8 8 0 0 1 4.5 5a4.8 8 0 0 1 4.5 -5a2.5 2.5 0 0 1 0 5"] },
  contests: { viewBox: "0 0 24 24", paths: ["M8 21l8 0", "M12 17l0 4", "M7 4l10 0", "M17 4v8a5 5 0 0 1 -10 0v-8", "M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"] },
  games: { viewBox: "0 0 24 24", paths: ["M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M14 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4", "M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"] }
};

test("interactions shell preserves the approved category contract", () => {
  const { root } = setup();
  const shell = Shell.create({ root });
  const categories = root.querySelectorAll("[data-interactions-category]");
  assert.deepEqual(categories.slice(0, 6).map((button) => button.dataset.interactionsCategory), ["polls", "qna", "assessments", "raffles", "contests", "games"]);
  assert.deepEqual(categories.slice(0, 6).map((button) => button.querySelector(".interactions-shell-category-label")?.textContent), ["Encuestas", "Preguntas", "Evaluaciones", "Sorteos", "Trivias", "Juegos"]);
  assert.equal(root.querySelectorAll("[data-interactions-group]").length, 2);
  assert.equal(categories.length, 12);
  assert.equal(root.querySelectorAll("h2").length, 1);
  assert.equal(root.querySelector(".interactions-shell-title").textContent, "Interacciones");
  shell.setView("polls");
  assert.equal(root.querySelector(".interactions-shell-title").textContent, "Interacciones");
  assert.notEqual(root.querySelector(".interactions-shell-title").textContent, "Encuestas");
  assert.equal(root.querySelector(".interactions-shell-home").hidden, true);
  assert.equal(category(root, "contests").disabled, false);
  assert.equal(category(root, "assessments").disabled, false);
  assert.equal(category(root, "qna").disabled, false);
  assert.equal(category(root, "games").disabled, false);
  shell.setCategoryVisible("qna", false);
  assert.equal(category(root, "qna").hidden, true);
  shell.setCategoryVisible("qna", true);
  assert.equal(category(root, "qna").hidden, false);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions-shell.js"), "utf8"), /Próximamente/);
  for (const button of categories.slice(0, 6)) {
    const expected = APPROVED_CATEGORY_ICONS[button.dataset.interactionsCategory];
    const svg = button.querySelector("svg");
    assert.equal(svg.getAttribute("viewBox"), expected.viewBox);
    assert.equal(svg.getAttribute("stroke-width"), "2");
    assert.equal(svg.getAttribute("stroke-linecap"), "round");
    assert.equal(svg.getAttribute("stroke-linejoin"), "round");
    assert.equal(svg.querySelectorAll("rect").length, 0);
    assert.deepEqual(svg.querySelectorAll("path").map((path) => path.getAttribute("d")), expected.paths);
  }
  assert.equal(root.querySelectorAll("[data-interactions-close]").length, 1);
  assert.equal(root.querySelector("[data-interactions-close]").hidden, false);
  shell.setLocked(true);
  assert.equal(root.querySelector("[data-interactions-close]").hidden, true);
  assert.equal(categories.every((button) => button.disabled), false);
  shell.setLiveView("contests");
  assert.equal(shell.getLiveView(), "contests");
  assert.equal(category(root, "contests").classList.contains("is-live"), true);
  shell.setCategoryLive("qna", true);
  shell.setCategoryCount("qna", 3);
  assert.equal(category(root, "qna").classList.contains("is-live"), true);
  assert.equal(category(root, "qna").querySelector(".interactions-shell-live-label").textContent, "En vivo");
  assert.equal(category(root, "qna").querySelector(".interactions-shell-count-label").textContent, "3");
  assert.equal(category(root, "qna").getAttribute("aria-label"), "Preguntas · En vivo · 3 pendientes");
  assert.equal(category(root, "contests").classList.contains("is-live"), true);
  shell.setCategoryLive("qna", false);
  shell.setCategoryCount("qna", 0);
  assert.equal(category(root, "qna").classList.contains("is-live"), false);
  assert.equal(category(root, "qna").querySelector(".interactions-shell-count-label").hidden, true);
});


test("interactions shell renderer visibility respects hidden state across views", () => {
  const { root, document } = setup();
  const shell = Shell.create({ root });
  const content = shell.getContentRoot();
  const pollsRenderer = document.createElement("div");
  pollsRenderer.className = "interaction-polls-renderer";
  pollsRenderer.textContent = "Encuestas disponibles";
  const raffleRenderer = document.createElement("div");
  raffleRenderer.className = "interaction-raffle-renderer";
  raffleRenderer.textContent = "Sorteos disponibles";
  content.append(pollsRenderer, raffleRenderer);
  const syncRendererVisibility = () => {
    pollsRenderer.hidden = shell.getView() !== "polls";
    raffleRenderer.hidden = shell.getView() !== "raffles";
  };

  syncRendererVisibility();
  assert.equal(root.querySelector(".interactions-shell-home").hidden, false);
  assert.equal(pollsRenderer.hidden, true);
  assert.equal(raffleRenderer.hidden, true);

  shell.setView("polls");
  syncRendererVisibility();
  assert.equal(root.querySelector(".interactions-shell-home").hidden, true);
  assert.equal(pollsRenderer.hidden, false);
  assert.equal(raffleRenderer.hidden, true);

  shell.setView("raffles");
  syncRendererVisibility();
  assert.equal(root.querySelector(".interactions-shell-home").hidden, true);
  assert.equal(pollsRenderer.hidden, true);
  assert.equal(raffleRenderer.hidden, false);

  shell.setView("home");
  syncRendererVisibility();
  assert.equal(root.querySelector(".interactions-shell-home").hidden, false);
  assert.equal(pollsRenderer.hidden, true);
  assert.equal(raffleRenderer.hidden, true);
});

test("shared interactions css exposes critical visual contract tokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions.css"), "utf8");
  assert.match(css, /--immersa-gradient: linear-gradient\(135deg, #7f77dd 0%, #378add 55%, #5dcaa5 100%\);/);
  assert.match(css, /--immersa-glass: linear-gradient\(160deg, rgba\(30, 26, 48, \.96\), rgba\(18, 16, 30, \.98\)\);/);
  assert.match(css, /font-family: Poppins, Inter/);
  assert.match(css, /width: min\(420px, calc\(100vw - 28px\)\);/);
  assert.match(css, /\.interactions-shell-nav \{[\s\S]+gap: 0;[\s\S]+background: rgba\(5, 8, 18, \.32\);/);
  assert.match(css, /\.interactions-shell-nav \{[\s\S]+border: 0 !important;[\s\S]+outline: 0 !important;[\s\S]+box-shadow: none !important;/);
  assert.match(css, /\.interaction-panel::before,[\s\S]+\.stage-actions-card::before \{[\s\S]+top: 0 !important;[\s\S]+height: 3px;[\s\S]+background: var\(--immersa-gradient\);/);
  assert.match(css, /\.interaction-panel \{[\s\S]+position: fixed !important;[\s\S]+overflow-x: hidden;[\s\S]+overflow-y: auto;/);
  assert.match(css, new RegExp('\\.interaction-panel,\\n\\.stage-actions-card \\{\\n  background: var\\(--immersa-glass\\) !important;\\n\\}'));
  assert.match(css, /\.stage-actions-card \{[\s\S]+border-radius: 22px;[\s\S]+overflow-x: hidden;[\s\S]+overflow-y: auto;[\s\S]+background: var\(--immersa-glass\) !important;[\s\S]+background-clip: padding-box;/);
  assert.match(css, /\.stage-actions-card \.stage-actions-content \{[\s\S]+background: transparent !important;[\s\S]+border: 0;[\s\S]+border-radius: 0;[\s\S]+box-shadow: none;/);
  assert.doesNotMatch(css, /\.stage-actions-card \.stage-actions-content \{\n  background: var\(--immersa-glass\);/);
  assert.match(css, /\.interaction-panel,[\s\S]+\.stage-actions-card \{[\s\S]+border-top-width: 0 !important;/);
  assert.match(css, /\.interaction-polls-renderer\[hidden\],[\s\S]+\.interaction-raffle-renderer\[hidden\] \{[\s\S]+display: none !important;/);
  assert.match(css, /\.interaction-polls-renderer:not\(\[hidden\]\) \{[\s\S]+display: grid;[\s\S]+grid-template-columns: minmax\(0, 1fr\);[\s\S]+row-gap: 12px;/);
  assert.match(css, /\.interaction-raffle-renderer:not\(\[hidden\]\) \{[\s\S]+display: block;[\s\S]+min-width: 0;/);
  assert.match(css, /\.interaction-panel \{[\s\S]+scrollbar-width: thin;[\s\S]+scrollbar-color: rgba\(127, 119, 221, \.52\) transparent;[\s\S]+scrollbar-gutter: auto;[\s\S]+border-radius: 22px !important;[\s\S]+border-top-right-radius: 22px !important;[\s\S]+border-bottom-right-radius: 22px !important;[\s\S]+background-clip: padding-box;/);
  const interactionPanelBlocks = [...css.matchAll(/\.interaction-panel \{([^}]*)\}/g)].map((match) => match[1]);
  assert.equal(interactionPanelBlocks.some((block) => /scrollbar-gutter: stable;/.test(block)), false);
  assert.match(css, /\.interaction-panel::-webkit-scrollbar \{[\s\S]+width: 7px;/);
  assert.match(css, /\.interaction-panel::-webkit-scrollbar-track \{[\s\S]+background: transparent;/);
  assert.match(css, /\.interaction-panel::-webkit-scrollbar-track-piece \{[\s\S]+margin-block: 16px;[\s\S]+background: transparent;/);
  assert.match(css, /\.interaction-picker \{[\s\S]+display: grid;[\s\S]+row-gap: 12px;[\s\S]+max-height: min\(320px, 38dvh\);[\s\S]+overflow-y: auto;[\s\S]+scrollbar-width: thin;[\s\S]+margin: 0;/);
  assert.match(css, /\.interaction-panel-actions \.primary,[\s\S]+\.stage-actions-card \.interaction-panel-actions \.primary \{[\s\S]+background: var\(--immersa-gradient\) !important;[\s\S]+border: 0 !important;[\s\S]+outline: 0 !important;[\s\S]+box-shadow: none !important;/);
  assert.match(css, /\.raffle-mode-card,[\s\S]+\.stage-actions-card \.raffle-mode-card \{[\s\S]+min-height: 64px;[\s\S]+grid-template-columns: minmax\(0, 1fr\);[\s\S]+transform: none !important;/);
  assert.match(css, /\.raffle-mode-card strong \{[\s\S]+font-family: Poppins, Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-size: 13px;[\s\S]+font-weight: 500;/);
  assert.match(css, /\.raffle-mode-description \{[\s\S]+font-family: Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-size: 11px;[\s\S]+font-weight: 400;/);
  assert.match(css, /\.raffle-mode-card:hover:not\(:disabled\) \{[\s\S]+transform: none !important;[\s\S]+background: rgba\(255, 255, 255, \.075\);/);
  assert.match(css, /\.raffle-mode-card\.is-selected,[\s\S]+\.stage-actions-card \.raffle-mode-card\.is-selected \{[\s\S]+border: 1\.5px solid transparent !important;[\s\S]+var\(--immersa-gradient\) border-box !important;[\s\S]+box-shadow: none !important;/);
  assert.match(css, /\.raffle-stats-pill \{[\s\S]+display: flex;[\s\S]+border-radius: 999px;/);
  assert.match(css, /\.raffle-stat-item \{[\s\S]+white-space: nowrap;/);
  assert.match(css, /\.interaction-panel button\.interaction-choice\.is-selected::after,[\s\S]+\.stage-actions-card button\.interaction-choice\.is-selected::after \{[\s\S]+border-radius: 50%;[\s\S]+color: #fff !important;[\s\S]+background: var\(--immersa-gradient\) !important;[\s\S]+box-shadow: none !important;/);
  assert.doesNotMatch(css, /\.interaction-panel,\s*\n\.stage-actions-card \{\s*\n\s*position: relative;[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.interactions-native-shell::before,[\s\S]+content: none;/);
  assert.match(css, /\.interactions-shell-home \{[\s\S]+background: transparent;[\s\S]+border: 0;/);
  assert.match(css, /\.interactions-shell-category\.is-active \{[\s\S]+background: var\(--immersa-gradient\) !important;/);
  assert.match(css, /\.interactions-shell-category\.is-active \{[\s\S]+color: #fff !important;/);
  assert.match(css, /\.interactions-shell-group-row \{[\s\S]+grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.interactions-shell-compact \{[\s\S]+grid-template-columns: repeat\(6, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.interactions-shell-category\.is-live \.interactions-shell-live-label \{[\s\S]+display: block;/);
  assert.match(css, /\.interactions-shell-home\[hidden\] \{[\s\S]+display: none !important;[\s\S]+min-height: 0;[\s\S]+padding: 0;/);
  assert.match(css, /\.interactions-shell-close \{[\s\S]+color: transparent;[\s\S]+font-size: 0 !important;/);
  assert.match(css, /\.interactions-shell-close::before,[\s\S]+\.interactions-shell-close::after \{[\s\S]+width: 8px;[\s\S]+height: 1px;/);
  assert.match(css, /\.interaction-choice-prompt \{[\s\S]+font-family: Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-weight: 400;/);
  assert.match(css, /\.interaction-panel button:hover:not\(:disabled\),[\s\S]+transform: none !important;/);
  assert.doesNotMatch(css, /:hover[^{}]*\{[^{}]*(?:translateY|scale)\(/);
});


test("audience poll card uses Immersa visual contract without changing runtime markup", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions.css"), "utf8");
  const audienceIndex = fs.readFileSync(path.join(__dirname, "..", "public/audience/index.html"), "utf8");
  const selectedBlocks = [...css.matchAll(/\.interaction-card button\.interaction-option\.is-selected \{([^}]*)\}/g)].map((match) => match[1]);
  const audienceSource = fs.readFileSync(path.join(__dirname, "..", "public/audience/audience.js"), "utf8");
  const topActions = audienceIndex.match(/<div class="top-actions">([\s\S]+?)<\/div>/)[1];

  assert.match(audienceIndex, /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/);
  assert.match(audienceIndex, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
  assert.match(audienceIndex, /family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700;800;900&display=swap/);
  assert.match(css, /\.interaction-card \{[\s\S]+position: fixed;[\s\S]+width: min\(430px, calc\(100vw - 24px\)\);[\s\S]+background: var\(--immersa-glass\) !important;[\s\S]+border-radius: 22px;/);
  assert.equal((css.match(/\.interaction-card::before \{/g) || []).length, 1);
  assert.match(css, /\.interaction-card \{[\s\S]+border-top-width: 0 !important;/);
  assert.match(css, /\.interaction-card::before \{[\s\S]+z-index: 2;[\s\S]+top: 0 !important;[\s\S]+height: 3px;[\s\S]+margin: 0;[\s\S]+background: var\(--immersa-gradient\);[\s\S]+pointer-events: none;/);
  assert.match(css, /\.interaction-card h2 \{\n  display: none !important;\n\}/);
  assert.match(css, /\.interaction-card p \{[\s\S]+font-family: Poppins, Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-weight: 700;[\s\S]+overflow-wrap: anywhere;/);
  assert.match(css, /\.interaction-card button\.interaction-option \{[\s\S]+min-height: 52px;[\s\S]+border-radius: 14px !important;[\s\S]+background: rgba\(255, 255, 255, \.055\);/);
  assert.match(css, /\.interaction-card button\.interaction-option\.is-selected \{[\s\S]+border: 1\.5px solid transparent !important;[\s\S]+var\(--immersa-gradient\) border-box !important;/);
  assert.match(css, /\.interaction-card button\.interaction-option\.is-selected::after \{[\s\S]+content: "✓";[\s\S]+border-radius: 50%;[\s\S]+background: var\(--immersa-gradient\);/);
  assert.match(css, /\.interaction-card button\.interaction-option\.is-selected:disabled \{\n  opacity: 1;\n\}/);
  assert.match(css, /\.interaction-card \.interaction-card-actions \.primary \{[\s\S]+background: var\(--immersa-gradient\) !important;/);
  assert.match(css, /\.interaction-card \.interaction-accepted \{\n  display: none !important;\n\}/);
  assert.match(topActions, /id="snapshot"[\s\S]+id="fullscreen"/);
  assert.match(topActions.trim(), /<button id="fullscreen" class="icon-action fullscreen-button" type="button" aria-pressed="false" aria-label="Pantalla completa" title="Pantalla completa">[\s\S]+class="fullscreen-expand-icon"[\s\S]+class="fullscreen-collapse-icon"[\s\S]+<\/button>$/);
  assert.match(topActions, /<button id="snapshot"[\s\S]+<svg viewBox="0 0 24 24" aria-hidden="true">[\s\S]*<path d="M9 5 7\.5 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2\.5L15 5H9Z"><\/path>[\s\S]*<circle cx="12" cy="13" r="3\.25"><\/circle>[\s\S]*<\/svg>/);
  assert.doesNotMatch(topActions, /📷/);
  assert.match(css, /\.snapshot svg \{[\s\S]+width: 20px;[\s\S]+height: 20px;[\s\S]+fill: none;[\s\S]+stroke: currentColor;[\s\S]+stroke-width: 1\.8;/);
  assert.match(audienceSource, /Respuesta enviada/);
  assert.equal(selectedBlocks.some((block) => /linear-gradient\(180deg, rgba\(111,247,232,1\), rgba\(62,202,191,\.98\)\)/.test(block)), false);
});


test("poll home CTA uses the existing Speaker rocket SVG", () => {
  const presenterHtml = fs.readFileSync(path.join(__dirname, "..", "public/presenter/index.html"), "utf8");
  const rocket = presenterHtml.match(/<svg class="interaction-rocket-icon"[\s\S]+?<\/svg>/)[0].replace('class="interaction-rocket-icon"', 'class="interaction-launch-rocket"').replace(/\s*\n\s*/g, "");
  const presenter = fs.readFileSync(path.join(__dirname, "..", "public/presenter/presenter.js"), "utf8");
  const stage = fs.readFileSync(path.join(__dirname, "..", "public/stage/stage.js"), "utf8");
  assert.match(presenter, /interactionLaunchRocketMarkup/);
  assert.match(stage, /interactionLaunchRocketMarkup/);
  assert.equal(presenter.includes(rocket), true);
  assert.equal(stage.includes(rocket), true);
  assert.match(presenter, /interactionLaunchRocketMarkup \+ '<span>Lanzar encuesta<\/span>/);
  assert.match(stage, /interactionLaunchRocketMarkup \+ '<span>Lanzar encuesta<\/span>/);
});


test("hidden interaction categories cannot remain visible as dead buttons", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions.css"), "utf8");
  assert.match(css, /\[data-interactions-category\]\[hidden\][\s\S]*display: none !important/);
});
