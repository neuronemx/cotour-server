const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { BrandMentionRuntime } = require("../brand-mention-runtime");
const { ActiveInteractionCoordinator } = require("../active-interaction-coordinator");

class FakeClock {
  constructor() {
    this.nowMs = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout(fn, delay) {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.nowMs + delay, fn });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  async advance(ms) {
    const target = this.nowMs + ms;
    while (true) {
      const next = Array.from(this.timers.values())
        .filter((timer) => timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.timers.delete(next.id);
      this.nowMs = next.at;
      await next.fn();
    }
    this.nowMs = target;
  }
}

class FakeCoordinator {
  constructor() {
    this.active = false;
    this.listeners = new Set();
  }

  hasAnyActive() {
    return this.active;
  }

  subscribeActivity(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async setActive(sessionId, active) {
    this.active = active;
    await Promise.all(Array.from(this.listeners).map((listener) => listener({ sessionId, active })));
  }
}

function brand(id, order, active = true) {
  return {
    id,
    order,
    active,
    name: "Marca " + id,
    pitch: "Pitch " + id,
    target_url: "https://" + id + ".example/",
    display_domain: id + ".example",
    logo: { src: "/decks/deck-a/brand-assets/" + id + ".png", file_name: id + ".png" }
  };
}

function fixture(brands = [brand("a", 1), brand("b", 2)]) {
  const clock = new FakeClock();
  const coordinator = new FakeCoordinator();
  const events = [];
  const io = { to: (room) => ({ emit: (event, payload) => events.push({ room, event, payload, at: clock.nowMs }) }) };
  const store = { read: async () => ({ brands }) };
  const runtime = new BrandMentionRuntime({
    io,
    store,
    coordinator,
    getRoleRoomKey: (roomKey, role) => roomKey + "::" + role,
    now: () => clock.nowMs,
    setTimeoutFn: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeoutFn: (id) => clock.clearTimeout(id),
    intervalMs: 120000,
    displayMs: 8000
  });
  const context = { roomKey: "session-a::deck-a", sessionId: "session-a", deckId: "deck-a", role: "audience" };
  return { clock, coordinator, events, runtime, context };
}

test("mentions rotate in active order after 120 seconds and hide after 8 seconds", async () => {
  const { clock, events, runtime, context } = fixture();
  assert.equal(await runtime.start(context), true);
  await clock.advance(119999);
  assert.equal(events.length, 0);
  await clock.advance(1);
  assert.equal(events[0].room, "session-a::deck-a::audience");
  assert.equal(events[0].event, "brand_mention:show");
  assert.equal(events[0].payload.id, "a");
  assert.equal(events[0].payload.visible_until, 128000);
  assert.deepEqual(Object.keys(events[0].payload).sort(), ["display_domain", "id", "logo_src", "name", "pitch", "shown_at", "target_url", "visible_until"]);
  await clock.advance(8000);
  assert.equal(events[1].event, "brand_mention:hide");
  await clock.advance(112000);
  assert.equal(events[2].event, "brand_mention:show");
  assert.equal(events[2].payload.id, "b");
  assert.equal(events.every((entry) => entry.room.endsWith("::audience")), true);
});

test("an active interaction hides the current mention and restarts a full interval after closing", async () => {
  const { clock, coordinator, events, runtime, context } = fixture();
  await runtime.start(context);
  await clock.advance(120000);
  assert.equal(events.at(-1).event, "brand_mention:show");
  await coordinator.setActive("session-a", true);
  assert.equal(events.at(-1).event, "brand_mention:hide");
  await clock.advance(60000);
  assert.equal(events.filter((entry) => entry.event === "brand_mention:show").length, 1);
  await coordinator.setActive("session-a", false);
  await clock.advance(119999);
  assert.equal(events.filter((entry) => entry.event === "brand_mention:show").length, 1);
  await clock.advance(1);
  assert.equal(events.at(-1).event, "brand_mention:show");
  assert.equal(events.at(-1).payload.id, "b");
});

test("late Público receives the one current mention while other roles receive nothing", async () => {
  const { clock, runtime, context } = fixture();
  await runtime.start(context);
  await clock.advance(120000);
  const audienceEvents = [];
  const screenEvents = [];
  assert.equal(runtime.sendCurrentState({ emit: (...args) => audienceEvents.push(args) }, { ...context, role: "audience" }), true);
  assert.equal(runtime.sendCurrentState({ emit: (...args) => screenEvents.push(args) }, { ...context, role: "screen" }), false);
  assert.equal(audienceEvents[0][0], "brand_mention:show");
  assert.deepEqual(screenEvents, []);
});

test("a brand activated after Público joins is discovered by the running cycle", async () => {
  const brands = [brand("late", 1, false)];
  const { clock, events, runtime, context } = fixture(brands);
  assert.equal(await runtime.start(context), true);
  assert.equal(clock.timers.size, 1);

  await clock.advance(120000);
  assert.deepEqual(events, []);
  assert.equal(clock.timers.size, 1);

  brands[0].active = true;
  await clock.advance(120000);
  assert.equal(events.at(-1).event, "brand_mention:show");
  assert.equal(events.at(-1).payload.id, "late");
});

test("ActiveInteractionCoordinator publishes activity boundary changes", async () => {
  const interactionState = { active: null };
  const coordinator = new ActiveInteractionCoordinator({
    interactionStore: { getSession: () => interactionState },
    raffleStore: { getActive: () => null }
  });
  const snapshots = [];
  const unsubscribe = coordinator.subscribeActivity((snapshot) => snapshots.push(snapshot));
  await coordinator.withSessionLock("session-a", () => {
    interactionState.active = { id: "poll-a" };
    return { ok: true };
  });
  interactionState.active = null;
  coordinator.notifyActivityChange("session-a");
  unsubscribe();
  coordinator.notifyActivityChange("session-a");
  assert.deepEqual(snapshots, [
    { sessionId: "session-a", active: true },
    { sessionId: "session-a", active: false }
  ]);
});

test("Público loads a clickable reduced-motion card and Screen stays untouched", () => {
  const audienceHtml = fs.readFileSync(path.join(__dirname, "..", "public/audience/index.html"), "utf8");
  const screenHtml = fs.readFileSync(path.join(__dirname, "..", "public/screen/index.html"), "utf8");
  const client = fs.readFileSync(path.join(__dirname, "..", "public/audience/brand-mention.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "public/audience/brand-mention.css"), "utf8");
  const linkIcon = path.join(__dirname, "..", "public/audience/external-link.png");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

  assert.match(audienceHtml, /brand-mention\.css\?v=6/);
  assert.match(audienceHtml, /brand-mention\.js\?v=5/);
  assert.doesNotMatch(screenHtml, /brand-mention/i);
  assert.match(client, /target = "_blank"/);
  assert.match(client, /rel = "noopener noreferrer"/);
  assert.match(client, /brand_mention:show/);
  assert.match(client, /brand_mention:hide/);
  assert.match(client, /sponsor\.textContent = "Con la colaboración de"/);
  assert.doesNotMatch(client, /eyebrow\.textContent = "Mención de marca"/);
  assert.match(client, /pitch\.className = "brand-mention-card-pitch"/);
  assert.match(client, /linkRow\.append\(domain, arrow\)/);
  assert.match(client, /arrow\.src = "\/audience\/external-link\.png"/);
  assert.match(client, /document\.getElementById\("viewer"\)/);
  assert.match(client, /container\.getBoundingClientRect\?\.\(\)/);
  assert.match(client, /function matchLogoSurface/);
  assert.match(client, /--brand-logo-surface/);
  assert.equal(fs.existsSync(linkIcon), true);
  assert.match(css, /transform 1\.25s/);
  assert.match(css, /translate3d\(-50%, calc\(-100% - 24px\), 0\)/);
  assert.match(css, /\.brand-mention-host\.is-exiting/);
  assert.match(css, /transition: opacity \.72s ease-in-out/);
  assert.match(css, /-webkit-line-clamp: 2/);
  assert.match(css, /\.brand-mention-card-logo \{[\s\S]*?align-self: stretch/);
  assert.match(css, /z-index: 50/);
  assert.match(css, /background: var\(--brand-logo-surface, #fff\)/);
  assert.match(css, /\.brand-mention-card-link/);
  assert.match(css, /justify-self: center/);
  assert.match(css, /color: #19b9f2/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(server, /if \(role === "audience"\) \{[\s\S]*brandMentionRuntime\.start\(joinedContext\)/);
  assert.match(server, /then\(\(\) => brandMentionRuntime\.sendCurrentState\(socket, joinedContext\)\)/);
  assert.doesNotMatch(server, /if \(role === "presenter"\) \{[\s\S]{0,180}brandMentionRuntime\.start/);
  assert.match(server, /if \(session\.audience\.size === 0\) brandMentionRuntime\.stop\(currentRoomKey\)/);
  assert.doesNotMatch(server, /session\.presenterConnected = false;[\s\S]{0,120}brandMentionRuntime\.stop/);
  assert.doesNotMatch(client, /\bQR\b|\bScreen\b/);
});
