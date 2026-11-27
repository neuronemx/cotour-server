const { randomUUID } = require("node:crypto");
const { productsForClient } = require("./live-shop-catalog");

const milestones = [10, 50, 100];
const maxQuantity = 99;
const queueLimit = 8;
const purchaseIdPattern = /^[a-f0-9-]{36}$/i;
const shopRoom = (roomKey, role) => roomKey + "::live-shop:" + role;

function createLiveShopRuntime({ io, enabled, store, getSession, authorize, touch, celebrationGap = 450 }) {
  function stateFor(session) {
    return session.liveShop ||= {
      instance: randomUUID(),
      active: false,
      revision: -1,
      products: [],
      count: 0,
      celebrations: true,
      sound: false,
      purchases: new Map(),
      queue: [],
      timer: null,
      toggleVersion: 0
    };
  }

  function snapshot(state, role) {
    if (role === "audience") {
      return { instance: state.instance, active: state.active, products: state.active ? state.products : [] };
    }
    return { active: state.active, count: state.count, celebrations: state.celebrations, sound: state.sound };
  }

  function publish(roomKey, state, roles) {
    for (const role of roles) {
      io.to(shopRoom(roomKey, role)).emit("live-shop:state", snapshot(state, role));
    }
  }

  function applyCatalog(state, deckId, catalog) {
    if (catalog.revision < state.revision) return;
    state.revision = catalog.revision;
    state.products = productsForClient(deckId, catalog);
  }

  function changeCatalog(roomKey, session, catalog) {
    const state = session.liveShop;
    if (!state) return;
    applyCatalog(state, session.deckId, catalog);
    if (state.active) publish(roomKey, state, ["audience"]);
  }

  function clearCelebrations(roomKey, state) {
    clearTimeout(state.timer);
    state.timer = null;
    state.queue.length = 0;
    io.to(shopRoom(roomKey, "screen")).emit("live-shop:clear");
  }

  function showNext(roomKey, state) {
    if (state.timer || !state.queue.length) return;
    const item = state.queue.shift();
    io.to(shopRoom(roomKey, "screen")).emit("live-shop:celebration", { ...item, sound: state.sound });
    state.timer = setTimeout(() => {
      state.timer = null;
      showNext(roomKey, state);
    }, item.duration + celebrationGap);
    state.timer.unref?.();
  }

  function celebrate(roomKey, state, name) {
    state.count++;
    publish(roomKey, state, ["presenter", "screen"]);
    if (!state.celebrations) return;
    const milestone = milestones.includes(state.count) ? state.count : null;
    if (state.queue.length >= queueLimit) {
      if (!milestone) return;
      const replace = state.queue.findIndex(item => !item.milestone);
      if (replace >= 0) state.queue.splice(replace, 1);
    }
    state.queue.push({ name, milestone, duration: milestone ? 4200 : 2800 });
    showNext(roomKey, state);
  }

  function resetSession({ roomKey }) {
    const session = getSession(roomKey);
    if (!session?.liveShop) return;
    clearCelebrations(roomKey, session.liveShop);
    session.liveShop = null;
    publish(roomKey, stateFor(session), ["audience", "presenter", "screen"]);
  }

  function attach(socket, getContext) {
    let binding = null;
    let pending = 0;

    function sendSnapshot(state, role) {
      socket.emit("live-shop:state", snapshot(state, role));
      if (role === "presenter") socket.emit("live-shop:authorized");
    }

    async function join(context, token) {
      if (!enabled()) return;
      const attempt = ++pending;
      if (binding && (binding.roomKey !== context.roomKey || binding.role !== context.role || binding.token !== token)) {
        socket.leave(shopRoom(binding.roomKey, binding.role));
        binding = null;
      }
      if (!["presenter", "audience", "screen"].includes(context.role)) return;
      if (!await authorize(socket, context, token)) return;
      const latest = getContext();
      if (attempt !== pending || !socket.connected || latest.roomKey !== context.roomKey || latest.role !== context.role) return;
      const session = getSession(context.roomKey);
      if (!session) return;
      binding = {
        roomKey: context.roomKey, role: context.role, token,
        audienceId: context.audienceId, audienceName: context.audienceName || ""
      };
      await socket.join(shopRoom(context.roomKey, context.role));
      sendSnapshot(stateFor(session), context.role);
    }

    function contextFor(role) {
      const context = getContext();
      if (!binding || binding.role !== role || context.role !== role || context.roomKey !== binding.roomKey) return null;
      const session = getSession(context.roomKey);
      if (!session?.liveShop || session.inactivityShutdownAt) return null;
      return { ...context, session, state: session.liveShop };
    }

    socket.on("live-shop:sync", () => {
      const context = binding && contextFor(binding.role);
      if (context) sendSnapshot(context.state, context.role);
    });

    socket.on("live-shop:control", async (payload, ack) => {
      if (typeof ack !== "function") return;
      const context = contextFor("presenter");
      if (!context || !payload) return ack({ ok: false, message: "Control de LIVE SHOP no autorizado." });
      const { roomKey, session, deckId, state } = context;
      const { action, value } = payload;
      try {
        if (action === "toggle" && typeof value === "boolean") {
          const version = ++state.toggleVersion;
          if (value) {
            const catalog = await store.read(deckId);
            if (session.liveShop !== state || version !== state.toggleVersion || !contextFor("presenter")) {
              return ack({ ok: false, message: "El estado de LIVE SHOP cambió. Intenta de nuevo." });
            }
            applyCatalog(state, deckId, catalog);
          }
          state.active = value;
          publish(roomKey, state, ["audience", "presenter", "screen"]);
        } else if (["celebrations", "sound"].includes(action) && typeof value === "boolean") {
          state[action] = value;
          if (action === "celebrations" && !value) clearCelebrations(roomKey, state);
          publish(roomKey, state, ["presenter", "screen"]);
        } else if (action === "reset") {
          state.count = 0;
          clearCelebrations(roomKey, state);
          publish(roomKey, state, ["presenter", "screen"]);
        } else if (action === "test") {
          celebrate(roomKey, state, "");
        } else if (action === "milestone" && milestones.includes(value) && value > state.count) {
          state.count = value - 1;
          celebrate(roomKey, state, "");
        } else {
          return ack({ ok: false, message: "Acción de prueba no disponible." });
        }
        touch(roomKey);
        return ack({ ok: true });
      } catch (error) {
        console.error("Live Shop control failed", error);
        return ack({ ok: false, message: "No se pudo actualizar LIVE SHOP." });
      }
    });

    socket.on("live-shop:purchase", (payload, ack) => {
      if (typeof ack !== "function") return;
      const context = contextFor("audience");
      if (!context?.audienceId || context.audienceId !== binding.audienceId || !payload) {
        return ack({ ok: false, message: "Vuelve a conectarte para simular la compra." });
      }
      const { roomKey, state, audienceId } = context;
      const { requestId, instance, lines } = payload;
      if (typeof requestId !== "string" || !purchaseIdPattern.test(requestId) || instance !== state.instance) {
        return ack({ ok: false, message: "La sesión cambió. Revisa tu carrito." });
      }
      const receiptKey = JSON.stringify([audienceId, requestId]);
      if (state.purchases.has(receiptKey)) return ack({ ok: true });
      if (!state.active) return ack({ ok: false, message: "Shop está desactivado." });
      const visible = new Set(state.products.map(product => product.id));
      if (!Array.isArray(lines) || !lines.length || lines.length > visible.size
        || new Set(lines.map(line => line?.id)).size !== lines.length
        || lines.some(line => !visible.has(line?.id) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxQuantity)) {
        return ack({ ok: false, message: "El catálogo cambió. Revisa los productos de tu carrito." });
      }
      state.purchases.set(receiptKey, true);
      celebrate(roomKey, state, binding.audienceName.trim());
      touch(roomKey);
      return ack({ ok: true });
    });

    return { join };
  }

  return { attach, changeCatalog, resetSession };
}

module.exports = { createLiveShopRuntime };
