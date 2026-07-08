(function () {
  const MAX_OPTIONS = 6;
  const MIN_OPTIONS = 2;
  const optionLetters = "abcdefghijklmnopqrstuvwxyz";
  let currentDeck = null;
  let interactions = [];
  let editingIndex = null;
  let modal = null;
  let listNode = null;
  let formNode = null;
  let statusNode = null;

  function niceTitle(value) {
    return String(value || "Presentación").replace(/[-_]+/g, " ").trim() || "Presentación";
  }

  function optionId(index) {
    return "opt_" + (optionLetters[index] || String(index + 1));
  }

  function interactionId() {
    return "int_" + Date.now().toString(36);
  }

  function defaultDraft() {
    return {
      id: interactionId(),
      slide_id: null,
      type: "poll",
      title: "",
      prompt: "",
      options: [
        { id: "opt_a", label: "" },
        { id: "opt_b", label: "" }
      ],
      settings: {
        allow_multiple: false,
        anonymous: true,
        timer_seconds: null,
        correct_option_ids: [],
        points: 0
      }
    };
  }

  function normalizeForForm(interaction) {
    const draft = interaction ? JSON.parse(JSON.stringify(interaction)) : defaultDraft();
    draft.options = Array.isArray(draft.options) && draft.options.length ? draft.options : defaultDraft().options;
    while (draft.options.length < MIN_OPTIONS) draft.options.push({ id: optionId(draft.options.length), label: "" });
    draft.settings = {
      allow_multiple: false,
      anonymous: true,
      timer_seconds: null,
      correct_option_ids: [],
      points: 0,
      ...(draft.settings || {})
    };
    return draft;
  }

  function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop interactions-backdrop";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<section class="interactions-modal" role="dialog" aria-modal="true" aria-labelledby="interactionsTitle"><button class="interactions-close" type="button" aria-label="Cerrar interacciones">×</button><div class="interactions-header"><span>Interacciones del deck</span><h2 id="interactionsTitle">Encuestas</h2><p id="interactionsDeckTitle"></p></div><div class="interactions-status" aria-live="polite"></div><div class="interactions-list"></div><div class="interactions-form-wrap"></div></section>';
    document.body.appendChild(modal);
    listNode = modal.querySelector(".interactions-list");
    formNode = modal.querySelector(".interactions-form-wrap");
    statusNode = modal.querySelector(".interactions-status");
    modal.querySelector(".interactions-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    return modal;
  }

  function setStatus(message, type = "") {
    if (!statusNode) return;
    statusNode.textContent = message || "";
    statusNode.className = "interactions-status" + (type ? " " + type : "");
  }

  async function loadInteractions(deck) {
    const res = await fetch("/api/decks/" + encodeURIComponent(deck.deckId) + "/interactions", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudieron cargar las interacciones.");
    interactions = Array.isArray(data.interactions) ? data.interactions : [];
  }

  async function saveInteractions(nextInteractions = interactions) {
    const res = await fetch("/api/decks/" + encodeURIComponent(currentDeck.deckId) + "/interactions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interactions: nextInteractions })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudieron guardar las interacciones.");
    interactions = Array.isArray(data.interactions) ? data.interactions : [];
    return data;
  }

  function openModal(deck) {
    if (!deck?.deckId) return;
    ensureModal();
    currentDeck = deck;
    editingIndex = null;
    modal.querySelector("#interactionsDeckTitle").textContent = niceTitle(deck.title || deck.deckId);
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setStatus("Cargando…");
    loadInteractions(deck)
      .then(() => {
        setStatus("");
        renderList();
        renderForm(null);
      })
      .catch((error) => {
        interactions = [];
        renderList();
        renderForm(null);
        setStatus(error.message, "error");
      });
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    currentDeck = null;
    editingIndex = null;
    if (document.getElementById("deckDetailModal")?.hidden) document.body.classList.remove("modal-open");
  }

  function renderList() {
    listNode.innerHTML = "";
    const heading = document.createElement("div");
    heading.className = "interactions-list-heading";
    heading.innerHTML = '<strong>Encuestas</strong>';
    heading.appendChild(makeButton("Crear encuesta", "interactions-small-action", () => renderForm(defaultDraft())));
    listNode.appendChild(heading);

    if (!interactions.length) {
      const empty = document.createElement("p");
      empty.className = "interactions-empty";
      empty.textContent = "Sin encuestas todavía.";
      listNode.appendChild(empty);
      return;
    }

    interactions.forEach((interaction, index) => {
      const item = document.createElement("article");
      item.className = "interaction-list-item";
      const copy = document.createElement("div");
      copy.className = "interaction-list-copy";
      const title = document.createElement("strong");
      title.textContent = interaction.title || "Encuesta";
      const prompt = document.createElement("span");
      prompt.textContent = interaction.prompt || "Sin pregunta";
      const meta = document.createElement("small");
      const count = Array.isArray(interaction.options) ? interaction.options.length : 0;
      meta.textContent = count + " opcion" + (count === 1 ? "" : "es");
      copy.append(title, prompt, meta);
      const actions = document.createElement("div");
      actions.className = "interaction-list-actions";
      actions.append(
        makeButton("Editar", "interactions-text-action", () => renderForm(normalizeForForm(interaction), index)),
        makeButton("Eliminar", "interactions-text-action danger", async () => {
          const next = interactions.filter((_item, itemIndex) => itemIndex !== index);
          try {
            setStatus("Guardando…");
            await saveInteractions(next);
            setStatus("Interacción eliminada.", "success");
            renderList();
            renderForm(null);
          } catch (error) {
            setStatus(error.message, "error");
          }
        })
      );
      item.append(copy, actions);
      listNode.appendChild(item);
    });
  }

  function renderForm(draft, index = null) {
    editingIndex = index;
    formNode.innerHTML = "";
    if (!draft) return;
    const form = document.createElement("form");
    form.className = "interaction-edit-form";
    form.noValidate = true;
    form.innerHTML = '<h3>' + (index === null ? 'Crear encuesta' : 'Editar encuesta') + '</h3><label><span>Título interno</span><input name="title" autocomplete="off"></label><label><span>Pregunta para público</span><textarea name="prompt" rows="3" required></textarea></label><div class="interaction-options-editor"><div class="interaction-options-title"><strong>Opciones</strong></div><div class="interaction-options-fields"></div></div><div class="modal-actions"><button class="secondary-action" type="button" data-cancel>Cancelar</button><button class="primary-action" type="submit">Guardar encuesta</button></div>';
    const title = form.elements.title;
    const prompt = form.elements.prompt;
    const optionsFields = form.querySelector(".interaction-options-fields");
    title.value = draft.title || "";
    prompt.value = draft.prompt || "";

    function renderOptionFields() {
      optionsFields.innerHTML = "";
      draft.options.forEach((option, optionIndex) => {
        const row = document.createElement("label");
        row.className = "interaction-option-field";
        row.innerHTML = '<span>Opción ' + (optionIndex + 1) + '</span><input autocomplete="off"><button type="button" aria-label="Eliminar opción">×</button>';
        const input = row.querySelector("input");
        input.value = option.label || "";
        input.addEventListener("input", () => option.label = input.value);
        row.querySelector("button").disabled = draft.options.length <= MIN_OPTIONS;
        row.querySelector("button").addEventListener("click", () => {
          if (draft.options.length <= MIN_OPTIONS) return;
          draft.options.splice(optionIndex, 1);
          renderOptionFields();
        });
        optionsFields.appendChild(row);
      });
      if (draft.options.length < MAX_OPTIONS) {
        optionsFields.appendChild(makeButton("+ Agregar opción", "interactions-add-option", () => {
          draft.options.push({ id: optionId(draft.options.length), label: "" });
          renderOptionFields();
        }));
      }
    }

    renderOptionFields();
    form.querySelector("[data-cancel]").addEventListener("click", () => renderForm(null));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = normalizeForForm({ ...draft, title: title.value.trim(), prompt: prompt.value.trim() });
      next.options = draft.options.map((option, optionIndex) => ({ id: option.id || optionId(optionIndex), label: String(option.label || "").trim() })).filter((option) => option.label);
      if (!next.prompt) return setStatus("La pregunta para público es obligatoria.", "error");
      if (next.options.length < MIN_OPTIONS) return setStatus("Agrega al menos dos opciones.", "error");
      const saved = [...interactions];
      if (editingIndex === null) saved.push(next);
      else saved[editingIndex] = next;
      try {
        setStatus("Guardando…");
        await saveInteractions(saved);
        setStatus("Encuesta guardada.", "success");
        renderList();
        renderForm(null);
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
    formNode.appendChild(form);
    window.setTimeout(() => title.focus(), 20);
  }

  function appendInteractionsButton(deck) {
    const actions = document.getElementById("detailActions");
    if (!actions || actions.querySelector(".role-interactions")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-role-action role-interactions";
    button.textContent = "Interacciones";
    button.title = "Crear o editar encuestas de este deck";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openModal(deck);
    });
    actions.appendChild(button);
  }

  function patchDetailActions() {
    const original = window.renderDetailActions;
    if (typeof original !== "function" || original.__interactionsPatched) return;
    window.renderDetailActions = function patchedRenderDetailActions(deck) {
      original(deck);
      appendInteractionsButton(deck);
    };
    window.renderDetailActions.__interactionsPatched = true;
  }

  patchDetailActions();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) closeModal();
  });
})();
