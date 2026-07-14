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
  assert.equal(root.querySelector("[data-interactions-close]").hidden, false);
  category(root, "polls").click();
  assert.equal(shell.getView(), "polls");
  category(root, "raffles").click();
  assert.equal(shell.getView(), "raffles");
  category(root, "contests").click();
  category(root, "games").click();
  assert.deepEqual(selected, ["polls", "raffles"]);
  shell.setLocked(true);
  category(root, "polls").click();
  assert.equal(shell.getView(), "raffles");
  root.querySelector("[data-interactions-back]").click();
  assert.equal(shell.getView(), "raffles");
  shell.setLocked(false);
  root.querySelector("[data-interactions-back]").click();
  assert.equal(shell.getView(), "raffles");
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
  polls: { viewBox: "0 0 24 24", rects: [{ x: "3.5", y: "3.5", width: "17", height: "15", rx: "2" }], paths: ["M6 20.5h12M8 15v-4M12 15V8M16 15v-5M8 7h2"] },
  raffles: { viewBox: "0 0 24 24", rects: [], paths: ["M3 8h18v13H3zM3 8h18M12 8v13M7.5 8a2.5 2.5 0 1 1 0-5C9.2 3 10.6 4.5 12 8M16.5 8a2.5 2.5 0 1 0 0-5C14.8 3 13.4 4.5 12 8"] },
  contests: { viewBox: "0 0 24 24", rects: [], paths: ["M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a2 2 0 0 0 2 2M17 6h3a2 2 0 0 1-2 2"] },
  games: { viewBox: "0 0 24 24", rects: [{ x: "3", y: "6.5", width: "8", height: "13", rx: "2" }, { x: "13", y: "6.5", width: "8", height: "13", rx: "2" }], paths: ["M6.5 13h1.8M15.7 13h1.8"] }
};

test("interactions shell preserves the approved category contract", () => {
  const { root } = setup();
  const shell = Shell.create({ root });
  const categories = root.querySelectorAll("[data-interactions-category]");
  assert.deepEqual(categories.map((button) => button.dataset.interactionsCategory), ["polls", "raffles", "contests", "games"]);
  assert.deepEqual(categories.map((button) => button.querySelector(".interactions-shell-category-label")?.textContent), ["Encuestas", "Sorteos", "Concursos", "Juegos"]);
  assert.equal(root.querySelector(".interactions-shell-home").innerHTML, "<p>Selecciona una interacción.</p>");
  assert.equal(root.querySelectorAll("h2").length, 1);
  assert.equal(root.querySelector(".interactions-shell-title").textContent, "Interacciones");
  shell.setView("polls");
  assert.equal(root.querySelector(".interactions-shell-home").hidden, true);
  assert.equal(category(root, "contests").disabled, true);
  assert.equal(category(root, "games").disabled, true);
  assert.equal(category(root, "contests").tabIndex, -1);
  assert.equal(category(root, "games").tabIndex, -1);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions-shell.js"), "utf8"), /Próximamente/);
  for (const button of categories) {
    const expected = APPROVED_CATEGORY_ICONS[button.dataset.interactionsCategory];
    const svg = button.querySelector("svg");
    assert.equal(svg.getAttribute("viewBox"), expected.viewBox);
    assert.equal(svg.getAttribute("stroke-width"), "2");
    assert.equal(svg.getAttribute("stroke-linecap"), "round");
    assert.equal(svg.getAttribute("stroke-linejoin"), "round");
    assert.deepEqual(svg.querySelectorAll("rect").map((rect) => ({ x: rect.getAttribute("x"), y: rect.getAttribute("y"), width: rect.getAttribute("width"), height: rect.getAttribute("height"), rx: rect.getAttribute("rx") })), expected.rects);
    assert.deepEqual(svg.querySelectorAll("path").map((path) => path.getAttribute("d")), expected.paths);
  }
  assert.equal(root.querySelectorAll("[data-interactions-close]").length, 1);
  assert.equal(root.querySelector("[data-interactions-close]").hidden, false);
  shell.setLocked(true);
  assert.equal(root.querySelector("[data-interactions-close]").hidden, true);
  assert.equal(categories.every((button) => button.disabled), true);
});

test("shared interactions css exposes critical visual contract tokens", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions.css"), "utf8");
  assert.match(css, /--immersa-gradient: linear-gradient\(135deg, #7f77dd 0%, #378add 55%, #5dcaa5 100%\);/);
  assert.match(css, /--immersa-glass: linear-gradient\(160deg, rgba\(30, 26, 48, \.96\), rgba\(18, 16, 30, \.98\)\);/);
  assert.match(css, /font-family: Poppins, Inter/);
  assert.match(css, /width: min\(380px, calc\(100vw - 28px\)\);/);
  assert.match(css, /\.interactions-shell-nav \{[\s\S]+gap: 0;[\s\S]+background: rgba\(5, 8, 18, \.32\);/);
  assert.match(css, /\.interaction-panel::before \{[\s\S]+left: 18px;[\s\S]+right: 18px;[\s\S]+background: var\(--immersa-gradient\);/);
  assert.match(css, /\.interactions-native-shell::before,[\s\S]+content: none;/);
  assert.match(css, /\.interactions-shell-home \{[\s\S]+background: transparent;[\s\S]+border: 0;/);
  assert.match(css, /\.interactions-shell-category\.is-active \{[\s\S]+background: var\(--immersa-gradient\) !important;/);
  assert.match(css, /\.interactions-shell-home\[hidden\] \{[\s\S]+display: none !important;[\s\S]+min-height: 0;[\s\S]+padding: 0;/);
  assert.match(css, /\.interactions-shell-close \{[\s\S]+font-size: 14px !important;[\s\S]+font-weight: 300;/);
  assert.match(css, /\.interaction-choice-prompt \{[\s\S]+font-family: Inter, "Segoe UI", Arial, sans-serif;[\s\S]+font-weight: 400;/);
  assert.match(css, /\.interaction-panel button:hover:not\(:disabled\),[\s\S]+transform: none !important;/);
  assert.doesNotMatch(css, /:hover[^{}]*\{[^{}]*(?:translateY|scale)\(/);
});
