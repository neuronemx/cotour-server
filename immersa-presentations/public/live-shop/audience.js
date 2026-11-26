window.ImmersaLiveShopAudience = function ({ socket, deckId, sessionId }) {
  const root = document.getElementById("liveShopAudience");
  if (!root) return;
  const get = name => root.querySelector("[data-shop-" + name + "]");
  const tab = root.querySelector(".live-shop-tab");
  const drawer = document.getElementById("liveShopDrawer");
  const views = [...root.querySelectorAll("[data-shop-view]")];
  const scroller = root.querySelector(".live-shop-scroll");
  const card = root.querySelector(".live-shop-card");
  const navigation = root.querySelector(".live-shop-card-nav");
  const image = get("image");
  const items = get("items");
  const notice = get("notice");
  const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", currencyDisplay: "code" });
  const money = cents => formatter.format(cents / 100);
  const storageKey = "immersa:live-shop:" + JSON.stringify([deckId, sessionId]);
  const maxQuantity = 99;
  let state = null;
  let products = [];
  let cart = new Map();
  let productIndex = 0;
  let currentView = "catalog";
  let pending = false;
  let retry = null;
  let gesture = null;

  function restore(instance) {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return stored?.instance === instance && Array.isArray(stored.lines)
        ? new Map(stored.lines.filter(line => Array.isArray(line) && typeof line[0] === "string" && Number.isInteger(line[1]) && line[1] > 0 && line[1] <= maxQuantity))
        : new Map();
    } catch (_error) {
      return new Map();
    }
  }

  function persist() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ instance: state.instance, lines: [...cart] }));
    } catch (_error) {}
  }

  function setOpen(open, focus = false) {
    drawer.hidden = !open;
    drawer.inert = !open;
    tab.hidden = open;
    tab.setAttribute("aria-expanded", String(open));
    if (focus && open) get("close").focus();
    if (focus && !open) tab.focus();
    if (open) render();
  }

  function showView(view, focus = false) {
    currentView = view;
    notice.textContent = "";
    views.forEach(item => { item.hidden = item.dataset.shopView !== view; });
    scroller.scrollTop = 0;
    render();
    if (focus) drawer.querySelector('[data-shop-view="' + view + '"] h3[tabindex]')?.focus();
  }

  function cartEntries() {
    const byId = new Map(products.map(product => [product.id, product]));
    return [...cart].flatMap(([id, quantity]) => {
      const product = byId.get(id);
      return product ? [{ product, quantity }] : [];
    });
  }

  function changeQuantity(id, quantity) {
    if (pending) return;
    if (quantity <= 0) cart.delete(id);
    else cart.set(id, Math.min(maxQuantity, quantity));
    retry = null;
    persist();
    render();
  }

  function lineButton(text, label, id, operation, callback, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.dataset.cartLine = id;
    button.dataset.cartOperation = operation;
    button.disabled = disabled || pending;
    button.addEventListener("click", callback);
    return button;
  }

  function renderCart(entries) {
    const focused = items.contains(document.activeElement) ? document.activeElement.dataset : null;
    items.replaceChildren();
    for (const { product, quantity } of entries) {
      const row = document.createElement("li");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = product.name;
      const unit = document.createElement("small");
      unit.textContent = money(product.priceCents) + " por unidad";
      copy.append(title, unit);
      const subtotal = document.createElement("strong");
      subtotal.textContent = money(product.priceCents * quantity);
      const actions = document.createElement("div");
      actions.className = "live-shop-cart-quantity";
      const number = document.createElement("span");
      number.textContent = String(quantity);
      const id = product.id;
      actions.append(
        lineButton("−", "Reducir " + product.name, id, "minus", () => changeQuantity(id, quantity - 1)),
        number,
        lineButton("+", "Aumentar " + product.name, id, "plus", () => changeQuantity(id, quantity + 1), quantity >= maxQuantity),
        lineButton("Eliminar", "Eliminar " + product.name, id, "remove", () => changeQuantity(id, 0))
      );
      row.append(copy, subtotal, actions);
      items.append(row);
    }
    if (focused) {
      const next = [...items.querySelectorAll("[data-cart-line]")]
        .find(button => button.dataset.cartLine === focused.cartLine && button.dataset.cartOperation === focused.cartOperation);
      (next || drawer.querySelector('[data-shop-view="cart"] h3')).focus();
    }
  }

  function render() {
    const product = products[productIndex];
    const entries = cartEntries();
    const quantity = [...cart.values()].reduce((sum, value) => sum + value, 0);
    const total = entries.reduce((sum, entry) => sum + entry.product.priceCents * entry.quantity, 0);
    root.querySelectorAll("[data-shop-quantity]").forEach(label => { label.textContent = String(quantity); });
    tab.querySelector("[data-shop-quantity]").hidden = quantity === 0;
    card.hidden = !product;
    get("empty").hidden = Boolean(product);
    navigation.hidden = products.length < 2;
    if (product) {
      if (image.getAttribute("src") !== product.imageUrl) image.src = product.imageUrl;
      get("name").textContent = product.name;
      get("description").textContent = product.description;
      get("price").textContent = money(product.priceCents);
      get("add").disabled = pending || (cart.get(product.id) || 0) >= maxQuantity;
      get("position").textContent = (productIndex + 1) + " de " + products.length;
      get("prev").disabled = productIndex === 0;
      get("next").disabled = productIndex === products.length - 1;
    }
    if (currentView === "cart") renderCart(entries);
    get("cart-summary").hidden = !entries.length;
    get("cart-empty").hidden = Boolean(entries.length);
    get("total").textContent = money(total);
    get("confirm-total").textContent = money(total);
    get("checkout").disabled = pending || !entries.length;
    get("simulate").disabled = pending || !entries.length || !socket.connected;
    get("back").disabled = pending;
  }

  function move(offset) {
    const next = productIndex + offset;
    if (next < 0 || next >= products.length) return;
    productIndex = next;
    notice.textContent = "";
    render();
  }

  function update(next) {
    if (!state || state.instance !== next.instance) {
      cart = restore(next.instance);
      productIndex = 0;
      pending = false;
      retry = null;
      currentView = "catalog";
      setOpen(false);
    }
    state = next;
    root.hidden = !next.active;
    if (!next.active) {
      setOpen(false);
      return;
    }
    const selected = products[productIndex]?.id;
    products = next.products;
    productIndex = Math.max(0, products.findIndex(product => product.id === selected));
    const visible = new Set(products.map(product => product.id));
    const unavailable = [...cart.keys()].filter(id => !visible.has(id));
    if (unavailable.length) {
      unavailable.forEach(id => cart.delete(id));
      retry = null;
      persist();
      if (currentView === "confirm") showView("cart");
      notice.textContent = "El catálogo cambió. Quitamos los productos que ya no están disponibles.";
    }
    views.forEach(item => { item.hidden = item.dataset.shopView !== currentView; });
    render();
  }

  async function simulate() {
    if (pending || !state?.active || !socket.connected) return;
    const lines = cartEntries().map(({ product, quantity }) => ({ id: product.id, quantity }));
    if (!lines.length) return;
    const instance = state.instance;
    const signature = JSON.stringify(lines);
    if (retry?.signature !== signature) retry = { signature, requestId: crypto.randomUUID() };
    pending = true;
    notice.textContent = "Simulando compra…";
    render();
    try {
      const result = await socket.timeout(5000).emitWithAck("live-shop:purchase", { instance, lines, requestId: retry.requestId });
      if (instance !== state.instance) return;
      if (!result?.ok) {
        retry = null;
        notice.textContent = result?.message || "No se pudo simular la compra.";
        return;
      }
      cart.clear();
      retry = null;
      persist();
      showView("success", !drawer.hidden);
    } catch (_error) {
      if (instance === state.instance) notice.textContent = "No recibimos la confirmación. Vuelve a intentar la simulación.";
    } finally {
      if (instance === state.instance) {
        pending = false;
        render();
      }
    }
  }

  tab.addEventListener("click", () => setOpen(true, true));
  get("close").addEventListener("click", () => setOpen(false, true));
  get("cart").addEventListener("click", () => showView("cart", true));
  get("prev").addEventListener("click", () => move(-1));
  get("next").addEventListener("click", () => move(1));
  get("add").addEventListener("click", () => {
    const product = products[productIndex];
    if (!product) return;
    changeQuantity(product.id, (cart.get(product.id) || 0) + 1);
    notice.textContent = "Agregaste " + product.name + " al carrito.";
  });
  get("checkout").addEventListener("click", () => showView("confirm", true));
  get("simulate").addEventListener("click", simulate);
  get("back").addEventListener("click", () => showView("cart", true));
  root.querySelectorAll("[data-shop-catalog]").forEach(button => button.addEventListener("click", () => showView("catalog")));
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && !drawer.hidden) {
      event.stopPropagation();
      setOpen(false, true);
    }
  });
  card.addEventListener("touchstart", event => {
    gesture = event.touches.length === 1 ? event.touches[0] : null;
  }, { passive: true });
  card.addEventListener("touchend", event => {
    if (!gesture) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - gesture.clientX;
    const dy = touch.clientY - gesture.clientY;
    gesture = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
  }, { passive: true });
  socket.on("live-shop:state", update);
  socket.on("disconnect", render);
};
