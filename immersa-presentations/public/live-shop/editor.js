(function () {
  const tab = document.getElementById("deckTabLiveShop");
  const root = document.getElementById("liveShopEditor");
  const form = root.querySelector("form");
  const list = root.querySelector("[data-shop-products]");
  const notice = root.querySelector("[data-shop-status]");
  const newProduct = root.querySelector("[data-shop-new]");
  const preview = form.querySelector("img");
  const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", currencyDisplay: "code" });
  let allowed = false;
  let deckId = "";
  let config = null;
  let selectedId = null;
  let deckVersion = 0;
  let busy = false;

  function endpoint() {
    return "/api/decks/" + encodeURIComponent(deckId) + "/live-shop";
  }

  async function request(url, options) {
    const response = await fetch(url, { ...options, cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "No se pudo cargar o guardar el catálogo.");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function action(label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", callback);
    return button;
  }

  function showForm(product = null) {
    selectedId = product?.id || null;
    form.reset();
    form.querySelector("[data-shop-form-title]").textContent = product ? "Editar producto" : "Nuevo producto";
    form.elements.name.value = product?.name || "";
    form.elements.description.value = product?.description || "";
    form.elements.price.value = product ? (product.priceCents / 100).toFixed(2) : "";
    form.elements.visible.checked = product?.visible ?? true;
    form.elements.image.required = !product;
    preview.hidden = !product;
    if (product) preview.src = product.imageUrl;
    else preview.removeAttribute("src");
    form.hidden = false;
    form.elements.name.focus();
  }

  function editOrder(index, offset) {
    const ids = config.products.map(product => product.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    void mutate("/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: config.revision, ids })
    }, "Orden guardado.");
  }

  function remove(product) {
    if (!window.confirm("¿Eliminar «" + product.name + "» del catálogo?")) return;
    void mutate("/" + encodeURIComponent(product.id), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: config.revision })
    }, "Producto eliminado.");
  }

  function render() {
    newProduct.disabled = busy || !config || config.products.length >= 30;
    list.inert = busy;
    form.inert = busy;
    list.replaceChildren();
    if (!config) return;
    config.products.forEach((product, index) => {
      const row = document.createElement("li");
      const image = document.createElement("img");
      image.alt = "";
      image.src = product.imageUrl;
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = product.name;
      const info = document.createElement("small");
      info.textContent = money.format(product.priceCents / 100) + " · " + (product.visible ? "Visible" : "Oculto");
      details.append(name, info);
      const controls = document.createElement("div");
      controls.className = "live-shop-editor-actions";
      const edit = action("Editar", () => showForm(product));
      const up = action("↑", () => editOrder(index, -1));
      const down = action("↓", () => editOrder(index, 1));
      const del = action("Eliminar", () => remove(product));
      up.disabled = index === 0;
      down.disabled = index === config.products.length - 1;
      up.setAttribute("aria-label", "Subir " + product.name);
      down.setAttribute("aria-label", "Bajar " + product.name);
      edit.setAttribute("aria-label", "Editar " + product.name);
      del.setAttribute("aria-label", "Eliminar " + product.name);
      controls.append(up, down, edit, del);
      row.append(image, details, controls);
      list.append(row);
    });
  }

  async function load() {
    if (!allowed || !deckId || busy) return;
    const version = deckVersion;
    busy = true;
    notice.textContent = "Cargando catálogo…";
    render();
    try {
      const result = await request(endpoint());
      if (version !== deckVersion) return;
      config = result;
      notice.textContent = config.products.length ? "" : "Agrega un producto para abrir tu catálogo.";
    } catch (error) {
      if (version === deckVersion) notice.textContent = error.message;
    } finally {
      if (version === deckVersion) {
        busy = false;
        render();
      }
    }
  }

  async function mutate(suffix, options, message) {
    if (busy || !config) return;
    const version = deckVersion;
    busy = true;
    notice.textContent = "Guardando…";
    render();
    try {
      const result = await request(endpoint() + suffix, options);
      if (version !== deckVersion) return;
      config = result;
      form.hidden = true;
      notice.textContent = message;
    } catch (error) {
      if (version !== deckVersion) return;
      if (error.status === 409) {
        try {
          const result = await request(endpoint());
          if (version !== deckVersion) return;
          config = result;
          notice.textContent = "El catálogo cambió en otra ventana. Revisa tu edición y vuelve a guardar.";
        } catch (reloadError) {
          if (version === deckVersion) notice.textContent = reloadError.message;
        }
      } else notice.textContent = error.message;
    } finally {
      if (version === deckVersion) {
        busy = false;
        render();
      }
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!config) return;
    const data = new FormData(form);
    data.set("visible", String(form.elements.visible.checked));
    data.set("revision", String(config.revision));
    if (!form.elements.image.files.length) data.delete("image");
    void mutate(selectedId ? "/" + encodeURIComponent(selectedId) : "", {
      method: selectedId ? "PUT" : "POST", body: data
    }, "Producto guardado.");
  });
  newProduct.addEventListener("click", () => showForm());
  form.querySelector("[data-shop-cancel]").addEventListener("click", () => {
    form.hidden = true;
    newProduct.focus();
  });

  function setDeck(deck) {
    deckVersion++;
    deckId = deck?.missing || deck?.systemDemo ? "" : String(deck?.deckId || "");
    tab.hidden = !allowed || !deckId;
    config = null;
    busy = false;
    form.hidden = true;
    notice.textContent = "";
    render();
  }

  document.addEventListener("immersa:deck-detail-open", event => setDeck(event.detail?.deck));
  document.addEventListener("immersa:deck-detail-close", () => setDeck(null));
  document.addEventListener("immersa:deck-panel-visible", event => {
    if (event.detail?.panel === "live-shop" && !config) void load();
  });
  request("/api/live-shop/capability").then(result => {
    allowed = result.enabled === true;
    tab.hidden = !allowed || !deckId;
  }).catch(() => {});
})();
