(function () {
  const MAX_OPTIONS = 6;
  const MIN_OPTIONS = 2;
  const optionLetters = "abcdefghijklmnopqrstuvwxyz";
  const optionDotClasses = ["dot-a", "dot-b", "dot-c", "dot-d", "dot-e", "dot-f"];
  let currentDeck = null;
  let interactions = [];
  let editingIndex = null;
  let pendingDeleteIndex = null;
  let pollsOpen = false;
  let modal = null;
  let listNode = null;
  let formNode = null;
  let statusNode = null;

  function niceTitle(value) {
    return String(value || "Presentación").replace(/[-_]+/g, " ").trim() || "Presentación";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
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

  function moduleIconSvg(kind) {
    const icons = {
      polls: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"></path><path d="M13 9a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"></path><path d="M3 20l18 0"></path></svg>',
      raffles: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8m0 1a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1z"></path><path d="M12 8l0 13"></path><path d="M19 12l0 7a2 2 0 0 1 -2 2l-10 0a2 2 0 0 1 -2 -2l0 -7"></path><path d="M7.5 8a2.5 2.5 0 0 1 0 -5c1.6 0 3 1.5 4.5 5c1.5 -3.5 2.9 -5 4.5 -5a2.5 2.5 0 0 1 0 5"></path></svg>',
      contests: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21l8 0"></path><path d="M12 17l0 4"></path><path d="M7 4l10 0"></path><path d="M17 4v8a5 5 0 0 1 -10 0v-8"></path><path d="M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path><path d="M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path></svg>',
      games: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h4a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z"></path><path d="M14 7h4a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z"></path><path d="M7 13h2"></path><path d="M15 13h2"></path></svg>'
    };
    return icons[kind] || icons.polls;
  }

  function pollSummary() {
    const fixed = interactions.filter((item) => item?.slide_id).length;
    const free = Math.max(0, interactions.length - fixed);
    const title = interactions.length + " Encuesta" + (interactions.length === 1 ? "" : "s");
    const parts = [];
    if (free) parts.push(free + " libre" + (free === 1 ? "" : "s"));
    if (fixed) parts.push(fixed + " fija" + (fixed === 1 ? "" : "s"));
    return { title, detail: parts.join(" · ") };
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop interactions-backdrop";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<section class="interactions-modal" role="dialog" aria-modal="true" aria-labelledby="interactionsTitle"><button class="interactions-close" type="button" aria-label="Cerrar interacciones">×</button><div class="interactions-scroll"><div class="interactions-header"><span>Interacciones</span><h2 id="interactionsTitle">Interacciones</h2><p id="interactionsDeckTitle"></p></div><div class="interactions-status" aria-live="polite"></div><div class="interactions-list"></div><div class="interactions-form-wrap"></div></div></section>';
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
    pendingDeleteIndex = null;
    pollsOpen = false;
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
    pendingDeleteIndex = null;
    pollsOpen = false;
    if (document.getElementById("deckDetailModal")?.hidden) document.body.classList.remove("modal-open");
  }

  function moduleCardMarkup(kind, title, detail, enabled) {
    const disabled = enabled ? "" : " disabled";
    const soon = enabled ? "" : '<span class="interaction-module-badge">Próximamente</span>';
    return '<button type="button" class="interaction-module-card ' + kind + '" data-module="' + kind + '"' + disabled + '><span class="interaction-module-icon">' + moduleIconSvg(kind) + '</span><span class="interaction-module-copy"><strong>' + title + '</strong>' + (detail ? '<small>' + detail + '</small>' : '') + '</span>' + soon + '</button>';
  }

  function renderHub() {
    const summary = pollSummary();
    const pollDetail = interactions.length ? summary.detail : "";
    const hub = document.createElement("section");
    hub.className = "interactions-hub";
    hub.innerHTML = '<div class="interactions-hub-top"><div><strong>Interacciones</strong><span>Prepara encuestas y dinámicas para este deck.</span></div></div><div class="interaction-module-grid">' + moduleCardMarkup("polls", summary.title, pollDetail, true) + moduleCardMarkup("raffles", "Sorteos", "", false) + moduleCardMarkup("contests", "Concursos", "", false) + moduleCardMarkup("games", "Juegos", "", false) + '</div><div class="interactions-hub-actions"><button type="button" class="interactions-small-action interactions-main-cta">Nueva interacción</button></div>';
    hub.querySelector('[data-module="polls"]').addEventListener("click", () => { pollsOpen = true; pendingDeleteIndex = null; renderList(); renderForm(null); });
    hub.querySelector(".interactions-main-cta").addEventListener("click", () => { pollsOpen = true; pendingDeleteIndex = null; renderList(); renderForm(defaultDraft()); });
    return hub;
  }

  function renderDeleteConfirm(interaction, index) {
    const confirm = document.createElement("div");
    confirm.className = "interaction-delete-confirm";
    confirm.innerHTML = '<div><strong>¿Eliminar esta encuesta?</strong><span>' + escapeHtml(interaction.title || interaction.prompt || "Encuesta") + '</span><p>Esta acción no se puede deshacer.</p></div><div class="interaction-delete-actions"></div>';
    const actions = confirm.querySelector(".interaction-delete-actions");
    actions.append(
      makeButton("Cancelar", "interactions-text-action", () => {
        pendingDeleteIndex = null;
        renderList();
      }),
      makeButton("Eliminar encuesta", "interactions-text-action danger solid", async () => {
        const next = interactions.filter((_item, itemIndex) => itemIndex !== index);
        try {
          setStatus("Guardando…");
          await saveInteractions(next);
          pendingDeleteIndex = null;
          setStatus("Interacción eliminada.", "success");
          renderList();
          renderForm(null);
        } catch (error) {
          setStatus(error.message, "error");
        }
      })
    );
    return confirm;
  }

  function renderPollList() {
    const section = document.createElement("section");
    section.className = "interactions-polls-section";
    const heading = document.createElement("div");
    heading.className = "interactions-list-heading";
    heading.innerHTML = '<div><strong>Encuestas</strong><span>Crea preguntas que Speaker o Stage pueden lanzar cuando quieran.</span></div>';
    heading.appendChild(makeButton("Crear encuesta", "interactions-small-action", () => { pendingDeleteIndex = null; renderForm(defaultDraft()); }));
    section.appendChild(heading);

    if (!interactions.length) {
      const empty = document.createElement("p");
      empty.className = "interactions-empty";
      empty.textContent = "Sin encuestas todavía.";
      section.appendChild(empty);
      return section;
    }

    const list = document.createElement("div");
    list.className = "interaction-list-stack";
    interactions.forEach((interaction, index) => {
      const item = document.createElement("article");
      item.className = "interaction-list-item";
      const count = Array.isArray(interaction.options) ? interaction.options.length : 0;
      const activation = interaction.slide_id ? "fija" : "libre";
      item.innerHTML = '<div class="interaction-list-copy"><strong>' + escapeHtml(interaction.title || "Encuesta") + '</strong><span>' + escapeHtml(interaction.prompt || "Sin pregunta") + '</span><small>' + count + ' opcion' + (count === 1 ? '' : 'es') + ' · ' + activation + '</small></div><div class="interaction-list-actions"></div>';
      const actions = item.querySelector(".interaction-list-actions");
      actions.append(
        makeButton("Editar", "interactions-text-action", () => { pendingDeleteIndex = null; renderForm(normalizeForForm(interaction), index); }),
        makeButton("Eliminar", "interactions-text-action danger", () => {
          pendingDeleteIndex = index;
          renderList();
          renderForm(null);
        })
      );
      list.appendChild(item);
      if (pendingDeleteIndex === index) list.appendChild(renderDeleteConfirm(interaction, index));
    });
    section.appendChild(list);
    return section;
  }

  function renderList() {
    listNode.innerHTML = "";
    listNode.appendChild(renderHub());
    if (pollsOpen) listNode.appendChild(renderPollList());
  }

  function renderForm(draft, index = null) {
    editingIndex = index;
    formNode.innerHTML = "";
    if (!draft) return;
    pendingDeleteIndex = null;
    pollsOpen = true;
    renderList();
    const form = document.createElement("form");
    form.className = "interaction-edit-form";
    form.noValidate = true;
    form.innerHTML = '<div class="interaction-form-header"><span>Encuesta</span><h3>' + (index === null ? 'Crear encuesta' : 'Editar encuesta') + '</h3></div><label><span>Título interno</span><input name="title" autocomplete="off" placeholder="Ej. Pulso inicial de audiencia"></label><label><span>Pregunta visible para público</span><textarea name="prompt" rows="3" required placeholder="¿Qué esperas de esta sesión?"></textarea></label><div class="interaction-activation"><span>Activación</span><div class="interaction-segmented" role="group" aria-label="Activación"><button type="button" class="is-active">Libre</button><button type="button" disabled>Fijar a slide <small>Próximamente</small></button></div><p>Speaker o Stage la lanzan cuando quieran.</p></div><div class="interaction-options-editor"><div class="interaction-options-title"><strong>Opciones</strong></div><div class="interaction-options-fields"></div></div><div class="modal-actions"><button class="secondary-action" type="button" data-cancel>Cancelar</button><button class="primary-action" type="submit">Guardar encuesta</button></div>';
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
        row.innerHTML = '<span class="interaction-option-dot ' + optionDotClasses[optionIndex % optionDotClasses.length] + '" aria-hidden="true"></span><input autocomplete="off" placeholder="Opción ' + (optionIndex + 1) + '"><button type="button" aria-label="Eliminar opción">×</button>';
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
      if (!next.prompt) return setStatus("La pregunta visible para público es obligatoria.", "error");
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
    button.title = "Crear o editar interacciones de este deck";
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
