(function () {
  const MAX_LOGO_BYTES = 5 * 1024 * 1024;
  const ALLOWED_LOGO_EXTENSIONS = /\.(?:png|jpe?g|webp)$/i;
  let currentDeck = null;
  let config = null;
  let modal = null;
  let bodyNode = null;
  let statusNode = null;
  let pendingDeleteId = null;
  let previewUrl = null;

  function niceTitle(value) {
    return String(value || "Presentación").replace(/[-_]+/g, " ").trim() || "Presentación";
  }

  function apiBase() {
    return "/api/decks/" + encodeURIComponent(currentDeck.deckId) + "/brand-mentions";
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop brand-mentions-backdrop";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<section class="brand-mentions-modal" role="dialog" aria-modal="true" aria-labelledby="brandMentionsTitle"><button class="brand-mentions-close" type="button" aria-label="Cerrar menciones de marca">×</button><div class="brand-mentions-scroll"><header class="brand-mentions-header"><span class="brand-mentions-kicker">Solo Público</span><h2 id="brandMentionsTitle">Menciones de marca</h2><p id="brandMentionsDeckTitle"></p></header><div class="brand-mentions-schedule"><strong>Rotación automática</strong><span>Cada 120 segundos · visible durante 8 segundos</span></div><div class="brand-mentions-status" aria-live="polite"></div><div class="brand-mentions-body"></div></div></section>';
    document.body.appendChild(modal);
    bodyNode = modal.querySelector(".brand-mentions-body");
    statusNode = modal.querySelector(".brand-mentions-status");
    modal.querySelector(".brand-mentions-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    return modal;
  }

  function setStatus(message, type = "") {
    if (!statusNode) return;
    statusNode.textContent = message || "";
    statusNode.className = "brand-mentions-status" + (type ? " " + type : "");
  }

  function errorMessage(data, fallback) {
    const messages = {
      BRAND_LIMIT_REACHED: "Este deck ya alcanzó el límite de 50 marcas.",
      INVALID_TARGET_URL: "Escribe un enlace HTTPS válido.",
      LOGO_REQUIRED: "Selecciona un logo.",
      LOGO_TOO_LARGE: "El logo debe pesar 5 MB o menos.",
      INVALID_LOGO: "El logo debe ser un PNG, JPG o WebP válido.",
      LOGO_TYPE_MISMATCH: "La extensión del logo no coincide con el archivo.",
      INVALID_LOGO_DIMENSIONS: "El logo no puede superar 4096 × 4096 px.",
      READ_ONLY_DECK: "Este deck de ejemplo es de solo lectura.",
      BRAND_NOT_FOUND: "La marca ya no existe. Vuelve a cargar el editor."
    };
    return messages[data?.code] || data?.error || fallback;
  }

  function adoptConfig(payload) {
    const next = payload?.config || payload;
    config = {
      settings: next?.settings || { interval_seconds: 120, display_seconds: 8 },
      brands: Array.isArray(next?.brands) ? next.brands : []
    };
    return config;
  }

  async function loadConfig() {
    const response = await fetch(apiBase(), { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(data, "No se pudieron cargar las menciones de marca."));
    adoptConfig(data);
  }

  async function mutate(path, options) {
    const response = await fetch(apiBase() + path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(data, "No se pudo guardar la mención de marca."));
    adoptConfig(data);
    return data;
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function setActionBusy(button, busy, busyLabel) {
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel;
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
      delete button.dataset.label;
    }
  }

  async function toggleBrand(brand, button) {
    const form = new FormData();
    form.append("active", String(!brand.active));
    try {
      setActionBusy(button, true, "Guardando…");
      setStatus(brand.active ? "Desactivando marca…" : "Activando marca…");
      await mutate("/" + encodeURIComponent(brand.id), { method: "PUT", body: form });
      setStatus(brand.active ? "Marca desactivada." : "Marca activada.", "success");
      renderList();
    } catch (error) {
      setActionBusy(button, false);
      setStatus(error.message, "error");
    }
  }

  async function moveBrand(index, direction, button) {
    const next = [...config.brands];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      setActionBusy(button, true, "…");
      setStatus("Actualizando orden…");
      await mutate("/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_ids: next.map((brand) => brand.id) })
      });
      setStatus("Orden actualizado.", "success");
      renderList();
    } catch (error) {
      setActionBusy(button, false);
      setStatus(error.message, "error");
    }
  }

  function renderDeleteConfirm(brand) {
    const confirm = document.createElement("div");
    confirm.className = "brand-mention-delete-confirm";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    title.textContent = "¿Eliminar esta marca?";
    detail.textContent = brand.name + " y su logo se borrarán del deck.";
    copy.append(title, detail);
    const actions = document.createElement("div");
    actions.className = "brand-mention-delete-actions";
    actions.append(
      makeButton("Cancelar", "brand-mention-text-action", () => {
        pendingDeleteId = null;
        renderList();
      }),
      makeButton("Eliminar marca", "brand-mention-text-action danger solid", async (event) => {
        const button = event.currentTarget;
        try {
          setActionBusy(button, true, "Eliminando…");
          setStatus("Eliminando marca…");
          await mutate("/" + encodeURIComponent(brand.id), { method: "DELETE" });
          pendingDeleteId = null;
          setStatus("Marca eliminada.", "success");
          renderList();
        } catch (error) {
          setActionBusy(button, false);
          setStatus(error.message, "error");
        }
      })
    );
    confirm.append(copy, actions);
    return confirm;
  }

  function renderBrandCard(brand, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "brand-mention-entry";
    const item = document.createElement("article");
    item.className = "brand-mention-item" + (brand.active ? "" : " is-inactive");

    const logo = document.createElement("div");
    logo.className = "brand-mention-logo";
    const image = document.createElement("img");
    image.src = brand.logo?.src || "";
    image.alt = "Logo de " + brand.name;
    logo.appendChild(image);

    const copy = document.createElement("div");
    copy.className = "brand-mention-copy";
    const heading = document.createElement("div");
    const name = document.createElement("strong");
    const state = document.createElement("span");
    name.textContent = brand.name;
    state.className = "brand-mention-state " + (brand.active ? "active" : "inactive");
    state.textContent = brand.active ? "Activa" : "Pausada";
    heading.append(name, state);
    const pitch = document.createElement("span");
    const domain = document.createElement("small");
    pitch.textContent = brand.pitch;
    domain.textContent = brand.display_domain || brand.target_url;
    copy.append(heading, pitch, domain);

    const actions = document.createElement("div");
    actions.className = "brand-mention-item-actions";
    const order = document.createElement("div");
    order.className = "brand-mention-order-actions";
    const up = makeButton("↑", "brand-mention-icon-action", (event) => moveBrand(index, -1, event.currentTarget));
    const down = makeButton("↓", "brand-mention-icon-action", (event) => moveBrand(index, 1, event.currentTarget));
    up.setAttribute("aria-label", "Subir " + brand.name);
    down.setAttribute("aria-label", "Bajar " + brand.name);
    up.disabled = index === 0;
    down.disabled = index === config.brands.length - 1;
    order.append(up, down);
    const toggle = makeButton(brand.active ? "Pausar" : "Activar", "brand-mention-text-action", (event) => toggleBrand(brand, event.currentTarget));
    toggle.setAttribute("aria-pressed", String(Boolean(brand.active)));
    const edit = makeButton("Editar", "brand-mention-text-action", () => renderForm(brand));
    const remove = makeButton("Eliminar", "brand-mention-text-action danger", () => {
      pendingDeleteId = brand.id;
      renderList();
    });
    actions.append(order, toggle, edit, remove);
    item.append(logo, copy, actions);
    wrapper.appendChild(item);
    if (pendingDeleteId === brand.id) wrapper.appendChild(renderDeleteConfirm(brand));
    return wrapper;
  }

  function cleanupPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }

  function renderList() {
    cleanupPreview();
    bodyNode.innerHTML = "";
    const toolbar = document.createElement("div");
    toolbar.className = "brand-mentions-toolbar";
    const summary = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const activeCount = config.brands.filter((brand) => brand.active).length;
    title.textContent = config.brands.length + " marca" + (config.brands.length === 1 ? "" : "s");
    detail.textContent = activeCount + " activa" + (activeCount === 1 ? "" : "s") + " · rotan en este orden";
    summary.append(title, detail);
    const add = makeButton("Agregar marca", "primary-action brand-mentions-add", () => renderForm());
    add.disabled = config.brands.length >= 50;
    toolbar.append(summary, add);
    bodyNode.appendChild(toolbar);

    if (!config.brands.length) {
      const empty = document.createElement("div");
      empty.className = "brand-mentions-empty";
      empty.innerHTML = "<strong>Este deck todavía no tiene marcas.</strong><p>Agrega un patrocinador con logo, mensaje corto y enlace. Las menciones aparecerán únicamente en Público.</p>";
      bodyNode.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "brand-mentions-list";
    config.brands.forEach((brand, index) => list.appendChild(renderBrandCard(brand, index)));
    bodyNode.appendChild(list);
  }

  function validLogo(file) {
    if (!file) return "";
    if (!ALLOWED_LOGO_EXTENSIONS.test(file.name)) return "El logo debe ser PNG, JPG o WebP.";
    if (file.size > MAX_LOGO_BYTES) return "El logo debe pesar 5 MB o menos.";
    if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return "El logo debe ser PNG, JPG o WebP.";
    return "";
  }

  function renderForm(existing = null) {
    cleanupPreview();
    pendingDeleteId = null;
    bodyNode.innerHTML = "";
    const form = document.createElement("form");
    form.className = "brand-mention-form";
    form.noValidate = true;
    form.innerHTML = '<div class="brand-mention-form-heading"><h3>' + (existing ? "Editar marca" : "Agregar marca") + '</h3><p>La tarjeta será clickable y se mostrará únicamente a Público.</p></div><div class="brand-mention-logo-field"><div class="brand-mention-logo-preview"><span data-logo-placeholder>Logo</span><img data-logo-preview alt=""></div><div><strong>Logo</strong><span>PNG, JPG o WebP · máximo 5 MB</span><button class="secondary-action" type="button" data-select-logo>' + (existing ? "Reemplazar logo" : "Seleccionar logo") + '</button></div><input class="brand-mention-native-file" name="logo" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"></div><label><span>Nombre de la marca</span><input name="name" maxlength="80" autocomplete="organization" required placeholder="Ej. NeurONE"></label><label><span>Pitch corto</span><textarea name="pitch" maxlength="140" rows="3" required placeholder="Una frase breve para presentar la marca."></textarea><small class="brand-mention-counter" data-pitch-counter>0/140</small></label><label><span>Enlace</span><input name="url" inputmode="url" autocomplete="url" required placeholder="marca.mx/producto"><small>Immersa lo guardará como enlace HTTPS.</small></label><label class="brand-mention-active-field"><input name="active" type="checkbox" checked><span><strong>Marca activa</strong><small>Participará en la rotación automática.</small></span></label><div class="modal-actions"><button class="secondary-action" type="button" data-cancel>Cancelar</button><button class="primary-action" type="submit">' + (existing ? "Guardar cambios" : "Agregar marca") + "</button></div>";
    bodyNode.appendChild(form);

    const logoInput = form.elements.logo;
    const logoPreview = form.querySelector("[data-logo-preview]");
    const logoPlaceholder = form.querySelector("[data-logo-placeholder]");
    const pitchCounter = form.querySelector("[data-pitch-counter]");
    form.elements.name.value = existing?.name || "";
    form.elements.pitch.value = existing?.pitch || "";
    form.elements.url.value = existing?.target_url || "";
    form.elements.active.checked = existing ? Boolean(existing.active) : true;

    function updatePitchCounter() {
      pitchCounter.textContent = form.elements.pitch.value.length + "/140";
    }

    function showLogo(src, alt) {
      logoPreview.src = src;
      logoPreview.alt = alt;
      logoPreview.hidden = false;
      logoPlaceholder.hidden = true;
    }

    if (existing?.logo?.src) showLogo(existing.logo.src, "Logo actual de " + existing.name);
    else logoPreview.hidden = true;
    updatePitchCounter();
    form.elements.pitch.addEventListener("input", updatePitchCounter);
    form.querySelector("[data-select-logo]").addEventListener("click", () => logoInput.click());
    logoInput.addEventListener("change", () => {
      const file = logoInput.files[0];
      if (!file) return;
      const error = validLogo(file);
      if (error) {
        logoInput.value = "";
        setStatus(error, "error");
        return;
      }
      cleanupPreview();
      previewUrl = URL.createObjectURL(file);
      showLogo(previewUrl, "Vista previa del logo seleccionado");
      form.querySelector("[data-select-logo]").textContent = "Cambiar logo";
      setStatus("");
    });
    form.querySelector("[data-cancel]").addEventListener("click", renderList);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = form.elements.name.value.trim();
      const pitch = form.elements.pitch.value.trim();
      const url = form.elements.url.value.trim();
      const logo = logoInput.files[0];
      if (!name) return setStatus("Escribe el nombre de la marca.", "error");
      if (!pitch) return setStatus("Escribe un pitch corto.", "error");
      if (!url) return setStatus("Escribe el enlace de la marca.", "error");
      if (!existing && !logo) return setStatus("Selecciona un logo.", "error");
      const logoError = validLogo(logo);
      if (logoError) return setStatus(logoError, "error");

      const data = new FormData();
      data.append("name", name);
      data.append("pitch", pitch);
      data.append("url", url);
      data.append("active", String(form.elements.active.checked));
      if (logo) data.append("logo", logo);
      const submit = form.querySelector('[type="submit"]');
      try {
        setActionBusy(submit, true, "Guardando…");
        setStatus("Guardando marca…");
        await mutate(existing ? "/" + encodeURIComponent(existing.id) : "", {
          method: existing ? "PUT" : "POST",
          body: data
        });
        setStatus(existing ? "Cambios guardados." : "Marca agregada.", "success");
        renderList();
      } catch (error) {
        setActionBusy(submit, false);
        setStatus(error.message, "error");
      }
    });
    window.setTimeout(() => form.elements.name.focus(), 20);
  }

  function openModal(deck) {
    if (!deck?.deckId) return;
    ensureModal();
    currentDeck = deck;
    config = null;
    pendingDeleteId = null;
    modal.querySelector("#brandMentionsDeckTitle").textContent = niceTitle(deck.title || deck.deckId);
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    bodyNode.innerHTML = "";
    setStatus("Cargando…");
    loadConfig().then(() => {
      setStatus("");
      renderList();
    }).catch((error) => {
      setStatus(error.message, "error");
    });
  }

  function closeModal() {
    if (!modal) return;
    cleanupPreview();
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    currentDeck = null;
    config = null;
    pendingDeleteId = null;
    if (document.getElementById("deckDetailModal")?.hidden) document.body.classList.remove("modal-open");
  }

  function appendBrandsButton(deck) {
    const actions = document.getElementById("detailActions");
    if (!actions || actions.querySelector(".role-brand-mentions")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-role-action role-brand-mentions";
    button.textContent = "Marcas";
    button.title = "Administrar menciones de marca de este deck";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openModal(deck);
    });
    actions.appendChild(button);
  }

  function patchDetailActions() {
    const original = window.renderDetailActions;
    if (typeof original !== "function" || original.__brandMentionsPatched) return;
    window.renderDetailActions = function patchedRenderDetailActions(deck) {
      original(deck);
      appendBrandsButton(deck);
    };
    window.renderDetailActions.__brandMentionsPatched = true;
  }

  patchDetailActions();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) closeModal();
  });
})();
