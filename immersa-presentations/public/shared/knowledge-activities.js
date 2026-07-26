(function (global) {
  "use strict";

  const LABELS = {
    contest: "Concurso",
    assessment: "Evaluación"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function commandId() {
    return global.crypto?.randomUUID?.()
      || "cmd-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function tabId(storage = global.sessionStorage) {
    const key = "immersaKnowledgeTabId";
    let value = storage?.getItem?.(key) || "";
    if (!value) {
      value = commandId();
      storage?.setItem?.(key, value);
    }
    return value;
  }

  function secondsUntil(value, serverNow, receivedAt) {
    const deadline = Date.parse(value || "");
    const authoritativeBase = Date.parse(serverNow || "");
    const now = Number.isFinite(authoritativeBase) && Number.isFinite(receivedAt)
      ? authoritativeBase + Math.max(0, Date.now() - receivedAt)
      : Date.now();
    return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  }

  function timeLabel(seconds) {
    if (!Number.isFinite(seconds)) return "";
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? minutes + ":" + String(remainder).padStart(2, "0") : String(remainder);
  }

  function stateDeadline(state) {
    if (state?.state === "COUNTDOWN") return state.countdownDeadlineAt;
    if (state?.substate === "QUESTION_ACTIVE") return state.questionDeadlineAt;
    if (state?.substate === "REVEAL") return state.revealDeadlineAt;
    if (state?.category === "assessment" && state?.state === "ACTIVE") return state.deadlineAt;
    return null;
  }

  function createController({ socket, deckId, role, onAvailabilityChange, onStateChange } = {}) {
    if (!socket?.on || !socket?.emit) throw new Error("A socket is required");
    const hosts = new Set();
    let state = { available: false, execution: null };
    let definitions = { contest: [], assessment: [] };
    let loadPromise = null;
    let rejected = null;

    function emitNow(eventName, payload) {
      if (socket.connected === false) {
        rejected = "Sin conexión";
        render();
        return false;
      }
      (socket.volatile || socket).emit(eventName, payload);
      return true;
    }

    function loadDefinitions() {
      if (loadPromise) return loadPromise;
      loadPromise = fetch("/api/decks/" + encodeURIComponent(deckId) + "/interactions", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("No se pudieron cargar las actividades");
          return response.json();
        })
        .then((payload) => {
          definitions = {
            contest: Array.isArray(payload.contests) ? payload.contests : [],
            assessment: Array.isArray(payload.assessments) ? payload.assessments : []
          };
          render();
          return definitions;
        })
        .catch((error) => {
          rejected = error.message;
          render();
          return definitions;
        });
      return loadPromise;
    }

    function emitCommand(intent) {
      if (!state?.executionId) return;
      const event = {
        start: "interaction:execution:start",
        finalize: "interaction:execution:finalize",
        cancel: "interaction:execution:cancel",
        show_results: "interaction:execution:show_results",
        close: "interaction:execution:close",
        retry_processing: "interaction:execution:retry_processing",
        force_results: "interaction:execution:force_results"
      }[intent];
      if (!event) return;
      rejected = null;
      emitNow(event, {
        executionId: state.executionId,
        expectedRevision: state.revision,
        commandId: commandId()
      });
    }

    function openDefinition(category, definitionId) {
      rejected = null;
      emitNow("interaction:execution:open", { category, definitionId });
    }

    function definitionsMarkup(category) {
      const items = definitions[category] || [];
      if (!items.length) {
        return '<div class="knowledge-empty"><strong>No hay ' + (category === "contest" ? "concursos" : "evaluaciones") + ' configurados</strong><span>Créalo desde Deck → Interacciones.</span></div>';
      }
      return '<div class="knowledge-definition-list">' + items.map((item) => {
        const duration = category === "contest"
          ? item.questionDurationSeconds + " s por pregunta"
          : Math.round(item.durationSeconds / 60) + " min";
        return '<button type="button" class="knowledge-definition" data-knowledge-open="' + escapeHtml(item.id) + '">'
          + '<strong>' + escapeHtml(item.title) + '</strong>'
          + '<span>' + item.questions.length + " preguntas · " + escapeHtml(duration) + "</span>"
          + "</button>";
      }).join("") + "</div>";
    }

    function resultMarkup() {
      const result = state.result;
      if (!result) return "";
      const warning = result.excludedResponseCount
        ? '<p class="knowledge-error">Resultados generados. ' + result.excludedResponseCount + " respuestas no pudieron incluirse.</p>"
        : "";
      if (state.category === "contest") {
        const rows = Array.isArray(result.top10) ? result.top10 : [];
        return warning + '<div class="knowledge-ranking">' + (rows.length
          ? rows.map((row) => '<div><b>' + row.position + '</b><span>' + escapeHtml(row.label) + '</span><strong>' + row.correctCount + "/" + row.totalQuestions + "</strong></div>").join("")
          : "<p>Sin participaciones con respuestas.</p>") + "</div>";
      }
      const distribution = (result.gradeDistribution || []).map((bucket) =>
        '<div><span>' + escapeHtml(bucket.range) + '</span><strong>' + bucket.count + "</strong></div>"
      ).join("");
      const questions = (result.questionStatistics || []).map((question, index) =>
        '<div><span>P' + (index + 1) + " · " + escapeHtml(question.prompt) + '</span><strong>' + question.correctPercentage + "%</strong></div>"
      ).join("");
      return warning + '<div class="knowledge-summary"><strong>' + (result.averageGrade ?? 0) + '</strong><span>Promedio · ' + result.participantCount + ' participantes</span></div><div class="knowledge-stats">' + distribution + questions + "</div>";
    }

    function activeMarkup(category) {
      if (state.category !== category) {
        return '<div class="knowledge-empty"><strong>Hay otra interacción en vivo</strong><span>Puedes consultarla desde la fila superior.</span></div>';
      }
      const count = state.effectiveParticipantCount ?? state.participantCount ?? 0;
      const deadline = stateDeadline(state);
      const remaining = secondsUntil(deadline, state.serverNow, state._receivedAt);
      const timer = remaining === null ? "" : '<span class="knowledge-timer">' + timeLabel(remaining) + "</span>";
      let body = '<header class="knowledge-live-head"><div><span>' + LABELS[category] + ' <em>En vivo</em></span><h2>' + escapeHtml(state.title) + "</h2></div>" + timer + "</header>";

      if (state.state === "LOBBY") {
        body += '<div class="knowledge-metric"><strong>' + (state.participantCount || 0) + "</strong><span>en el lobby</span></div>"
          + '<div class="knowledge-actions"><button class="primary" data-knowledge-command="start">Iniciar</button><button data-knowledge-command="cancel">Cancelar</button></div>';
      } else if (state.state === "COUNTDOWN") {
        body += '<div class="knowledge-countdown">' + timeLabel(remaining) + "</div>";
      } else if (state.state === "ACTIVE") {
        if (category === "contest") {
          body += '<div class="knowledge-question-progress"><span>Pregunta ' + (state.questionIndex + 1) + " de " + state.questionCount + "</span><strong>" + escapeHtml(state.currentQuestion?.prompt || "Preparando pregunta…") + "</strong></div>";
        } else {
          body += '<div class="knowledge-metric"><strong>' + (state.submittedCount || 0) + '</strong><span>entregaron · ' + count + " participantes</span></div>";
        }
        body += '<div class="knowledge-actions"><button data-knowledge-command="finalize">Finalizar actividad</button></div>';
      } else if (state.state === "PROCESSING") {
        body += '<div class="knowledge-processing"><span class="knowledge-spinner"></span><strong>Procesando resultados…</strong><small>Las respuestas ya están guardadas.</small></div>';
      } else if (state.state === "PROCESSING_ERROR") {
        body += '<div class="knowledge-empty"><strong>No pudimos terminar de calcular los resultados</strong><span>Las respuestas están guardadas.</span></div>'
          + '<div class="knowledge-actions"><button class="primary" data-knowledge-command="retry_processing">Reintentar procesamiento</button><button data-knowledge-command="force_results">Forzar resultados</button></div>';
      } else if (state.state === "RESULTS_READY") {
        body += resultMarkup() + '<div class="knowledge-actions"><button class="primary" data-knowledge-command="show_results">Mostrar resultados</button><button data-knowledge-command="close">Cerrar</button></div>';
      } else if (state.state === "RESULTS_VISIBLE") {
        body += resultMarkup() + '<div class="knowledge-actions"><button class="primary" data-knowledge-command="close">Cerrar resultados</button></div>';
      }
      if (rejected) body += '<p class="knowledge-error" role="alert">' + escapeHtml(rejected) + "</p>";
      return body;
    }

    function renderHost(host) {
      const active = Boolean(state?.executionId);
      host.root.innerHTML = '<section class="knowledge-controller" data-category="' + host.category + '">'
        + (active ? activeMarkup(host.category) : definitionsMarkup(host.category))
        + (!active && rejected ? '<p class="knowledge-error" role="alert">' + escapeHtml(rejected) + "</p>" : "")
        + "</section>";
      host.root.querySelectorAll("[data-knowledge-open]").forEach((button) => {
        button.addEventListener("click", () => openDefinition(host.category, button.dataset.knowledgeOpen));
      });
      host.root.querySelectorAll("[data-knowledge-command]").forEach((button) => {
        button.addEventListener("click", () => {
          const intent = button.dataset.knowledgeCommand;
          if ((intent === "finalize" || intent === "cancel" || intent === "force_results")
            && !global.confirm(intent === "force_results"
              ? "Immersa reconstruirá los resultados con las respuestas guardadas. ¿Continuar?"
              : "¿Finalizar la actividad ahora? No podrá reabrirse.")) return;
          if (intent === "close" && state.category === "assessment" && state.state === "RESULTS_READY"
            && !global.confirm("¿Cerrar la evaluación sin mostrar las calificaciones?")) return;
          emitCommand(intent);
        });
      });
    }

    function render() {
      hosts.forEach(renderHost);
    }

    function setState(next) {
      state = { ...(next || { available: false, execution: null }), _receivedAt: Date.now() };
      rejected = null;
      render();
      onAvailabilityChange?.(Boolean(state.available));
      onStateChange?.(state);
    }

    socket.on("interaction:execution:state", setState);
    socket.on("interaction:knowledge:rejected", (payload = {}) => {
      rejected = payload.message || "No se pudo completar la acción";
      render();
    });

    loadDefinitions();
    const repaintTimer = global.setInterval(render, 500);
    return {
      mountHost({ root, category }) {
        const host = { root, category };
        hosts.add(host);
        renderHost(host);
        return () => hosts.delete(host);
      },
      getState: () => state,
      reloadDefinitions() {
        loadPromise = null;
        return loadDefinitions();
      },
      destroy() {
        global.clearInterval(repaintTimer);
        hosts.clear();
      }
    };
  }

  function createAudience({ socket, root } = {}) {
    if (!socket?.on || !root) throw new Error("A socket and root are required");
    const currentTabId = tabId();
    let state = null;
    let selectedAssessmentIndex = 0;
    const pendingKey = "immersaKnowledgePendingAnswer";

    function emitNow(eventName, payload) {
      if (socket.connected === false) return false;
      (socket.volatile || socket).emit(eventName, payload);
      return true;
    }

    function answerMap() {
      return new Map((state?.answers || []).map((answer) => [answer.questionId, answer.optionId]));
    }

    function savePending(questionId, optionId) {
      const pending = { executionId: state.executionId, questionId, optionId, tabId: currentTabId };
      try { global.localStorage?.setItem(pendingKey, JSON.stringify(pending)); } catch (_error) {}
      return pending;
    }

    function readPending() {
      try { return JSON.parse(global.localStorage?.getItem(pendingKey) || "null"); } catch (_error) { return null; }
    }

    function clearPending() {
      try { global.localStorage?.removeItem(pendingKey); } catch (_error) {}
    }

    function submitAnswer(questionId, optionId) {
      savePending(questionId, optionId);
      if (!socket.connected) return render();
      emitNow("interaction:participant:submit_answer", {
        questionId,
        optionId,
        tabId: currentTabId,
        clientAttemptId: commandId()
      });
    }

    function registrationMarkup() {
      if (!state.registrationOpen) return '<div class="knowledge-empty"><strong>La actividad ya comenzó</strong><span>Espera la siguiente interacción.</span></div>';
      const mode = state.identificationMode || "anonymous";
      const input = mode === "anonymous" ? "" : '<label>Nombre' + (mode === "optional_name" ? " (opcional)" : "") + '<input data-knowledge-name maxlength="120" autocomplete="name" ' + (mode === "required_name" ? "required" : "") + "></label>";
      return '<div class="knowledge-audience-card"><span>' + LABELS[state.category] + '</span><h2>' + escapeHtml(state.title) + '</h2>' + input + '<button class="primary" data-knowledge-join>Entrar</button></div>';
    }

    function contestMarkup() {
      const question = state.currentQuestion;
      if (!question) {
        if (state.state === "COUNTDOWN") return '<div class="knowledge-countdown">' + timeLabel(secondsUntil(state.countdownDeadlineAt, state.serverNow, state._receivedAt)) + "</div>";
        if (state.state === "PROCESSING" || state.state === "PROCESSING_ERROR") return '<div class="knowledge-processing"><span class="knowledge-spinner"></span><strong>Estamos terminando de preparar los resultados…</strong></div>';
        if (state.personalResult) {
          const detail = (state.personalResult.answers || []).map((answer, index) =>
            '<div class="knowledge-result-detail ' + escapeHtml(answer.status) + '"><b>' + (index + 1) + '</b><span><strong>' + escapeHtml(answer.prompt) + '</strong><small>' + escapeHtml(answer.selectedLabel || "Omitida") + (answer.status === "correct" ? " · Correcta" : " · Correcta: " + escapeHtml(answer.correctLabel)) + "</small></span></div>"
          ).join("");
          return '<div class="knowledge-personal-result"><strong>#' + (state.personalResult.position || "—") + '</strong><span>' + state.personalResult.correctCount + " de " + state.personalResult.totalQuestions + ' correctas · ' + (state.personalResult.correctTimeMs / 1000).toFixed(2) + ' s</span></div><div class="knowledge-result-details">' + detail + "</div>";
        }
        return '<div class="knowledge-empty"><strong>' + escapeHtml(state.title) + "</strong><span>Esperando la siguiente pregunta…</span></div>";
      }
      const confirmed = answerMap().get(question.id);
      const pending = readPending();
      const options = question.options.map((option) => {
        const selected = confirmed === option.id || (!confirmed && pending?.questionId === question.id && pending?.optionId === option.id);
        const revealClass = state.reveal
          ? option.id === state.reveal.correctOptionId ? " is-correct" : selected ? " is-incorrect" : ""
          : "";
        return '<button type="button" data-knowledge-answer="' + escapeHtml(option.id) + '" class="' + (selected ? "is-selected" : "") + revealClass + '" ' + (confirmed || state.substate === "REVEAL" ? "disabled" : "") + ">" + escapeHtml(option.label) + "</button>";
      }).join("");
      return '<div class="knowledge-audience-card"><header><span>Pregunta ' + (state.questionIndex + 1) + " de " + state.questionCount + '</span><strong class="knowledge-timer">' + timeLabel(secondsUntil(state.questionDeadlineAt || state.revealDeadlineAt, state.serverNow, state._receivedAt)) + '</strong></header><h2>' + escapeHtml(question.prompt) + '</h2><div class="knowledge-options">' + options + "</div>"
        + (confirmed ? "<p>Respuesta enviada</p>" : pending ? "<p>Respuesta guardada. Esperando conexión…</p>" : "")
        + "</div>";
    }

    function assessmentMarkup() {
      if (state.personalResult) return '<div class="knowledge-personal-result"><strong>' + state.personalResult.grade + '</strong><span>Calificación</span></div>';
      if (state.submittedAt || state.participant?.submittedAt) return '<div class="knowledge-empty"><strong>Evaluación entregada</strong><span>Espera a que Speaker muestre los resultados.</span></div>';
      const questions = state.questions || [];
      if (!questions.length) return '<div class="knowledge-empty"><strong>' + escapeHtml(state.title) + "</strong><span>Esperando el inicio…</span></div>";
      selectedAssessmentIndex = Math.max(0, Math.min(questions.length - 1, selectedAssessmentIndex));
      const question = questions[selectedAssessmentIndex];
      const confirmed = answerMap().get(question.id);
      const options = question.options.map((option) =>
        '<button type="button" data-knowledge-answer="' + escapeHtml(option.id) + '" class="' + (confirmed === option.id ? "is-selected" : "") + '">' + escapeHtml(option.label) + "</button>"
      ).join("");
      return '<div class="knowledge-audience-card"><header><span>Pregunta ' + (selectedAssessmentIndex + 1) + " de " + questions.length + '</span><strong class="knowledge-timer">' + timeLabel(secondsUntil(state.deadlineAt, state.serverNow, state._receivedAt)) + '</strong></header><h2>' + escapeHtml(question.prompt) + '</h2><div class="knowledge-options">' + options + '</div><div class="knowledge-assessment-nav"><button data-knowledge-prev ' + (selectedAssessmentIndex === 0 ? "disabled" : "") + '>Anterior</button><button data-knowledge-next ' + (selectedAssessmentIndex === questions.length - 1 ? "disabled" : "") + '>Siguiente</button></div><button class="primary" data-knowledge-submit ' + (answerMap().size ? "" : "disabled") + ">Entregar evaluación</button></div>";
    }

    function render() {
      if (!state?.available || !state.executionId) {
        root.hidden = true;
        root.innerHTML = "";
        return;
      }
      root.hidden = false;
      if (!state.participant) root.innerHTML = registrationMarkup();
      else if (state.participant.activeTabId && state.participant.activeTabId !== currentTabId) {
        root.innerHTML = '<div class="knowledge-audience-card"><h2>La actividad está abierta en otra pestaña</h2><button class="primary" data-knowledge-claim>Usar esta pestaña</button></div>';
      } else root.innerHTML = state.category === "contest" ? contestMarkup() : assessmentMarkup();

      root.querySelector("[data-knowledge-join]")?.addEventListener("click", () => {
        const name = root.querySelector("[data-knowledge-name]")?.value || "";
        emitNow("interaction:participant:join", { name, tabId: currentTabId });
      });
      root.querySelector("[data-knowledge-claim]")?.addEventListener("click", () => emitNow("interaction:participant:claim_tab", { tabId: currentTabId }));
      root.querySelectorAll("[data-knowledge-answer]").forEach((button) => button.addEventListener("click", () => {
        const questions = state.category === "contest" ? [state.currentQuestion] : state.questions;
        const question = state.category === "contest" ? state.currentQuestion : questions[selectedAssessmentIndex];
        submitAnswer(question.id, button.dataset.knowledgeAnswer);
      }));
      root.querySelector("[data-knowledge-prev]")?.addEventListener("click", () => { selectedAssessmentIndex -= 1; render(); });
      root.querySelector("[data-knowledge-next]")?.addEventListener("click", () => { selectedAssessmentIndex += 1; render(); });
      root.querySelector("[data-knowledge-submit]")?.addEventListener("click", () => {
        if (global.confirm("¿Entregar la evaluación? Ya no podrás cambiar tus respuestas.")) {
          emitNow("interaction:participant:submit_evaluation", { tabId: currentTabId });
        }
      });
    }

    socket.on("interaction:execution:state", (next) => {
      state = { ...next, _receivedAt: Date.now() };
      const pending = readPending();
      const activeQuestionId = state?.category === "contest" ? state.currentQuestion?.id : pending?.questionId;
      const confirmed = (state?.answers || []).some((answer) => answer.questionId === pending?.questionId);
      if (pending && (pending.executionId !== state?.executionId || confirmed || (state?.category === "contest" && activeQuestionId !== pending.questionId))) clearPending();
      render();
      if (pending && socket.connected && pending.executionId === state?.executionId && !confirmed && state?.state === "ACTIVE") {
        if (state.category === "assessment" || state.currentQuestion?.id === pending.questionId) {
          emitNow("interaction:participant:submit_answer", {
            questionId: pending.questionId,
            optionId: pending.optionId,
            tabId: currentTabId,
            clientAttemptId: commandId()
          });
        }
      }
    });
    socket.on("interaction:answer:accepted", () => clearPending());
    socket.on("interaction:knowledge:rejected", (payload = {}) => {
      if (["DEADLINE_PASSED", "INVALID_STATE"].includes(payload.reason)) clearPending();
    });
    socket.on("connect", render);
    socket.on("disconnect", render);
    global.setInterval(render, 500);
    return { getState: () => state, render };
  }

  function createScreen({ socket, root } = {}) {
    let state = null;
    function render() {
      if (!state?.available || !state.executionId) {
        root.hidden = true;
        root.innerHTML = "";
        return;
      }
      root.hidden = false;
      const remaining = timeLabel(secondsUntil(stateDeadline(state), state.serverNow, state._receivedAt));
      if (state.state === "RESULTS_VISIBLE" && state.category === "contest") {
        root.innerHTML = '<section class="knowledge-screen-card"><h1>Resultados</h1><div class="knowledge-ranking">' + (state.top10 || []).map((row) => '<div><b>' + row.position + '</b><span>' + escapeHtml(row.label) + '</span><strong>' + row.correctCount + "/" + row.totalQuestions + "</strong></div>").join("") + "</div></section>";
      } else if (state.category === "contest" && state.currentQuestion) {
        root.innerHTML = '<section class="knowledge-screen-card"><header><span>Pregunta ' + (state.questionIndex + 1) + " de " + state.questionCount + '</span><strong>' + remaining + '</strong></header><h1>' + escapeHtml(state.currentQuestion.prompt) + '</h1><div class="knowledge-screen-options">' + state.currentQuestion.options.map((option) => '<div class="' + (state.reveal?.correctOptionId === option.id ? "is-correct" : "") + '">' + escapeHtml(option.label) + "</div>").join("") + "</div></section>";
      } else if (state.category === "assessment" && state.state === "ACTIVE") {
        root.innerHTML = '<section class="knowledge-screen-card"><span>Evaluación en curso</span><h1>' + escapeHtml(state.title) + '</h1><p>' + (state.submittedCount || 0) + ' entregas · ' + (state.effectiveParticipantCount || 0) + " participantes</p></section>";
      } else {
        const message = state.state === "PROCESSING" || state.state === "PROCESSING_ERROR"
          ? "Estamos terminando de preparar los resultados…"
          : state.state === "COUNTDOWN" ? remaining : state.title;
        root.innerHTML = '<section class="knowledge-screen-card"><span>' + LABELS[state.category] + "</span><h1>" + escapeHtml(message) + '</h1><p>' + (state.effectiveParticipantCount || 0) + " participantes</p></section>";
      }
    }
    socket.on("interaction:execution:state", (next) => { state = { ...next, _receivedAt: Date.now() }; render(); });
    global.setInterval(render, 500);
    return { render, getState: () => state };
  }

  global.ImmersaKnowledgeActivities = {
    createController,
    createAudience,
    createScreen,
    participantTabId: tabId
  };
})(window);
