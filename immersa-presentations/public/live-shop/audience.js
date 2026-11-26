window.ImmersaLiveShopAudience = function ({ socket, deckId, sessionId }) {
  const root = document.getElementById("liveShopAudience");
  if (!root) return;
  const get = name => root.querySelector("[data-shop-" + name + "]");
  const tab = root.querySelector(".live-shop-tab");
  const tabQuantity = tab.querySelector("[data-shop-quantity]");
  const drawer = document.getElementById("liveShopDrawer");
  const views = [...root.querySelectorAll("[data-shop-view]")];
  const scroller = root.querySelector(".live-shop-scroll");
  const track = get("track");
  const template = get("product-template");
  const navigation = root.querySelector(".live-shop-card-nav");
  const productButtons = new Map();
  const sound = get("sound");
  const items = get("items");
  const notice = get("notice");
  const formatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", currencyDisplay: "code" });
  const money = cents => formatter.format(cents / 100);
  const storageKey = "immersa:live-shop:" + JSON.stringify([deckId, sessionId]);
  const maxQuantity = 99;
  let state = null;
  let products = [];
  let cart = new Map();
  let catalogScroll = 0;
  let currentView = "catalog";
  let pending = false;
  let retry = null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const soundPreference = "immersa:live-shop:muted";
  const soundNotes = { open: [660], add: [784, 1047], success: [740, 932, 1175] };
  let audio = null;
  let output = null;
  let muted = false;
  try { muted = localStorage.getItem(soundPreference) === "true"; } catch (_error) {}
  sound.hidden = !AudioContext;

  function updateSound() {
    sound.setAttribute("aria-pressed", String(muted));
    sound.setAttribute("aria-label", muted ? "Activar sonidos de Shop" : "Silenciar sonidos de Shop");
    sound.title = sound.getAttribute("aria-label");
    if (output) output.gain.value = muted ? 0 : 1;
  }

  async function playSound(cue) {
    if (!AudioContext || muted) return;
    try {
      if (!audio) {
        audio = new AudioContext();
        output = audio.createGain();
        output.connect(audio.destination);
      }
      if (audio.state !== "running") await audio.resume();
      if (muted || audio.state !== "running" || drawer.hidden) return;
      soundNotes[cue].forEach((frequency, index) => {
        const start = audio.currentTime + index * .06;
        const oscillator = audio.createOscillator();
        const envelope = audio.createGain();
        oscillator.frequency.value = frequency;
        oscillator.connect(envelope);
        envelope.connect(output);
        envelope.gain.setValueAtTime(.001, start);
        envelope.gain.exponentialRampToValueAtTime(cue === "open" ? .035 : .065, start + .012);
        envelope.gain.exponentialRampToValueAtTime(.001, start + .14);
        oscillator.start(start);
        oscillator.stop(start + .15);
        oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      });
    } catch (_error) {
      // The storefront stays usable if the browser blocks audio.
    }
  }

  sound.addEventListener("click", () => {
    muted = !muted;
    try { localStorage.setItem(soundPreference, String(muted)); } catch (_error) {}
    updateSound();
    if (!muted) void playSound("open");
  });
  updateSound();

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
    if (open) {
      restoreCatalogScroll();
      render();
    }
  }

  function showView(view, focus = false) {
    currentView = view;
    notice.textContent = "";
    views.forEach(item => { item.hidden = item.dataset.shopView !== view; });
    scroller.scrollTop = 0;
    restoreCatalogScroll();
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
      const image = document.createElement("img");
      image.alt = "";
      image.src = product.imageUrl;
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
      row.append(image, copy, subtotal, actions);
      items.append(row);
    }
    if (focused) {
      const next = [...items.querySelectorAll("[data-cart-line]")]
        .find(button => button.dataset.cartLine === focused.cartLine && button.dataset.cartOperation === focused.cartOperation);
      (next || drawer.querySelector('[data-shop-view="cart"] h3')).focus();
    }
  }

  function cardOffsets() {
    const origin = track.firstElementChild?.offsetLeft || 0;
    return Array.from(track.children, card => card.offsetLeft - origin);
  }

  function syncNavigation() {
    if (!track.clientWidth) return;
    const max = track.scrollWidth - track.clientWidth;
    const left = track.scrollLeft;
    catalogScroll = left;
    navigation.hidden = max <= 2;
    get("prev").disabled = left <= 2;
    get("next").disabled = left >= max - 2;
    const offsets = cardOffsets();
    const first = offsets.findLastIndex(offset => offset <= left + 2);
    const last = offsets.findLastIndex(offset => offset <= left + track.clientWidth - (track.lastElementChild?.offsetWidth || 0));
    const start = first + 1;
    const finish = Math.max(start, last + 1);
    get("position").textContent = (finish > start ? start + "–" + finish : start) + " de " + products.length;
  }

  function restoreCatalogScroll() {
    if (currentView !== "catalog" || drawer.hidden) return;
    track.scrollLeft = catalogScroll;
    syncNavigation();
  }

  function renderCatalog() {
    productButtons.clear();
    const cards = products.map(product => {
      const card = template.content.firstElementChild.cloneNode(true);
      const image = card.querySelector("[data-shop-image]");
      const button = card.querySelector("[data-shop-add]");
      card.querySelector("[data-shop-name]").textContent = product.name;
      card.querySelector("[data-shop-description]").textContent = product.description;
      card.querySelector("[data-shop-price]").textContent = money(product.priceCents);
      image.addEventListener("load", () => window.ImmersaShopImageColor?.(image, button), { once: true });
      image.src = product.imageUrl;
      button.setAttribute("aria-label", "Agregar " + product.name + " al carrito");
      button.addEventListener("click", () => {
        if (pending) return;
        changeQuantity(product.id, (cart.get(product.id) || 0) + 1);
        notice.textContent = "Agregaste " + product.name + " al carrito.";
        void playSound("add");
      });
      productButtons.set(product.id, button);
      return card;
    });
    track.replaceChildren(...cards);
    track.hidden = !cards.length;
    track.classList.toggle("has-one", cards.length === 1);
    get("empty").hidden = Boolean(cards.length);
    navigation.hidden = cards.length < 2;
    restoreCatalogScroll();
  }

  function render() {
    const entries = cartEntries();
    const quantity = [...cart.values()].reduce((sum, value) => sum + value, 0);
    const total = entries.reduce((sum, entry) => sum + entry.product.priceCents * entry.quantity, 0);
    root.classList.toggle("has-cart-items", quantity > 0);
    root.querySelectorAll("[data-shop-quantity]").forEach(label => { label.textContent = String(quantity); });
    tabQuantity.hidden = quantity === 0;
    tab.setAttribute("aria-label", quantity
      ? "Abrir Shop · " + quantity + (quantity === 1 ? " artículo en el carrito" : " artículos en el carrito")
      : "Abrir Shop");
    for (const [id, button] of productButtons) {
      button.disabled = pending || (cart.get(id) || 0) >= maxQuantity;
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

  function move(direction) {
    const offsets = cardOffsets();
    const left = track.scrollLeft;
    const target = direction > 0 ? offsets.find(offset => offset > left + 2) : offsets.findLast(offset => offset < left - 2);
    if (target === undefined) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: target, behavior: reduceMotion ? "instant" : "smooth" });
  }

  function update(next) {
    if (!state || state.instance !== next.instance) {
      cart = restore(next.instance);
      catalogScroll = 0;
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
    if (JSON.stringify(products) !== JSON.stringify(next.products) || !track.children.length) {
      products = next.products;
      renderCatalog();
    }
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
      void playSound("success");
    } catch (_error) {
      if (instance === state.instance) notice.textContent = "No recibimos la confirmación. Vuelve a intentar la simulación.";
    } finally {
      if (instance === state.instance) {
        pending = false;
        render();
      }
    }
  }

  tab.addEventListener("click", () => {
    setOpen(true, true);
    void playSound("open");
  });
  get("close").addEventListener("click", () => setOpen(false, true));
  get("cart").addEventListener("click", () => showView("cart", true));
  get("prev").addEventListener("click", () => move(-1));
  get("next").addEventListener("click", () => move(1));
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
  track.addEventListener("scroll", syncNavigation, { passive: true });
  window.addEventListener("resize", syncNavigation);
  socket.on("live-shop:state", update);
  socket.on("disconnect", render);
};
