const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { runInNewContext } = require("node:vm");
const { setImmediate: flush } = require("node:timers/promises");
const client = readFileSync(resolve(__dirname, "../public/live-guests/client.js"), "utf8");

function mount(contentApi) {
  const elements = new Map();
  const handlers = new Map();
  const images = [];
  const tracks = [{ readyState: "live", enabled: true, stop() { this.readyState = "ended"; } }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, dataset: {}, events: new Map(),
      parentElement: { classList: { toggle() {} } },
      classList: { toggle() {} },
      addEventListener(name, fn) { this.events.set(name, fn); },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      async play() {}
    });
    return elements.get(id);
  }
  const socket = { connected: true, on: (name, handler) => handlers.set(name, handler), emit() {} };
  runInNewContext(client, {
    window: { AudioContext: class { async resume() {} }, addEventListener() {}, ImmersaGuestContent: contentApi ? { create: () => contentApi } : undefined },
    document: { body: { dataset: { liveGuest: "true" }, classList: { toggle() {} } }, getElementById: element },
    location: { pathname: "/guest/test" },
    navigator: { mediaDevices: { async getUserMedia() { return stream; } } },
    io: () => socket,
    Image: class { constructor() { images.push(this); } }
  });
  return { element, socket, images, tracks, receive: (name, payload) => handlers.get(name)(payload),
    async enter() { element("guestEnter").events.get("click")(); await flush(); } };
}

test("the guest sees synchronized slides in waiting and live after a single entry", async () => {
  const app = mount();
  assert.equal(app.element("guestWelcome").hidden, false);
  assert.equal(app.element("guestVisual").hidden, true);
  assert.equal(app.element("guestCountdown").hidden, true);
  app.receive("guest:slide", { src: "/decks/deck/slides/1.jpg", index: 0 });
  assert.equal(app.images.length, 0);
  await app.enter();
  assert.equal(app.element("guestEnter").hidden, true);
  assert.equal(app.element("guestWelcome").hidden, true);
  assert.equal(app.element("guestVisual").hidden, false);
  assert.equal(app.element("guestHeader").hidden, true);
  assert.ok(app.element("guestMessage").textContent.includes("Estás en la SALA DE ESPERA."));
  assert.equal(app.element("guestSlideView").hidden, false);
  app.receive("guest:slide", { src: "/decks/deck/slides/1.jpg", index: 0, title: "Primero" });
  app.images[0].onload();
  assert.equal(app.element("guestSlide").src, "/decks/deck/slides/1.jpg");
  assert.equal(app.element("guestSlide").alt, "Primero");
  app.receive("guest:state", { phase: "live", id: null });
  assert.equal(app.element("guestState").textContent, "LIVE");
  assert.equal(app.element("guestLiveSticker").hidden, false);
  assert.equal(app.element("guestSlide").hidden, false);
  assert.equal(app.element("guestPreview").srcObject.getTracks()[0].readyState, "live");
});

test("a guest can mute for a cough and resume without stopping camera or resetting on state updates", async () => {
  const app = mount();
  await app.enter();
  const button = app.element("guestSelfMute");
  assert.equal(button.hidden, true);
  app.receive("guest:state", { phase: "live", id: null });
  assert.equal(button.hidden, false);
  button.events.get("click")();
  assert.equal(app.tracks[0].enabled, false);
  assert.equal(app.tracks[0].readyState, "live");
  assert.equal(button.textContent, "Activar micrófono");
  assert.equal(button["aria-pressed"], "true");
  app.receive("guest:state", { phase: "live", id: null, muted: true });
  assert.equal(app.tracks[0].enabled, false);
  button.events.get("click")();
  assert.equal(app.tracks[0].enabled, true);
  assert.equal(button["aria-pressed"], "false");
  assert.equal(app.element("guestPreview").srcObject.getTracks()[0].readyState, "live");
  button.events.get("click")();
  app.receive("guest:state", { phase: "ready", id: null });
  assert.equal(button.hidden, false);
  assert.equal(app.tracks[0].enabled, false);
  button.events.get("click")();
  assert.equal(app.tracks[0].enabled, true);
  assert.equal(button.hidden, true);
  app.receive("guest:state", { phase: "ended", id: null });
  assert.equal(button.hidden, true);
  assert.equal(app.element("guestHeader").hidden, false);
});

test("polls and reactions render only after entry and are cleared on disconnection or end", async () => {
  const polls = [], reactions = [];
  let cleared = 0;
  const app = mount({ setResults: value => polls.push(value), react: value => reactions.push(value), clear: () => cleared++ });
  const results = { title: "Results" };
  app.receive("guest:content", { results });
  app.receive("guest:reaction", { emoji: "❤️" });
  assert.equal(polls.length, 0);
  assert.equal(reactions.length, 0);
  await app.enter();
  app.receive("guest:content", { results });
  app.receive("guest:reaction", { emoji: "❤️" });
  assert.equal(polls[0], results);
  assert.equal(reactions.length, 1);
  app.socket.connected = false;
  app.receive("disconnect");
  assert.equal(cleared, 1);
  app.receive("guest:content", { results });
  assert.equal(polls.length, 1);
  app.socket.connected = true;
  app.receive("connect");
  app.receive("guest:content", { results: null });
  assert.equal(polls.at(-1), null);
  app.receive("guest:state", { phase: "ended", id: null });
  assert.equal(cleared, 2);
  app.receive("guest:reaction", { emoji: "🔥" });
  assert.equal(reactions.length, 1);
});

test("countdown covers the camera only during entry and LIVE clears it; waiting removes the sticker", async () => {
  const app = mount();
  await app.enter();
  for (const countdown of [3, 2, 1]) {
    app.receive("guest:state", { phase: "countdown", countdown, id: null });
    assert.equal(app.element("guestCountdown").hidden, false);
    assert.equal(app.element("guestState").textContent, String(countdown));
    assert.equal(app.element("guestLiveSticker").hidden, true);
  }
  app.receive("guest:state", { phase: "live", id: null });
  assert.equal(app.element("guestCountdown").hidden, true);
  assert.equal(app.element("guestLiveSticker").hidden, false);
  app.receive("guest:state", { phase: "ready", id: null });
  assert.equal(app.element("guestCountdown").hidden, true);
  assert.equal(app.element("guestLiveSticker").hidden, true);
  assert.ok(app.element("guestMessage").textContent.includes("SALA DE ESPERA"));
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
