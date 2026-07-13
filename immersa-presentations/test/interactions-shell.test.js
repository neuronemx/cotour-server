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
  matches(selector){ if(selector.startsWith(".")) return this.classList.contains(selector.slice(1)); const data=selector.match(/^\[data-([^\]]+)\]$/); if(data){ const key=data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase()); return Object.prototype.hasOwnProperty.call(this.dataset,key); } return false; }
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
