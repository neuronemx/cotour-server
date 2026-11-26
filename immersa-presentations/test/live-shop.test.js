const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { createCatalogStore, productsForClient } = require("../live-shop-catalog");
const { createLiveShopRuntime } = require("../live-shop-runtime");
const { liveShopDemoEnabled, liveShopEnabled, liveShopTester } = require("../live-shop-config");

test("only allowlisted test accounts can manage Shop in the isolated environment", () => {
  const env = { RAILWAY_ENVIRONMENT_ID: "demo", IMMERSA_LIVE_SHOP_ENVIRONMENT_ID: "demo", IMMERSA_LIVE_SHOP_TEST_EMAILS: "test@example.test" };
  assert.equal(liveShopTester({ id: "user", email: "Test@example.test" }, env), true);
  assert.equal(liveShopTester({ id: "other", email: "other@example.test" }, env), false);
  assert.equal(liveShopTester({ id: "user", email: "test@example.test" }, { ...env, RAILWAY_ENVIRONMENT_ID: "beta" }), false);
});

test("Beta enables Shop only for allowlisted accounts and keeps regular account registration", async () => {
  const { createBetterAuthOptions } = await import("../auth/better-auth-runtime.mjs");
  const env = {
    RAILWAY_ENVIRONMENT_ID: "9ae7d5ba-2954-4c96-818a-ee918310e20d",
    IMMERSA_LIVE_SHOP_BETA_ENABLED: "true",
    IMMERSA_LIVE_SHOP_TEST_EMAILS: "test@example.test",
    BETTER_AUTH_URL: "https://beta.immersalive.com",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-better-auth",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret"
  };
  assert.equal(liveShopEnabled(env), true);
  assert.equal(liveShopEnabled({ ...env, IMMERSA_LIVE_SHOP_BETA_ENABLED: "" }), false);
  for (const otherEnvironment of ["04b64c27-8737-4aae-82d2-1ad5be5d7641", "11fb839f-df6f-4ca8-93e6-3a1405649531"]) {
    assert.equal(liveShopEnabled({ ...env, RAILWAY_ENVIRONMENT_ID: otherEnvironment }), false);
  }
  assert.equal(liveShopDemoEnabled({ ...env, IMMERSA_LIVE_SHOP_ENVIRONMENT_ID: env.RAILWAY_ENVIRONMENT_ID }), false);
  assert.equal(liveShopTester({ id: "tester", email: "test@example.test" }, env), true);
  assert.equal(liveShopTester({ id: "other", email: "other@example.test" }, env), false);

  const options = createBetterAuthOptions({ env, database: {}, emailSender: async () => {} });
  assert.equal(options.emailAndPassword.disableSignUp, undefined);
  assert.equal(options.emailAndPassword.requireEmailVerification, true);
  assert.equal(options.socialProviders.google.clientId, env.GOOGLE_CLIENT_ID);
});

test("the editable catalog persists changes per Deck, protects hidden images and rejects stale saves", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "immersa-shop-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const changes = [];
  const store = createCatalogStore({ root, onChange: (deckId, config) => changes.push([deckId, config.revision]) });
  const before = await store.read("deck-a");
  const buffer = await fs.readFile(path.join(__dirname, "../public/live-shop/images/termo.webp"));
  const config = await store.save("deck-a", null, {
    name: "Botella", description: "Azul", price: "189.39", visible: "false", revision: before.revision
  }, { buffer, originalname: "botella.webp", mimetype: "image/webp" });
  assert.equal(config.products.length, 4);
  assert.equal(config.products[3].priceCents, 18939);
  assert.equal(productsForClient("deck-a", config).length, 3);
  const newProduct = config.products[3];
  await assert.rejects(store.imagePath("deck-a", newProduct.image), { status: 404 });
  assert.equal(path.basename(await store.imagePath("deck-a", newProduct.image, { owner: true })), newProduct.image);
  await assert.rejects(store.remove("deck-a", "curso", { revision: before.revision }), { status: 409 });
  const ids = config.products.map(product => product.id).reverse();
  const order = await store.reorder("deck-a", { revision: config.revision, ids });
  assert.deepEqual(order.products.map(product => product.id), ids);
  await store.remove("deck-a", newProduct.id, { revision: order.revision });
  assert.equal((await store.read("deck-a")).products.length, 3);
  assert.deepEqual(await store.read("deck-b"), before);
  assert.deepEqual(changes, [["deck-a", 1], ["deck-a", 2], ["deck-a", 3]]);
});

function harness() {
  const sent = [];
  const sessions = new Map();
  const runtime = createLiveShopRuntime({
    io: { to: room => ({ emit: (event, payload) => sent.push({ room, event, payload }) }) },
    enabled: () => true,
    store: { read: async () => ({ revision: 0, products: [{ id: "book", name: "Libro", priceCents: 1000, visible: true, image: "libro" }] }) },
    getSession: key => sessions.get(key),
    authorize: async (_socket, _context, token) => token === "allowed",
    touch() {},
    celebrationGap: 0
  });

  async function client(role, roomKey = "room-a", token = "allowed") {
    if (!sessions.has(roomKey)) sessions.set(roomKey, { deckId: roomKey, audience: new Map() });
    const session = sessions.get(roomKey);
    const audienceId = randomUUID();
    const listeners = new Map();
    const socket = {
      id: randomUUID(), connected: true,
      on: (event, handler) => listeners.set(event, handler),
      emit: (event, payload) => sent.push({ room: audienceId, event, payload }),
      join() {}, leave() {}
    };
    if (role === "audience") session.audience.set(audienceId, { name: "Ada", socketId: socket.id });
    const context = { role, roomKey, deckId: roomKey, audienceId, audienceName: role === "audience" ? "Ada" : "" };
    await runtime.attach(socket, () => context).join(context, token);
    return {
      session,
      control: (action, value) => new Promise(ack => listeners.get("live-shop:control")({ action, value }, ack)),
      buy: payload => new Promise(ack => listeners.get("live-shop:purchase")(payload, ack))
    };
  }
  return { runtime, sent, client };
}

test("simulations validate the active session and products and count a retried purchase once", async () => {
  const h = harness();
  const speaker = await h.client("presenter");
  const unauthenticated = await h.client("presenter", "room-a", "wrong-token");
  const audience = await h.client("audience");
  const other = await h.client("audience", "room-b");
  const state = audience.session.liveShop;
  const order = { requestId: randomUUID(), instance: state.instance, lines: [{ id: "book", quantity: 3 }] };
  assert.equal((await unauthenticated.control("toggle", true)).ok, false);
  assert.equal((await audience.buy(order)).ok, false);
  assert.equal((await speaker.control("toggle", true)).ok, true);
  assert.equal((await audience.buy({ ...order, lines: [{ id: "hidden", quantity: 1 }] })).ok, false);
  assert.equal((await other.buy(order)).ok, false);
  assert.equal((await audience.buy(order)).ok, true);
  assert.equal((await audience.buy(order)).ok, true);
  assert.equal(state.count, 1);
  assert.equal(other.session.liveShop.count, 0);
  assert.deepEqual(h.sent.find(message => message.event === "live-shop:celebration"), {
    room: "room-a::live-shop:screen", event: "live-shop:celebration",
    payload: { name: "Ada", milestone: null, duration: 2800, sound: false }
  });
  assert.equal((await speaker.control("toggle", false)).ok, true);
  assert.equal((await audience.buy(order)).ok, true);
  assert.equal((await audience.buy({ ...order, requestId: randomUUID() })).ok, false);
  h.runtime.resetSession({ roomKey: "room-a" });
  assert.notEqual(audience.session.liveShop.instance, order.instance);
  assert.equal((await audience.buy(order)).ok, false);
});

test("celebrations are spaced, honor sound and visibility, and show the three milestones", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  const speaker = await h.client("presenter");
  const milestones = () => h.sent.filter(message => message.event === "live-shop:celebration").map(message => message.payload);
  await speaker.control("sound", true);
  for (const value of [10, 50, 100]) await speaker.control("milestone", value);
  assert.deepEqual(milestones().map(item => item.milestone), [10]);
  t.mock.timers.tick(4200);
  t.mock.timers.tick(4200);
  assert.deepEqual(milestones().map(item => item.milestone), [10, 50, 100]);
  assert.ok(milestones().every(item => item.sound));
  await speaker.control("celebrations", false);
  await speaker.control("test");
  t.mock.timers.tick(5000);
  assert.equal(milestones().length, 3);
  assert.equal(speaker.session.liveShop.count, 101);
  await speaker.control("reset");
  assert.equal(speaker.session.liveShop.count, 0);
});

test("Shop chooses a product color over the photo backdrop and never uses a white button", () => {
  const { dominantColor, buttonColors } = require("../public/live-shop/storefront-color");
  const createPhoto = (backdrop, product) => {
    const pixels = new Uint8ClampedArray(20 * 20 * 4);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const color = x >= 5 && x < 15 && y >= 5 && y < 15 ? product : backdrop;
        pixels.set(color, (y * 20 + x) * 4);
      }
    }
    return pixels;
  };
  const blue = [27, 97, 179, 255];
  assert.deepEqual(dominantColor(createPhoto([252, 251, 247, 255], blue), 20, 20), blue.slice(0, 3));
  assert.deepEqual(dominantColor(createPhoto([238, 163, 68, 255], blue), 20, 20), blue.slice(0, 3));
  assert.deepEqual(dominantColor(createPhoto([0, 0, 0, 0], blue), 20, 20), blue.slice(0, 3));
  const white = [255, 255, 255, 255];
  assert.equal(dominantColor(createPhoto(white, white), 20, 20), null);
  assert.equal(buttonColors(null).background, "rgb(34, 37, 35)");
  assert.equal(buttonColors([22, 45, 78]).foreground, "#fff");
  assert.equal(buttonColors([255, 165, 75]).foreground, "#000");
});
