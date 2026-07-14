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
  polls: { viewBox: "0 0 24 24", paths: ["M4 5.5h16", "M4 12h16", "M4 18.5h10", "M7 3.5v4", "M14 10v4", "M10 16.5v4"] },
  raffles: { viewBox: "0 0 24 24", paths: ["M5 9h14v11H5z", "M7 9V6.5A2.5 2.5 0 0 1 9.5 4 3.5 3.5 0 0 1 13 7.5V9", "M17 9V6.5A2.5 2.5 0 0 0 14.5 4 3.5 3.5 0 0 0 11 7.5V9", "M12 9v11", "M5 13h14"] },
  contests: { viewBox: "0 0 24 24", paths: ["M8 4h8v4a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 3", "M16 6h3a3 3 0 0 1-3 3", "M12 12v5", "M9 20h6", "M10 17h4"] },
  games: { viewBox: "0 0 24 24", paths: ["M7.5 10h9a4.5 4.5 0 0 1 4.12 6.32 2.05 2.05 0 0 1-3.25.57L15 14.5H9l-2.37 2.39a2.05 2.05 0 0 1-3.25-.57A4.5 4.5 0 0 1 7.5 10z", "M8 12.5v4", "M6 14.5h4", "M16.5 13.25h.01", "M18.5 15.25h.01"] }
};

test("interactions shell preserves the approved category contract", () => {
  const { root } = setup();
  const shell = Shell.create({ root });
  const categories = root.querySelectorAll("[data-interactions-category]");
  assert.deepEqual(categories.map((button) => button.dataset.interactionsCategory), ["polls", "raffles", "contests", "games"]);
  assert.deepEqual(categories.map((button) => button.querySelector(".interactions-shell-category-label")?.textContent), ["Encuestas", "Sorteos", "Concursos", "Juegos"]);
  assert.equal(root.querySelector(".interactions-shell-home").innerHTML, "<p>Selecciona una interacción.</p>");
  assert.equal(category(root, "contests").disabled, true);
  assert.equal(category(root, "games").disabled, true);
  assert.equal(category(root, "contests").tabIndex, -1);
  assert.equal(category(root, "games").tabIndex, -1);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", "public/shared/interactions-shell.js"), "utf8"), /Próximamente/);
  for (const button of categories) {
    const expected = APPROVED_CATEGORY_ICONS[button.dataset.interactionsCategory];
    const svg = button.querySelector("svg");
    assert.equal(svg.getAttribute("viewBox"), expected.viewBox);
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
});
