(function installImmersaQnaControls(global) {
  const REJECTION_MESSAGES = {
    QNA_ALREADY_PROJECTED: "Una pregunta respondida ya no se puede eliminar.",
    QNA_QUESTION_NOT_FOUND: "La pregunta ya no está disponible.",
    QNA_SESSION_NOT_READY: "La sesión de preguntas todavía no está lista.",
    QNA_FORBIDDEN: "Este rol no puede realizar esa acción.",
    QNA_UNAVAILABLE: "Preguntas no está disponible por el momento."
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createController({ socket, role, mount, before = null, compact = false } = {}) {
    if (!socket?.on || !socket?.emit || !mount || !["presenter", "stage"].includes(role)) return null;

    let state = null;
    let open = false;
    let lastFocused = null;

    const button = element("button", "qna-control-button");
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", "Preguntas");
    button.title = "Preguntas";
    if (compact) button.classList.add("control-button", "muted-button", "fx-btn", "is-compact");
    else button.classList.add("toolbar-button");

    const icon = element("img", "qna-control-icon");
    icon.src = "/shared/qna-question-icon.svg";
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    const buttonLabel = element("span", "qna-control-label", "Preguntas");
    const badge = element("span", "qna-control-badge", "0");
    badge.hidden = true;
    button.append(icon, buttonLabel, badge);
    mount.insertBefore(button, before);

    const modal = element("div", "qna-control-modal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="qna-control-backdrop" data-qna-close></div>
      <section class="qna-control-card" role="dialog" aria-modal="true" aria-labelledby="qnaControlTitle">
        <header class="qna-control-head">
          <div>
            <span class="qna-control-eyebrow">Ronda <strong data-qna-round>1</strong></span>
            <h2 id="qnaControlTitle">Preguntas</h2>
          </div>
          <button class="qna-control-close" type="button" data-qna-close aria-label="Cerrar preguntas">×</button>
        </header>
        <div class="qna-control-toolbar">
          <label class="qna-open-switch">
            <input type="checkbox" data-qna-open>
            <span class="qna-open-track" aria-hidden="true"></span>
            <strong>Abrir preguntas</strong>
          </label>
          <button class="qna-new-round" type="button" data-qna-new-round>Nueva ronda</button>
        </div>
        <p class="qna-control-status" data-qna-status aria-live="polite"></p>
        <div class="qna-question-list" data-qna-list></div>
      </section>`;
    document.body.appendChild(modal);

    const round = modal.querySelector("[data-qna-round]");
    const openToggle = modal.querySelector("[data-qna-open]");
    const status = modal.querySelector("[data-qna-status]");
    const list = modal.querySelector("[data-qna-list]");
    const closeButton = modal.querySelector(".qna-control-close");

    function emit(event, payload = {}) {
      status.textContent = "Actualizando…";
      socket.emit(event, payload);
    }

    function updateButton() {
      if (!state) return;
      button.hidden = false;
      const pending = state.questions.filter((question) => !question.answered).length;
      badge.textContent = String(pending);
      badge.hidden = pending === 0;
      button.classList.toggle("is-active", open);
      button.classList.toggle("has-questions", pending > 0);
    }

    function actionButton(label, action, question, className = "") {
      const actionNode = element("button", className, label);
      actionNode.type = "button";
      actionNode.dataset.qnaAction = action;
      actionNode.dataset.questionId = question.id;
      return actionNode;
    }

    function renderQuestion(question) {
      const selected = question.id === state.selectedQuestionId;
      const card = element("article", "qna-question-card");
      card.classList.toggle("is-selected", selected);
      card.classList.toggle("is-answered", Boolean(question.answered));
      card.dataset.questionId = question.id;

      const meta = element("div", "qna-question-meta");
      meta.appendChild(element("span", question.answered ? "is-answered" : "is-pending", question.answered ? "Respondida" : "Nueva"));
      if (selected) meta.appendChild(element("span", "is-selected", "Seleccionada"));

      const questionText = element("p", "qna-question-text", question.text);
      const name = element("p", "qna-question-name");
      if (question.name) {
        name.textContent = question.name;
        if (!question.allowNameOnScreen) name.appendChild(element("small", "", " · oculto en Screen"));
      } else {
        name.textContent = "Anónima";
      }

      const actions = element("div", "qna-question-actions");
      if (!selected) actions.appendChild(actionButton("Seleccionar", "select", question));
      if (selected) actions.appendChild(actionButton("Proyectar", "project", question, "is-primary"));
      if (!question.answered) actions.appendChild(actionButton("Eliminar", "delete", question, "is-danger"));
      card.append(meta, questionText, name, actions);
      return card;
    }

    function render(nextState) {
      if (!nextState || !Array.isArray(nextState.questions)) return;
      state = nextState;
      round.textContent = String(state.roundNumber || 1);
      openToggle.checked = Boolean(state.questionsOpen);
      status.textContent = "";
      list.replaceChildren();
      if (!state.questions.length) {
        const empty = element("div", "qna-question-empty");
        empty.append(
          element("strong", "", "Aún no hay preguntas"),
          element("span", "", state.questionsOpen ? "Esperando al público." : "Activa “Abrir preguntas” para comenzar.")
        );
        list.appendChild(empty);
      } else {
        state.questions.forEach((question) => list.appendChild(renderQuestion(question)));
      }
      updateButton();
    }

    function show() {
      if (!state || open) return;
      open = true;
      lastFocused = document.activeElement;
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      button.setAttribute("aria-expanded", "true");
      updateButton();
      socket.emit("qna:panel_open");
      closeButton.focus();
    }

    function hide() {
      if (!open) return;
      open = false;
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      button.setAttribute("aria-expanded", "false");
      updateButton();
      socket.emit("qna:panel_close");
      lastFocused?.focus?.();
    }

    button.addEventListener("click", show);
    modal.addEventListener("click", (event) => {
      if (event.target.closest("[data-qna-close]")) return hide();
      const actionNode = event.target.closest("[data-qna-action]");
      if (!actionNode) return;
      const questionId = actionNode.dataset.questionId;
      if (actionNode.dataset.qnaAction === "select") emit("qna:select", { questionId });
      if (actionNode.dataset.qnaAction === "project") emit("qna:project", { questionId });
      if (actionNode.dataset.qnaAction === "delete") {
        if (global.confirm("¿Eliminar esta pregunta definitivamente?")) emit("qna:delete", { questionId });
      }
    });
    openToggle.addEventListener("change", () => emit("qna:set_open", { open: openToggle.checked }));
    modal.querySelector("[data-qna-new-round]").addEventListener("click", () => {
      if (global.confirm("¿Comenzar una nueva ronda? La ronda actual quedará archivada.")) emit("qna:new_round");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open) hide();
    });

    socket.on("qna:state", render);
    socket.on("qna:rejected", ({ event, reason } = {}) => {
      if (!String(event || "").startsWith("qna:")) return;
      status.textContent = REJECTION_MESSAGES[reason] || "No fue posible completar la acción.";
      if (state) openToggle.checked = Boolean(state.questionsOpen);
    });

    return { open: show, close: hide, render, button, modal };
  }

  global.ImmersaQnaControls = { create: createController };
})(window);
