const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

function mount() {
  const elements = new Map();
  const handlers = new Map();
  const images = [];
  const tracks = [{ readyState: "live", stop() { this.readyState = "ended"; } }];
  const stream = { getTracks: () => tracks };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, dataset: {}, events: new Map(),
      parentElement: { classList: { toggle() {} } },
      classList: { toggle() {} },
      addEventListener(name, fn) { this.events.set(name, fn); },
      removeAttribute(name) { delete this[name]; },
      async play() {}
    });
    return elements.get(id);
  }
  const socket = { connected: true, on: (name, handler) => handlers.set(name, handler), emit() {} };
  runInNewContext(client, {
    window: { AudioContext: class { async resume() {} }, addEventListener() {} },
    document: { body: { dataset: { liveGuest: "true" } }, getElementById: element },
    location: { pathname: "/guest/test" },
    navigator: { mediaDevices: { async getUserMedia() { return stream; } } },
    io: () => socket,
    Image: class { constructor() { images.push(this); } }
  });
  return { element, socket, images, tracks, receive: (name, payload) => handlers.get(name)(payload),
    async enter() { element("guestEnter").events.get("click")(); await flush(); } };
}

test("the guest sees synchronized slides in waiting and live after a single entry, with no new controls", async () => {
  const app = mount();
  app.receive("guest:slide", { src: "/decks/deck/slides/1.jpg", index: 0 });
  assert.equal(app.images.length, 0);
  await app.enter();
  assert.equal(app.element("guestEnter").hidden, true);
  assert.equal(app.element("guestSlideView").hidden, false);
  app.receive("guest:slide", { src: "/decks/deck/slides/1.jpg", index: 0, title: "Primero" });
  app.images[0].onload();
  assert.equal(app.element("guestSlide").src, "/decks/deck/slides/1.jpg");
  assert.equal(app.element("guestSlide").alt, "Primero");
  app.receive("guest:state", { phase: "live", id: null });
  assert.equal(app.element("guestState").textContent, "EN VIVO");
  assert.equal(app.element("guestSlide").hidden, false);
  assert.equal(app.element("guestPreview").srcObject.getTracks()[0].readyState, "live");
});

test("rapid navigation, failed images, disconnection and ending cannot reveal an outdated slide", async () => {
  const app = mount();
  await app.enter();
  app.receive("guest:slide", { src: "/decks/deck/slides/1.jpg", index: 0 });
  app.receive("guest:slide", { src: "/decks/deck/slides/2.jpg", index: 1 });
  app.images[1].onload();
  app.images[0].onload();
  assert.equal(app.element("guestSlide").dataset.slideIndex, "1");
  app.receive("guest:slide", { src: "/decks/deck/slides/missing.jpg", index: 2 });
  app.images[2].onerror();
  assert.equal(app.element("guestSlide").hidden, true);
  assert.equal(app.element("guestSlidePlaceholder").hidden, false);
  app.receive("guest:slide", { src: "/decks/deck/slides/3.jpg", index: 2 });
  app.socket.connected = false;
  app.receive("disconnect");
  app.images[3].onload();
  assert.equal(app.element("guestSlide").hidden, true);
  app.socket.connected = true;
  app.receive("connect");
  app.receive("guest:slide", { src: "/decks/deck/slides/4.jpg", index: 3 });
  app.images[4].onload();
  assert.equal(app.element("guestSlide").dataset.slideIndex, "3");
  app.receive("guest:slide", { src: "/decks/deck/slides/5.jpg", index: 4 });
  app.receive("guest:state", { phase: "ended", id: null });
  app.images[5].onload();
  assert.equal(app.element("guestSlide").hidden, true);
  assert.equal(app.element("guestVisual").hidden, true);
  assert.equal(app.element("guestState").textContent, "ENLACE TERMINADO");
  assert.equal(app.element("guestPreview").srcObject, null);
  assert.equal(app.tracks[0].readyState, "ended");
});
