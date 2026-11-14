const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

test("Stage uses a nonmodal folding panel, retains its video and keeps live actions accessible", async () => {
  const created = [], handlers = new Map(), sent = [];
  function element(tag = "div") {
    const children = new Map();
    const node = { tag, hidden: false, attributes: {}, children: [], classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector(selector) { if (!children.has(selector)) children.set(selector, element(selector)); return children.get(selector); },
      append(...nodes) { this.children.push(...nodes); },
      before(node) { this.insertedBefore = node; },
      addEventListener() {}
    };
    created.push(node);
    return node;
  }
  const toolbar = element();
  const body = element(); body.dataset = {};
  const socket = { connected: true, on: (name, fn) => handlers.set(name, fn), emit: (...args) => sent.push(args),
    timeout() { return this; }, async emitWithAck(...args) { sent.push(args); return { ok: true }; } };
  runInNewContext(client, {
    window: { IMMERSA_ROLE_OPEN: { role: "stage", access_token: "a_stage00001" }, addEventListener() {} },
    document: { body, createElement: element, querySelector: () => toolbar }, io: () => socket
  });
  const panel = created.find(node => node.tag === "aside");
  const compact = created.find(node => node.className === "guest-stage-compact");
  const open = toolbar.children[0];
  assert.ok(panel);
  assert.equal(created.some(node => node.tag === "dialog"), false);
  assert.equal(panel.hidden, true);
  open.onclick();
  assert.equal(panel.hidden, false);
  const video = panel.querySelector("video");
  const stream = {}; video.srcObject = stream;
  handlers.get("guest:state")({ phase: "live", guestName: "Arquitecto", id: undefined });
  assert.equal(panel.hidden, true);
  assert.equal(video.srcObject, stream);
  assert.equal(compact.querySelector("[data-status]").textContent, "Arquitecto · LIVE");
  compact.querySelector("[data-wait]").onclick();
  await flush();
  assert.ok(sent.some(([event]) => event === "guest:wait"));
  compact.querySelector("[data-mute]").onclick();
  assert.ok(sent.some(([event]) => event === "guest:mute"));
  compact.querySelector("[data-expand]").onclick();
  assert.equal(panel.hidden, false);
  assert.equal(video.srcObject, stream);
  panel.querySelector("[data-close]").onclick();
  assert.equal(panel.hidden, true);
  assert.equal(video.srcObject, stream);
  assert.equal(sent.some(([event]) => event === "guest:end"), false);
});
