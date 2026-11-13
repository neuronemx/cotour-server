const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

function mount({ shared = false, unlocked = false } = {}) {
  const nodes = [];
  const listeners = new Map();
  const handlers = new Map();
  const sent = [];
  let observe;
  let resumes = 0;
  function element() {
    const node = {
      dataset: {}, isConnected: false,
      classList: { toggle() {}, remove() {} },
      style: { setProperty() {}, removeProperty() {} },
      addEventListener() {},
      querySelector: () => element(),
      append(child) { child.isConnected = true; child.parentElement = this; },
      remove() { this.isConnected = false; },
      closest() { return this; }
    };
    nodes.push(node);
    return node;
  }
  const host = element();
  const addShared = () => {
    const button = element();
    button.dataset.immersaMediaUnlock = "1";
    host.append(button);
    return button;
  };
  const original = shared ? addShared() : null;
  const document = {
    body: { dataset: {} },
    getElementById: () => host,
    createElement: element,
    querySelectorAll: () => nodes.filter(node => node.isConnected && node.dataset.immersaMediaUnlock && !node.hidden),
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    dispatchEvent(event) { for (const handler of listeners.get(event.type) || []) handler(event); }
  };
  const window = {
    IMMERSA_ROLE_OPEN: { role: "screen", access_token: "a_screen0001" },
    __immersaMediaUnlocked: unlocked,
    AudioContext: class { async resume() { resumes++; } },
    addEventListener() {}
  };
  const socket = { connected: true, on: (name, handler) => handlers.set(name, handler), emit: (...args) => sent.push(args) };
  runInNewContext(client, {
    window, document, io: () => socket,
    MutationObserver: class { constructor(callback) { observe = callback; } observe() {} disconnect() {} },
    Event: class { constructor(type) { this.type = type; } }
  });
  return { original, host, addShared, window, sent, observe: () => observe(), resumes: () => resumes,
    buttons: () => document.querySelectorAll(),
    click: button => document.dispatchEvent({ type: "click", target: button }) };
}

test("the existing Screen audio button also prepares LIVE guests without being removed by guests", async () => {
  const app = mount({ shared: true });
  assert.equal(app.buttons().length, 1);
  app.click(app.original);
  await flush();
  assert.equal(app.original.isConnected, true);
  assert.equal(app.window.__immersaMediaUnlocked, true);
  assert.equal(app.sent.filter(([event]) => event === "guest:media-ready").length, 1);
  assert.ok(app.resumes() >= 1);
});

test("a shared button arriving later replaces the guest fallback and remains the only audio button", async () => {
  const app = mount();
  const fallback = app.buttons()[0];
  assert.equal(fallback.parentElement, app.host);
  const shared = app.addShared();
  app.observe();
  assert.equal(fallback.isConnected, false);
  assert.deepEqual(app.buttons(), [shared]);
  app.click(shared);
  await flush();
  assert.equal(app.sent.filter(([event]) => event === "guest:media-ready").length, 1);
});

test("the fallback unlocks shared audio and guests together, and prior activation needs no second button", async () => {
  const fresh = mount();
  assert.equal(fresh.buttons().length, 1);
  fresh.click(fresh.buttons()[0]);
  await flush();
  assert.equal(fresh.buttons().length, 0);
  assert.equal(fresh.window.__immersaMediaUnlocked, true);
  assert.equal(fresh.sent.filter(([event]) => event === "guest:media-ready").length, 1);
  const active = mount({ unlocked: true });
  await flush();
  assert.equal(active.buttons().length, 0);
  assert.equal(active.sent.filter(([event]) => event === "guest:media-ready").length, 1);
});
