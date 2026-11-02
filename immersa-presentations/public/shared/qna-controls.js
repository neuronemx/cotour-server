(function installImmersaQnaControls(global) {
  const REJECTION_MESSAGES = {
    QNA_ALREADY_PROJECTED: "qna.alreadyProjected",
    QNA_QUESTION_NOT_FOUND: "qna.notFound",
    QNA_SESSION_NOT_READY: "qna.sessionNotReady",
    QNA_FORBIDDEN: "qna.forbidden",
    QNA_UNAVAILABLE: "qna.unavailable"
  };

  function tr(key, fallback) { return global.ImmersaI18n?.t(key) || fallback; }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createController({ socket, role, mount, modalMount, before = null, compact = false, launcher = true, onAvailabilityChange } = {}) {
    if (!socket?.on || !socket?.emit || (launcher && !mount) || !["presenter", "stage"].includes(role)) return null;

    let state = null;
    let open = false;
    let lastFocused = null;

    const button = element("button", "qna-control-button");
    button.type = "button";
    button.hidden = true;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-label", tr('qna.title', 'Preguntas'));
    button.title = tr('qna.title', 'Preguntas');
    if (compact) button.classList.add("control-button", "muted-button", "fx-btn", "is-compact");
    else button.classList.add("toolbar-button");

    const icon = element("img", "qna-control-icon");
    icon.src = "/shared/qna-question-icon.svg";
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
    const buttonLabel = element("span", "qna-control-label", tr('qna.title', 'Preguntas'));
    const badge = element("span", "qna-control-badge", "0");
    badge.hidden = true;
    button.append(icon, buttonLabel, badge);
    if (launcher) mount.insertBefore(button, before);

    const modal = element("div", "qna-control-modal");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="qna-control-backdrop" data-qna-close></div>
      <section class="qna-control-card" role="dialog" aria-modal="true" aria-labelledby="qnaControlTitle">
        <header class="qna-control-head">
          <div>
            <span class="qna-control-eyebrow"><span data-i18n="qna.round">Ronda</span> <strong data-qna-round>1</strong></span>
            <h2 id="qnaControlTitle" data-i18n="qna.title">Preguntas</h2>
          </div>
          <button class="qna-control-close" type="button" data-qna-close data-i18n-label="qna.close" aria-label="Cerrar preguntas">×</button>
        </header>
        <div class="qna-control-toolbar">
          <div class="qna-control-secondary-actions">
            <button class="qna-open-button" type="button" data-qna-open aria-pressed="false">Abrir preguntas</button>
            <button class="qna-new-round" type="button" data-qna-new-round data-i18n="qna.newRound">Nueva ronda</button>
          </div>
        </div>
        <p class="qna-control-status" data-qna-status aria-live="polite"></p>
        <div class="qna-question-list" data-qna-list></div>
      </section>`;
    (modalMount || document.body).appendChild(modal);
    global.ImmersaI18n?.apply(modal);

    const round = modal.querySelector("[data-qna-round]");
    const openToggle = modal.querySelector("[data-qna-open]");
    const status = modal.querySelector("[data-qna-status]");
    const list = modal.querySelector("[data-qna-list]");
    const closeButton = modal.querySelector(".qna-control-close");
    const newRoundButton = modal.querySelector("[data-qna-new-round]");

    function emit(event, payload = {}) {
      status.textContent = tr('qna.updating', 'Actualizando…');
      socket.emit(event, payload);
    }

    function updateButton() {
      if (!state) return;
      button.hidden = !launcher;
      const pending = state.questions.filter((question) => !question.answered).length;
      badge.textContent = String(pending);
      badge.hidden = pending === 0;
      button.classList.toggle("is-active", open);
      button.classList.toggle("has-questions", pending > 0);
      onAvailabilityChange?.({ available: true, pending, state });
    }

    function actionButton(label, action, question, className = "") {
      const actionNode = element("button", className, label);
      actionNode.type = "button";
      actionNode.dataset.qnaAction = action;
      actionNode.dataset.questionId = question.id;
      return actionNode;
    }

    function syncOpenButton() {
      const questionsOpen = Boolean(state?.questionsOpen);
      openToggle.textContent = questionsOpen ? tr('qna.close', 'Cerrar preguntas') : tr('qna.open', 'Abrir preguntas');
      openToggle.setAttribute("aria-pressed", String(questionsOpen));
      openToggle.classList.toggle("is-active", questionsOpen);
    }

    function renderQuestion(question) {
      const selected = question.id === state.selectedQuestionId;
      const card = element("article", "qna-question-card");
      card.classList.toggle("is-selected", selected);
      card.classList.toggle("is-answered", Boolean(question.answered));
      card.dataset.questionId = question.id;

      const meta = element("div", "qna-question-meta");
      meta.appendChild(element("span", question.answered ? "is-answered" : "is-pending", question.answered ? tr('qna.projected', 'Proyectada') : tr('qna.new', 'Nueva')));
      if (selected) meta.appendChild(element("span", "is-selected", tr('qna.selected', 'Seleccionada')));

      const questionText = element("p", "qna-question-text", question.text);
      const name = element("p", "qna-question-name");
      if (question.name) {
        name.textContent = question.name;
        if (!question.allowNameOnScreen) name.appendChild(element("small", "", tr('qna.hidden', ' · oculto en Pantalla')));
      } else {
        name.textContent = tr('qna.anonymous', 'Anónima');
      }

      const actions = element("div", "qna-question-actions");
      if (!selected) actions.appendChild(actionButton(tr('qna.select', 'Seleccionar'), "select", question));
      if (selected) actions.appendChild(actionButton(tr('qna.project', 'Proyectar'), "project", question, "is-primary"));
      if (!question.answered) actions.appendChild(actionButton(tr('qna.delete', 'Eliminar'), "delete", question, "is-danger"));
      card.append(meta, questionText, name, actions);
      return card;
    }

    function render(nextState) {
      if (!nextState || !Array.isArray(nextState.questions)) return;
      state = nextState;
      round.textContent = String(state.roundNumber || 1);
      syncOpenButton();
      openToggle.disabled = false;
      newRoundButton.disabled = false;
      status.textContent = "";
      list.replaceChildren();
      if (!state.questions.length) {
        const empty = element("div", "qna-question-empty");
        empty.append(
          element("strong", "", tr('qna.empty', 'Aún no hay preguntas')),
          element("span", "", state.questionsOpen ? tr('qna.waiting', 'Esperando al público.') : tr('qna.openHint', 'Activa “Abrir preguntas” para comenzar.'))
        );
        list.appendChild(empty);
      } else {
        state.questions.forEach((question) => list.appendChild(renderQuestion(question)));
      }
      updateButton();
    }

    function show() {
      if (open) return;
      open = true;
      lastFocused = document.activeElement;
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      button.setAttribute("aria-expanded", "true");
      if (!state) {
        round.textContent = "—";
        openToggle.textContent = tr('qna.open', 'Abrir preguntas');
        openToggle.setAttribute("aria-pressed", "false");
        openToggle.classList.remove("is-active");
        openToggle.disabled = true;
        newRoundButton.disabled = true;
        status.textContent = tr('qna.preparing', 'Preparando preguntas…');
        list.replaceChildren();
        const pending = element("div", "qna-question-empty");
        pending.append(element("strong", "", tr('qna.preparingTitle', 'Preparando Q&A')), element("span", "", tr('qna.wait', 'Espera un momento.')));
        list.appendChild(pending);
      }
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
        if (global.confirm(tr('qna.deleteConfirm', '¿Eliminar esta pregunta definitivamente?'))) emit("qna:delete", { questionId });
      }
    });
    openToggle.addEventListener("click", () => emit("qna:set_open", { open: !Boolean(state?.questionsOpen) }));
    newRoundButton.addEventListener("click", () => {
      if (global.confirm(tr('qna.newRoundConfirm', '¿Comenzar una nueva ronda? La ronda actual quedará archivada.'))) emit("qna:new_round");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open) hide();
    });

    socket.on("qna:state", render);
    socket.on("qna:rejected", ({ event, reason } = {}) => {
      if (!String(event || "").startsWith("qna:")) return;
      status.textContent = tr(REJECTION_MESSAGES[reason] || 'qna.error', 'No fue posible completar la acción.');
      if (state) syncOpenButton();
    });

    global.addEventListener?.('immersa:locale-change', () => {
      button.setAttribute('aria-label', tr('qna.title', 'Preguntas'));
      button.title = tr('qna.title', 'Preguntas');
      buttonLabel.textContent = tr('qna.title', 'Preguntas');
      if (state) render(state);
      else syncOpenButton();
    });
    return { open: show, close: hide, render, button, modal };
  }

  global.ImmersaQnaControls = { create: createController };
})(window);
