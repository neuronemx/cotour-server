(function () {
  const MAX_OPTIONS = 6;
  const MIN_OPTIONS = 2;
  const optionLetters = "abcdefghijklmnopqrstuvwxyz";
  const optionDotClasses = ["dot-a", "dot-b", "dot-c", "dot-d", "dot-e", "dot-f"];
  let currentDeck = null;
  let interactions = [];
  let contests = [];
  let assessments = [];
  let editingIndex = null;
  let pendingDeleteIndex = null;
  let activeModule = null;
  let activeDraft = null;
  let modal = null;
  let listNode = null;
  let statusNode = null;

  function canEditContent() {
    return !currentDeck?.readOnly || currentDeck?.demoEditable === true;
  }

  function canChangeStructure() {
    return !currentDeck?.readOnly;
  }

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
      polls: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z"></path><path d="M5 20h14"></path><path d="M8 15v-4"></path><path d="M12 15v-7"></path><path d="M16 15v-5"></path><path d="M8 7h2"></path></svg>',
      assessments: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"></path><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2"></path><path d="M9 14l2 2l4 -4"></path></svg>',
      contests: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21l8 0"></path><path d="M12 17l0 4"></path><path d="M7 4l10 0"></path><path d="M17 4v8a5 5 0 0 1 -10 0v-8"></path><path d="M5 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path><path d="M19 9m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"></path></svg>',
    };
    return icons[kind] || icons.polls;
  }

  function pollSummary() {
    const fixed = interactions.filter((item) => item?.slide_id).length;
    const free = Math.max(0, interactions.length - fixed);
    const title = interactions.length + " Encuesta" + (interactions.length === 1 ? "" : "s");
    const parts = [];
    if (fixed) parts.push(fixed + " fija" + (fixed === 1 ? "" : "s"));
    if (free) parts.push(free + " libre" + (free === 1 ? "" : "s"));
    return { title, detail: parts.join(" · ") };
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop interactions-backdrop";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<section class="interactions-modal" role="dialog" aria-modal="true" aria-labelledby="interactionsTitle"><button class="interactions-close" type="button" aria-label="Cerrar interacciones">×</button><div class="interactions-scroll"><div class="interactions-header"><h2 id="interactionsTitle">Interacciones</h2><p id="interactionsDeckTitle"></p></div><div class="interactions-status" aria-live="polite"></div><div class="interactions-list"></div></div></section>';
    document.body.appendChild(modal);
    listNode = modal.querySelector(".interactions-list");
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
    contests = Array.isArray(data.contests) ? data.contests : [];
    assessments = Array.isArray(data.assessments) ? data.assessments : [];
  }

  async function saveInteractions(nextInteractions = interactions, nextContests = contests, nextAssessments = assessments) {
    const res = await fetch("/api/decks/" + encodeURIComponent(currentDeck.deckId) + "/interactions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactions: nextInteractions,
        contests: nextContests,
        assessments: nextAssessments
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudieron guardar las interacciones.");
    interactions = Array.isArray(data.interactions) ? data.interactions : [];
    contests = Array.isArray(data.contests) ? data.contests : [];
    assessments = Array.isArray(data.assessments) ? data.assessments : [];
    return data;
  }

  function openModal(deck) {
    if (!deck?.deckId) return;
    ensureModal();
    currentDeck = deck;
    editingIndex = null;
    pendingDeleteIndex = null;
    activeModule = null;
    activeDraft = null;
    modal.querySelector("#interactionsDeckTitle").textContent = niceTitle(deck.title || deck.deckId);
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setStatus("Cargando…");
    loadInteractions(deck)
      .then(() => {
        setStatus("");
        renderList();
      })
      .catch((error) => {
        interactions = [];
        renderList();
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
    activeModule = null;
    activeDraft = null;
    if (document.getElementById("deckDetailModal")?.hidden) document.body.classList.remove("modal-open");
  }

  function moduleCardMarkup(kind, title, detail, options = {}) {
    const enabled = options.enabled !== false;
    const plan = options.plan || "";
    const selected = activeModule === kind;
    const classes = ["interaction-module-card", kind, selected ? "is-active" : "", enabled ? "" : "is-locked"].filter(Boolean).join(" ");
    const trailing = plan
      ? '<span class="interaction-module-badge">' + escapeHtml(plan) + '</span>'
      : '<svg class="interaction-module-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
    const disabled = enabled ? "" : " disabled aria-disabled=\"true\"";
    const expanded = ['polls', 'contests', 'assessments'].includes(kind) ? ' aria-expanded="' + String(selected) + '"' : "";
    return '<button type="button" class="' + classes + '" data-module="' + kind + '"' + expanded + disabled + '><span class="interaction-module-icon">' + moduleIconSvg(kind) + '</span><span class="interaction-module-copy"><strong>' + escapeHtml(title) + '</strong>' + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '') + '</span>' + trailing + '</button>';
  }

  function renderHub() {
    const summary = pollSummary();
    const pollDetail = interactions.length
      ? interactions.length + " creada" + (interactions.length === 1 ? "" : "s") + (summary.detail ? " · " + summary.detail : "")
      : "Ninguna creada · Selecciona para comenzar";
    const hub = document.createElement("section");
    hub.className = "interactions-hub";
    hub.innerHTML = '<p class="interactions-section-label">Disponibles para este deck</p><div class="interaction-module-list">'
      + moduleCardMarkup("polls", "Encuestas", pollDetail, { enabled: true })
      + moduleCardMarkup("assessments", "Evaluaciones", assessments.length + " creada" + (assessments.length === 1 ? "" : "s"), { enabled: true })
      + moduleCardMarkup("contests", "Trivias", contests.length + " creada" + (contests.length === 1 ? "" : "s") + " · clasificación en vivo", { enabled: true })
      + '</div>';
    hub.querySelectorAll('[data-module]:not(:disabled)').forEach((button) => button.addEventListener("click", () => {
      const kind = button.dataset.module;
      activeModule = activeModule === kind ? null : kind;
      activeDraft = null;
      editingIndex = null;
      pendingDeleteIndex = null;
      renderList();
    }));
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
          activeDraft = null;
          editingIndex = null;
          setStatus("Interacción eliminada.", "success");
          renderList();
        } catch (error) {
          setStatus(error.message, "error");
        }
      })
    );
    return confirm;
  }

  function renderPollForm(draft, index = null) {
    editingIndex = index;
    const form = document.createElement("form");
    form.className = "interaction-edit-form";
    form.noValidate = true;
    form.innerHTML = '<div class="interaction-form-header"><h3>' + (index === null ? 'Crear encuesta' : 'Editar encuesta') + '</h3></div><label><span>Título interno</span><input name="title" autocomplete="off" placeholder="Ej. Pulso inicial de audiencia"></label><label><span>Pregunta visible para público</span><textarea name="prompt" rows="3" required placeholder="¿Qué esperas de esta sesión?"></textarea></label><div class="interaction-activation"><span>Activación</span><div class="interaction-segmented" role="group" aria-label="Activación"><button type="button" class="is-active">Libre</button><button type="button" disabled>Fijar a slide <small>Próximamente</small></button></div><p>Speaker o Stage la lanzan cuando quieran.</p></div><div class="interaction-options-editor"><div class="interaction-options-title"><strong>Opciones</strong></div><div class="interaction-options-fields"></div></div><div class="modal-actions"><button class="secondary-action" type="button" data-cancel>Cancelar</button><button class="primary-action" type="submit">Guardar encuesta</button></div>';
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
        row.querySelector("button").hidden = !canChangeStructure();
        row.querySelector("button").disabled = draft.options.length <= MIN_OPTIONS;
        row.querySelector("button").addEventListener("click", () => {
          if (draft.options.length <= MIN_OPTIONS) return;
          draft.options.splice(optionIndex, 1);
          renderOptionFields();
        });
        optionsFields.appendChild(row);
      });
      if (canChangeStructure() && draft.options.length < MAX_OPTIONS) {
        optionsFields.appendChild(makeButton("+ Agregar opción", "interactions-add-option", () => {
          draft.options.push({ id: optionId(draft.options.length), label: "" });
          renderOptionFields();
        }));
      }
    }

    renderOptionFields();
    form.querySelector("[data-cancel]").addEventListener("click", () => {
      activeDraft = null;
      editingIndex = null;
      renderList();
    });
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
        activeDraft = null;
        editingIndex = null;
        setStatus("Encuesta guardada.", "success");
        renderList();
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
    window.setTimeout(() => title.focus(), 20);
    return form;
  }

  function renderPollPanel() {
    const section = document.createElement("section");
    section.className = "interactions-polls-section";

    if (activeDraft) {
      section.appendChild(renderPollForm(activeDraft, editingIndex));
      return section;
    }

    if (!interactions.length) {
      const empty = document.createElement("p");
      empty.className = "interactions-empty";
      empty.textContent = "Aún no hay ninguna.";
      section.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "interaction-list-stack";
      interactions.forEach((interaction, index) => {
        const item = document.createElement("article");
        item.className = "interaction-list-item";
        const count = Array.isArray(interaction.options) ? interaction.options.length : 0;
        const activation = interaction.slide_id ? "fija" : "libre";
        item.innerHTML = '<div class="interaction-list-copy"><strong>' + escapeHtml(interaction.title || "Sin título") + '</strong><span>' + escapeHtml(interaction.prompt || "Sin pregunta") + '</span><small>' + count + ' opcion' + (count === 1 ? '' : 'es') + ' · ' + activation + '</small></div><div class="interaction-list-actions"></div>';
        const actions = item.querySelector(".interaction-list-actions");
        if (canEditContent()) {
          actions.append(makeButton("Editar", "interactions-text-action", () => {
              pendingDeleteIndex = null;
              activeDraft = normalizeForForm(interaction);
              editingIndex = index;
              renderList();
            }));
          if (canChangeStructure()) actions.append(makeButton("Eliminar", "interactions-text-action danger", () => {
              pendingDeleteIndex = index;
              activeDraft = null;
              editingIndex = null;
              renderList();
            }));
        }
        list.appendChild(item);
        if (pendingDeleteIndex === index) list.appendChild(renderDeleteConfirm(interaction, index));
      });
      section.appendChild(list);
    }

    if (canChangeStructure()) {
      section.appendChild(makeButton("Crear encuesta", "interactions-create-action", () => {
        pendingDeleteIndex = null;
        activeDraft = defaultDraft();
        editingIndex = null;
        renderList();
      }));
    }
    return section;
  }

  function knowledgeId(category) {
    return category + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function defaultKnowledgeDraft(category) {
    return {
      id: knowledgeId(category),
      category,
      title: "",
      identificationMode: "anonymous",
      questionDurationSeconds: category === "contest" ? 15 : null,
      durationSeconds: category === "assessment" ? 900 : null,
      questions: [{
        id: knowledgeId("question"),
        prompt: "",
        image: null,
        correctOptionId: "option-1",
        options: [
          { id: "option-1", label: "" },
          { id: "option-2", label: "" }
        ]
      }]
    };
  }

  function knowledgeList(category) {
    return category === "contest" ? contests : assessments;
  }

  async function uploadKnowledgeQuestionImage(question, file) {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) throw new Error("La imagen debe pesar máximo 5 MB.");
    if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      throw new Error("La imagen debe ser PNG, JPG o WebP.");
    }
    const body = new FormData();
    body.append("image", file);
    const response = await fetch(
      "/api/decks/" + encodeURIComponent(currentDeck.deckId)
        + "/knowledge-questions/" + encodeURIComponent(question.id) + "/image",
      { method: "POST", body }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo guardar la imagen.");
    return data.image;
  }

  function knowledgeQuestionEditor(question, questionIndex, rerender) {
    const node = document.createElement("fieldset");
    node.className = "knowledge-question-editor";
    node.innerHTML = '<legend>Pregunta ' + (questionIndex + 1) + '</legend><label><span>Pregunta</span><textarea rows="2" required placeholder="Escribe la pregunta"></textarea></label><div class="knowledge-question-image-field"><div class="knowledge-question-image-preview"></div><div class="knowledge-question-image-copy"><strong>Imagen opcional</strong><span>PNG, JPG o WebP · máximo 5 MB</span><div class="knowledge-question-image-actions"><button type="button" data-select-image></button><button type="button" data-remove-image>Eliminar</button></div></div><input type="file" data-image-input accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"></div><div class="knowledge-option-editors"></div><div class="knowledge-question-actions"></div>';
    const prompt = node.querySelector("textarea");
    prompt.value = question.prompt || "";
    prompt.addEventListener("input", () => question.prompt = prompt.value);
    const preview = node.querySelector(".knowledge-question-image-preview");
    const selectImage = node.querySelector("[data-select-image]");
    const removeImage = node.querySelector("[data-remove-image]");
    const imageInput = node.querySelector("[data-image-input]");
    if (question.image?.url) {
      const image = document.createElement("img");
      image.src = question.image.url;
      image.alt = "Imagen de la pregunta " + (questionIndex + 1);
      preview.appendChild(image);
    } else {
      preview.innerHTML = '<span>Sin imagen</span>';
    }
    selectImage.textContent = question.image?.url ? "Cambiar imagen" : "Agregar imagen";
    removeImage.hidden = !question.image?.url;
    selectImage.addEventListener("click", () => imageInput.click());
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files?.[0];
      if (!file) return;
      try {
        selectImage.disabled = true;
        setStatus("Subiendo imagen…");
        question.image = await uploadKnowledgeQuestionImage(question, file);
        setStatus("Imagen guardada.", "success");
        rerender();
      } catch (error) {
        selectImage.disabled = false;
        imageInput.value = "";
        setStatus(error.message, "error");
      }
    });
    removeImage.addEventListener("click", () => {
      question.image = null;
      setStatus("La imagen se eliminará al guardar.", "success");
      rerender();
    });
    const optionsNode = node.querySelector(".knowledge-option-editors");
    question.options.forEach((option, optionIndex) => {
      const row = document.createElement("label");
      row.className = "knowledge-option-editor";
      row.innerHTML = '<input type="radio" name="correct-' + escapeHtml(question.id) + '" aria-label="Marcar como correcta"><input type="text" autocomplete="off" placeholder="Opción ' + (optionIndex + 1) + '"><button type="button" aria-label="Eliminar opción">×</button>';
      const radio = row.querySelector('[type="radio"]');
      const input = row.querySelector('[type="text"]');
      radio.checked = question.correctOptionId === option.id;
      radio.addEventListener("change", () => question.correctOptionId = option.id);
      input.value = option.label || "";
      input.addEventListener("input", () => option.label = input.value);
      const remove = row.querySelector("button");
      remove.hidden = !canChangeStructure();
      remove.disabled = question.options.length <= MIN_OPTIONS;
      remove.addEventListener("click", () => {
        if (question.options.length <= MIN_OPTIONS) return;
        const removed = question.options.splice(optionIndex, 1)[0];
        if (removed.id === question.correctOptionId) question.correctOptionId = question.options[0].id;
        rerender();
      });
      optionsNode.appendChild(row);
    });
    if (canChangeStructure() && question.options.length < MAX_OPTIONS) {
      optionsNode.appendChild(makeButton("+ Agregar opción", "interactions-add-option", () => {
        const option = { id: knowledgeId("option"), label: "" };
        question.options.push(option);
        if (!question.correctOptionId) question.correctOptionId = option.id;
        rerender();
      }));
    }
    if (canChangeStructure() && activeDraft.questions.length > 1) {
      node.querySelector(".knowledge-question-actions").appendChild(makeButton("Eliminar pregunta", "interactions-text-action danger", () => {
        activeDraft.questions.splice(questionIndex, 1);
        rerender();
      }));
    }
    return node;
  }

  function renderKnowledgeForm(category, draft, index) {
    const noun = category === "contest" ? "trivia" : "evaluación";
    const form = document.createElement("form");
    form.className = "interaction-edit-form knowledge-definition-form";
    form.noValidate = true;
    form.innerHTML = '<div class="interaction-form-header"><span>' + (index === null ? "Crear" : "Editar") + '</span><h3>' + (category === "contest" ? "Trivia" : "Evaluación") + '</h3></div>'
      + '<label><span>Título</span><input name="title" maxlength="240" required placeholder="Ej. Conocimiento del producto"></label>'
      + '<label><span>Identificación</span><select name="identificationMode"><option value="anonymous">Anónima</option><option value="optional_name">Nombre opcional</option><option value="required_name">Nombre obligatorio</option></select></label>'
      + (category === "contest"
        ? '<label><span>Tiempo por pregunta (segundos)</span><input name="duration" type="number" min="5" max="300" required></label>'
        : '<label><span>Tiempo total (minutos)</span><input name="duration" type="number" min="1" max="180" required></label>')
      + (category === "contest" ? '<p class="knowledge-duration-estimate" data-knowledge-estimate></p>' : "")
      + '<div class="knowledge-questions-editor"></div><button type="button" class="interactions-add-option" data-add-question' + (canChangeStructure() ? '' : ' hidden') + '>+ Agregar pregunta</button>'
      + '<div class="modal-actions"><button class="secondary-action" type="button" data-cancel>Cancelar</button><button class="primary-action" type="submit">Guardar ' + noun + "</button></div>";
    form.elements.title.value = draft.title || "";
    form.elements.identificationMode.value = draft.identificationMode || "anonymous";
    form.elements.duration.value = category === "contest"
      ? draft.questionDurationSeconds || 15
      : Math.max(1, Math.round((draft.durationSeconds || 900) / 60));
    const questionsNode = form.querySelector(".knowledge-questions-editor");
    const updateEstimate = () => {
      const output = form.querySelector("[data-knowledge-estimate]");
      if (!output) return;
      const seconds = 5 + draft.questions.length * (Math.max(5, Number(form.elements.duration.value) || 15) + 5);
      const minutes = Math.floor(seconds / 60);
      output.textContent = "Duración estimada: " + (minutes ? minutes + " min " : "") + (seconds % 60) + " s";
    };
    const renderQuestions = () => {
      questionsNode.innerHTML = "";
      draft.questions.forEach((question, questionIndex) => {
        questionsNode.appendChild(knowledgeQuestionEditor(question, questionIndex, renderQuestions));
      });
      updateEstimate();
    };
    renderQuestions();
    form.elements.duration.addEventListener("input", updateEstimate);
    form.querySelector("[data-add-question]").addEventListener("click", () => {
      if (draft.questions.length >= 100) return;
      const nextQuestion = defaultKnowledgeDraft(category).questions[0];
      draft.questions.push(nextQuestion);
      renderQuestions();
    });
    form.querySelector("[data-cancel]").addEventListener("click", () => {
      activeDraft = null;
      editingIndex = null;
      renderList();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      draft.title = form.elements.title.value.trim();
      draft.identificationMode = form.elements.identificationMode.value;
      if (category === "contest") draft.questionDurationSeconds = Number(form.elements.duration.value);
      else draft.durationSeconds = Number(form.elements.duration.value) * 60;
      draft.questions = draft.questions.map((question) => ({
        ...question,
        prompt: String(question.prompt || "").trim(),
        options: question.options.map((option) => ({ ...option, label: String(option.label || "").trim() })).filter((option) => option.label)
      }));
      if (!draft.title) return setStatus("El título es obligatorio.", "error");
      if (draft.questions.some((question) => !question.prompt || question.options.length < MIN_OPTIONS || !question.options.some((option) => option.id === question.correctOptionId))) {
        return setStatus("Cada pregunta necesita texto, al menos dos opciones y una respuesta correcta.", "error");
      }
      const next = knowledgeList(category).slice();
      if (index === null) next.push(draft);
      else next[index] = draft;
      try {
        setStatus("Guardando…");
        await saveInteractions(interactions, category === "contest" ? next : contests, category === "assessment" ? next : assessments);
        activeDraft = null;
        editingIndex = null;
        setStatus((category === "contest" ? "Trivia" : "Evaluación") + " guardada.", "success");
        renderList();
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
    return form;
  }

  function renderKnowledgePanel(category) {
    const section = document.createElement("section");
    section.className = "interactions-polls-section knowledge-definitions-section";
    const items = knowledgeList(category);
    if (activeDraft) {
      section.appendChild(renderKnowledgeForm(category, activeDraft, editingIndex));
      return section;
    }
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "interactions-empty";
      empty.textContent = "Aún no hay ninguno.";
      section.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "interaction-list-stack";
      items.forEach((item, index) => {
        const card = document.createElement("article");
        card.className = "interaction-list-item";
        card.innerHTML = '<div class="interaction-list-copy"><strong>' + escapeHtml(item.title) + '</strong><span>' + item.questions.length + ' preguntas</span><small>' + (category === "contest" ? item.questionDurationSeconds + " s por pregunta" : Math.round(item.durationSeconds / 60) + " min") + '</small></div><div class="interaction-list-actions"></div>';
        const actions = card.querySelector(".interaction-list-actions");
        if (canEditContent()) {
          actions.append(makeButton("Editar", "interactions-text-action", () => {
              activeDraft = JSON.parse(JSON.stringify(item));
              editingIndex = index;
              renderList();
            }));
          if (canChangeStructure()) actions.append(makeButton("Eliminar", "interactions-text-action danger", async () => {
              if (!window.confirm("¿Eliminar " + (category === "contest" ? "esta trivia" : "esta evaluación") + "?")) return;
              const next = items.filter((_value, itemIndex) => itemIndex !== index);
              try {
                await saveInteractions(interactions, category === "contest" ? next : contests, category === "assessment" ? next : assessments);
                setStatus("Actividad eliminada.", "success");
                renderList();
              } catch (error) {
                setStatus(error.message, "error");
              }
            }));
        }
        list.appendChild(card);
      });
      section.appendChild(list);
    }
    if (canChangeStructure()) {
      section.appendChild(makeButton(category === "contest" ? "Crear trivia" : "Crear evaluación", "interactions-create-action", () => {
        activeDraft = defaultKnowledgeDraft(category);
        editingIndex = null;
        renderList();
      }));
    }
    return section;
  }

  function renderList() {
    listNode.innerHTML = "";
    if (currentDeck?.readOnly) {
      const notice = document.createElement("p");
      notice.className = "interactions-demo-notice";
      notice.textContent = "Práctica temporal: edita textos y respuestas existentes. La cantidad de preguntas y opciones permanece fija y todo vuelve al contenido oficial al desconectarte.";
      listNode.appendChild(notice);
    }
    const hub = renderHub();
    listNode.appendChild(hub);
    if (activeModule === "polls") {
      const pollsButton = hub.querySelector('[data-module="polls"]');
      pollsButton?.after(renderPollPanel());
    } else if (activeModule === "contests" || activeModule === "assessments") {
      const category = activeModule === "contests" ? "contest" : "assessment";
      hub.querySelector('[data-module="' + activeModule + '"]')?.after(renderKnowledgePanel(category));
    }
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
