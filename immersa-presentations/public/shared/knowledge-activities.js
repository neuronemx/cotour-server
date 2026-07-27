(function (global) {
  "use strict";

  const LABELS = {
    contest: "Concurso",
    assessment: "Evaluación"
  };
  const CATEGORY_ICON_PATHS = {
    contest: [
      "M8 21h8M12 17v4M7 4h10v8a5 5 0 0 1-10 0V4Z",
      "M3 8v2a3 3 0 0 0 3 3M21 8v2a3 3 0 0 1-3 3"
    ],
    assessment: [
      "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2",
      "M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2ZM9 14l2 2 4-4"
    ]
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

  function millisecondsUntil(value, serverNow, receivedAt) {
    const deadline = Date.parse(value || "");
    const authoritativeBase = Date.parse(serverNow || "");
    const now = Number.isFinite(authoritativeBase) && Number.isFinite(receivedAt)
      ? authoritativeBase + Math.max(0, Date.now() - receivedAt)
      : Date.now();
    return Number.isFinite(deadline) ? Math.max(0, deadline - now) : null;
  }

  function timeLabel(seconds) {
    if (!Number.isFinite(seconds)) return "";
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? minutes + ":" + String(remainder).padStart(2, "0") : String(remainder);
  }

  function timerMarkup(value, state, className = "knowledge-timer") {
    if (!value) return "";
    return '<strong class="' + className + '" data-knowledge-deadline="' + escapeHtml(value) + '">'
      + timeLabel(secondsUntil(value, state?.serverNow, state?._receivedAt))
      + "</strong>";
  }

  function countdownLabel(state) {
    const remaining = millisecondsUntil(
      state?.countdownDeadlineAt,
      state?.serverNow,
      state?._receivedAt
    );
    if (!Number.isFinite(remaining)) return "3";
    const duration = Math.max(3000, Number(state?.countdownDurationMs) || 4700);
    const elapsed = Math.max(0, duration - remaining);
    if (elapsed < 1000) return "3";
    if (elapsed < 2000) return "2";
    if (elapsed < 3000) return "1";
    return "¡Inicia!";
  }

  function countdownMarkup(state) {
    return '<strong class="knowledge-countdown-value" data-knowledge-countdown>'
      + countdownLabel(state)
      + "</strong>";
  }

  function updateRenderedTimers(root, state) {
    root?.querySelectorAll?.("[data-knowledge-deadline]").forEach((node) => {
      node.textContent = timeLabel(secondsUntil(node.dataset.knowledgeDeadline, state?.serverNow, state?._receivedAt));
    });
    root?.querySelectorAll?.("[data-knowledge-countdown]").forEach((node) => {
      node.textContent = countdownLabel(state);
    });
  }

  function questionImageMarkup(image, className = "knowledge-question-image") {
    const url = String(image?.url || "");
    if (!url) return "";
    return '<img class="' + className + '" src="' + escapeHtml(url) + '" alt="Imagen de la pregunta">';
  }

  function categoryIconMarkup(category, className = "knowledge-definition-icon") {
    const paths = CATEGORY_ICON_PATHS[category] || CATEGORY_ICON_PATHS.contest;
    return '<span class="' + className + '"><svg viewBox="0 0 24 24" aria-hidden="true">'
      + paths.map((path) => '<path d="' + path + '"></path>').join("")
      + "</svg></span>";
  }

  function stateDeadline(state) {
    if (state?.state === "COUNTDOWN") return state.countdownDeadlineAt;
    if (state?.substate === "QUESTION_ACTIVE") return state.questionDeadlineAt;
    if (state?.substate === "REVEAL") return state.revealDeadlineAt;
    if (state?.category === "assessment" && state?.state === "ACTIVE") return state.deadlineAt;
    return null;
  }

  function createAudienceKnowledgeAudio() {
    if (typeof global.Audio !== "function") return { play() {} };
    const tracks = {
      join: new global.Audio("/assets/audio/contests/click1.mp3"),
      answer: new global.Audio("/assets/audio/contests/click2.mp3"),
      nextQuestion: new global.Audio("/assets/audio/contests/NextQuestion.mp3")
    };
    Object.values(tracks).forEach((track) => { track.preload = "auto"; });
    let primed = false;

    function primeDeferredTracks() {
      if (primed) return;
      primed = true;
      const track = tracks.nextQuestion;
      track.muted = true;
      Promise.resolve(track.play()).catch(() => {}).then(() => {
        track.pause();
        try { track.currentTime = 0; } catch (_error) {}
        track.muted = false;
      });
    }

    return {
      play(name) {
        const track = tracks[name];
        if (!track) return;
        if (name === "join") primeDeferredTracks();
        try { track.currentTime = 0; } catch (_error) {}
        track.play()?.catch?.(() => {});
      }
    };
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
        return '<button type="button" class="knowledge-definition knowledge-definition-' + category + '" data-knowledge-open="' + escapeHtml(item.id) + '">'
          + categoryIconMarkup(category)
          + '<span class="knowledge-definition-copy"><strong>' + escapeHtml(item.title) + '</strong>'
          + '<small>' + item.questions.length + " preguntas · " + escapeHtml(duration) + "</small></span>"
          + '<span class="knowledge-definition-arrow" aria-hidden="true">→</span>'
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
      const timer = remaining === null ? "" : timerMarkup(deadline, state);
      let body = '<header class="knowledge-live-head"><div><span>' + LABELS[category] + ' <em>En vivo</em></span><h2>' + escapeHtml(state.title) + "</h2></div>" + timer + "</header>";

      if (state.state === "LOBBY") {
        const lobbyCount = state.participantCount || 0;
        body += '<div class="knowledge-metric"><strong>' + lobbyCount + "</strong><span>" + (lobbyCount === 1 ? "persona lista" : "personas listas") + "</span></div>"
          + (lobbyCount ? "" : '<p class="knowledge-lobby-hint">Espera a que alguien pulse Entrar.</p>')
          + '<div class="knowledge-actions"><button class="primary" data-knowledge-command="start" ' + (lobbyCount ? "" : "disabled") + '>Iniciar</button><button data-knowledge-command="cancel">Cancelar</button></div>';
      } else if (state.state === "COUNTDOWN") {
        body += '<div class="knowledge-countdown">' + countdownMarkup(state) + "</div>";
      } else if (state.state === "ACTIVE") {
        if (category === "contest") {
          body += '<div class="knowledge-question-progress"><span>Pregunta ' + (state.questionIndex + 1) + " de " + state.questionCount + "</span><strong>" + escapeHtml(state.currentQuestion?.prompt || "Preparando pregunta…") + "</strong>" + questionImageMarkup(state.currentQuestion?.image) + "</div>";
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
          if ((intent === "finalize" || intent === "force_results")
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
    const repaintTimer = global.setInterval(() => {
      hosts.forEach((host) => updateRenderedTimers(host.root, state));
    }, 500);
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
    const audienceAudio = createAudienceKnowledgeAudio();
    let state = null;
    let questionFlashTimer = null;
    let selectedAssessmentIndex = 0;
    const pendingKey = "immersaKnowledgePendingAnswer";

    function flashQuestion() {
      root.classList.remove("is-question-flash");
      void root.offsetWidth;
      root.classList.add("is-question-flash");
      if (questionFlashTimer) global.clearTimeout(questionFlashTimer);
      questionFlashTimer = global.setTimeout(() => {
        root.classList.remove("is-question-flash");
        questionFlashTimer = null;
      }, 760);
    }

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
      return '<div class="knowledge-audience-card knowledge-registration-card"><div class="knowledge-registration-head"><div class="knowledge-registration-copy"><span>' + LABELS[state.category] + '</span><h2>' + escapeHtml(state.title) + '</h2></div><button class="primary" data-knowledge-join>Entrar</button></div>' + input + "</div>";
    }

    function contestMarkup() {
      const question = state.currentQuestion;
      if (!question) {
        if (state.state === "COUNTDOWN") return '<div class="knowledge-countdown">' + countdownMarkup(state) + "</div>";
        if (state.state === "PROCESSING" || state.state === "PROCESSING_ERROR") return '<div class="knowledge-processing"><span class="knowledge-spinner"></span><strong>Estamos terminando de preparar los resultados…</strong></div>';
        if (state.personalResult) {
          const detail = (state.personalResult.answers || []).map((answer) => {
            const correct = answer.status === "correct";
            return '<div class="knowledge-result-detail ' + (correct ? "correct" : "incorrect") + '"><span><strong>' + escapeHtml(answer.prompt) + '</strong><small>' + escapeHtml(answer.selectedLabel || "Omitida") + '</small></span><i class="knowledge-result-mark" role="img" aria-label="' + (correct ? "Correcta" : "Incorrecta") + '">' + (correct ? "✓" : "×") + "</i></div>";
          }).join("");
          const qualified = state.personalResult.correctCount > 0;
          const position = qualified ? "#" + (state.personalResult.position || "—") : "Sin posición";
          const time = qualified ? " · " + (state.personalResult.correctTimeMs / 1000).toFixed(2) + " s" : "";
          return '<section class="knowledge-audience-results"><div class="knowledge-personal-result"><strong>' + position + '</strong><span>' + state.personalResult.correctCount + " de " + state.personalResult.totalQuestions + " correctas" + time + '</span></div><div class="knowledge-result-details">' + detail + "</div></section>";
        }
        return '<div class="knowledge-empty"><strong>' + escapeHtml(state.title) + "</strong><span>Esperando la siguiente pregunta…</span></div>";
      }
      const confirmed = answerMap().get(question.id);
      const pending = readPending();
      const questionCount = Number.isFinite(Number(state.questionCount))
        ? Number(state.questionCount)
        : 1;
      const questionNumber = Number.isFinite(Number(state.questionIndex))
        ? Number(state.questionIndex) + 1
        : Math.min((state.answerCount || 0) + 1, questionCount);
      const options = question.options.map((option) => {
        const selected = confirmed === option.id || (!confirmed && pending?.questionId === question.id && pending?.optionId === option.id);
        const revealClass = state.reveal
          ? option.id === state.reveal.correctOptionId ? " is-correct" : selected ? " is-incorrect" : ""
          : "";
        return '<button type="button" data-knowledge-answer="' + escapeHtml(option.id) + '" class="' + (selected ? "is-selected" : "") + revealClass + '" ' + (confirmed || state.substate === "REVEAL" ? "disabled" : "") + ">" + escapeHtml(option.label) + "</button>";
      }).join("");
      return '<div class="knowledge-audience-card"><header><span>Pregunta ' + questionNumber + " de " + questionCount + '</span>' + timerMarkup(state.questionDeadlineAt || state.revealDeadlineAt, state) + '</header><h2>' + escapeHtml(question.prompt) + '</h2>' + questionImageMarkup(question.image) + '<div class="knowledge-options">' + options + "</div>"
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
      return '<div class="knowledge-audience-card"><header><span>Pregunta ' + (selectedAssessmentIndex + 1) + " de " + questions.length + '</span>' + timerMarkup(state.deadlineAt, state) + '</header><h2>' + escapeHtml(question.prompt) + '</h2>' + questionImageMarkup(question.image) + '<div class="knowledge-options">' + options + '</div><div class="knowledge-assessment-nav"><button data-knowledge-prev ' + (selectedAssessmentIndex === 0 ? "disabled" : "") + '>Anterior</button><button data-knowledge-next ' + (selectedAssessmentIndex === questions.length - 1 ? "disabled" : "") + '>Siguiente</button></div><button class="primary" data-knowledge-submit ' + (answerMap().size ? "" : "disabled") + ">Entregar evaluación</button></div>";
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
        audienceAudio.play("join");
        emitNow("interaction:participant:join", { name, tabId: currentTabId });
      });
      root.querySelector("[data-knowledge-claim]")?.addEventListener("click", () => emitNow("interaction:participant:claim_tab", { tabId: currentTabId }));
      root.querySelectorAll("[data-knowledge-answer]").forEach((button) => button.addEventListener("click", () => {
        const questions = state.category === "contest" ? [state.currentQuestion] : state.questions;
        const question = state.category === "contest" ? state.currentQuestion : questions[selectedAssessmentIndex];
        audienceAudio.play("answer");
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
      const previous = state;
      state = { ...next, _receivedAt: Date.now() };
      const enteredQuestion = isNewContestQuestion(previous, state);
      const pending = readPending();
      const activeQuestionId = state?.category === "contest" ? state.currentQuestion?.id : pending?.questionId;
      const confirmed = (state?.answers || []).some((answer) => answer.questionId === pending?.questionId);
      if (pending && (pending.executionId !== state?.executionId || confirmed || (state?.category === "contest" && activeQuestionId !== pending.questionId))) clearPending();
      render();
      if (enteredQuestion && state.participant) {
        flashQuestion();
        audienceAudio.play("nextQuestion");
      }
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
    global.setInterval(() => updateRenderedTimers(root, state), 500);
    return { getState: () => state, render };
  }

  function formatContestSeconds(milliseconds) {
    return (Math.max(0, Number(milliseconds) || 0) / 1000).toFixed(2) + " s";
  }

  function isNewContestQuestion(previous, next) {
    return Boolean(
      next?.category === "contest"
      && next.state === "ACTIVE"
      && next.currentQuestion?.id
      && previous?.executionId === next.executionId
      && (previous.state !== "ACTIVE" || previous.currentQuestion?.id !== next.currentQuestion.id)
    );
  }

  function createScreenContestAudio() {
    if (typeof global.Audio !== "function") return { sync() {} };
    const AudioContext = global.AudioContext || global.webkitAudioContext;
    const tracks = {
      countdown: new global.Audio("/assets/audio/contests/321.mp3"),
      tick: new global.Audio("/assets/audio/contests/tictac.mp3"),
      reveal: new global.Audio("/assets/audio/contests/Resultado_pregunta.mp3"),
      final: new global.Audio("/assets/audio/contests/Final_concurso.mp3")
    };
    tracks.countdown.preload = "auto";
    tracks.tick.preload = "auto";
    tracks.reveal.preload = "auto";
    tracks.final.preload = "auto";
    tracks.tick.loop = true;
    let unlocked = false;
    let currentState = null;
    let tickWanted = false;
    let tickContext = null;
    let tickBuffer = null;
    let tickSource = null;
    let tickWebAudioFailed = false;

    if (typeof AudioContext === "function" && typeof global.fetch === "function") {
      try {
        tickContext = new AudioContext();
        global.fetch("/assets/audio/contests/tictac.mp3")
          .then((response) => {
            if (!response.ok) throw new Error("tick_audio_unavailable");
            return response.arrayBuffer();
          })
          .then((bytes) => tickContext.decodeAudioData(bytes))
          .then((buffer) => {
            tickBuffer = buffer;
            if (tickWanted && unlocked) startTick();
          })
          .catch(() => {
            tickWebAudioFailed = true;
            if (tickWanted && unlocked) play(tracks.tick);
          });
      } catch (_error) {
        tickWebAudioFailed = true;
        tickContext = null;
      }
    } else {
      tickWebAudioFailed = true;
    }

    function stop(track, reset = true) {
      track.pause();
      if (reset) {
        try { track.currentTime = 0; } catch (_error) {}
      }
    }

    function stopTick() {
      tickWanted = false;
      if (tickSource) {
        const source = tickSource;
        tickSource = null;
        try { source.stop(); } catch (_error) {}
        try { source.disconnect(); } catch (_error) {}
      }
      stop(tracks.tick);
    }

    function startTick() {
      tickWanted = true;
      if (!unlocked || tickSource) return;
      if (!tickContext || tickWebAudioFailed) {
        play(tracks.tick);
        return;
      }
      Promise.resolve(tickContext.resume()).then(() => {
        if (!tickWanted || tickSource || !tickBuffer) return;
        const source = tickContext.createBufferSource();
        source.buffer = tickBuffer;
        source.loop = true;
        source.connect(tickContext.destination);
        source.onended = () => {
          if (tickSource === source) tickSource = null;
        };
        tickSource = source;
        source.start(0);
      }).catch(() => {
        tickWebAudioFailed = true;
        if (tickWanted) play(tracks.tick);
      });
    }

    function stopAll() {
      stopTick();
      [tracks.countdown, tracks.reveal, tracks.final].forEach((track) => stop(track));
    }

    function unlock() {
      unlocked = true;
      global.document.querySelector("[data-knowledge-audio-unlock]")?.remove();
      tickContext?.resume?.().catch?.(() => {});
      const primers = Object.values(tracks).map((track) => {
        track.muted = true;
        return Promise.resolve(track.play()).catch(() => {}).then(() => {
          stop(track);
          track.muted = false;
        });
      });
      Promise.all(primers).then(() => sync(null, currentState));
    }

    function bindSharedUnlock(button) {
      if (!button || button.dataset.knowledgeAudioBound === "1") return;
      button.dataset.knowledgeAudioBound = "1";
      button.addEventListener("click", unlock, { once: true });
    }

    function ensureUnlock() {
      if (unlocked || global.document.querySelector("[data-knowledge-audio-unlock]")) return;
      const sharedButton = global.document.querySelector(
        "[data-immersa-media-unlock]:not([data-knowledge-audio-unlock]):not([hidden]), "
          + "[data-breakout-audio-unlock]:not([hidden]), "
          + "[data-pong-audio-unlock]:not([hidden])"
      );
      if (sharedButton) {
        bindSharedUnlock(sharedButton);
        return;
      }
      const button = global.document.createElement("button");
      button.type = "button";
      button.className = "knowledge-audio-unlock";
      button.dataset.knowledgeAudioUnlock = "1";
      button.dataset.immersaMediaUnlock = "1";
      button.textContent = "🔊 Activar sonido de Concursos";
      bindSharedUnlock(button);
      global.document.body.appendChild(button);
    }

    function play(track, currentTime = 0) {
      stop(track);
      try { track.currentTime = Math.max(0, currentTime); } catch (_error) {}
      const playback = track.play();
      playback?.catch?.(() => {
        unlocked = false;
        ensureUnlock();
      });
    }

    function sync(previous, next) {
      currentState = next;
      if (!next?.executionId || next.category !== "contest") {
        stopAll();
        global.document.querySelector("[data-knowledge-audio-unlock]")?.remove();
        return;
      }
      ensureUnlock();
      if (!unlocked) return;
      const changedExecution = previous?.executionId && previous.executionId !== next.executionId;
      if (changedExecution || next.state === "LOBBY") stopAll();
      if (next.state === "COUNTDOWN" && (changedExecution || previous?.state !== "COUNTDOWN")) {
        stopTick();
        stop(tracks.reveal);
        stop(tracks.final);
        const duration = Math.max(3000, Number(next.countdownDurationMs) || 4700);
        const remaining = millisecondsUntil(next.countdownDeadlineAt, next.serverNow, next._receivedAt);
        play(tracks.countdown, Number.isFinite(remaining) ? (duration - remaining) / 1000 : 0);
      } else if (next.state === "ACTIVE" && previous?.state !== "ACTIVE") {
        stop(tracks.countdown);
        stop(tracks.reveal);
        stop(tracks.final);
        startTick();
      } else if (["PROCESSING", "PROCESSING_ERROR"].includes(next.state)
        && !["PROCESSING", "PROCESSING_ERROR"].includes(previous?.state)) {
        stop(tracks.countdown);
        stopTick();
        stop(tracks.reveal);
        play(tracks.final);
      }
      const enteredReveal = next.state === "ACTIVE"
        && next.substate === "REVEAL"
        && previous?.executionId === next.executionId
        && previous?.substate !== "REVEAL";
      if (enteredReveal) play(tracks.reveal);
    }

    return { sync };
  }

  function createScreen({ socket, root } = {}) {
    let state = null;
    let questionFlashTimer = null;
    const contestAudio = createScreenContestAudio();

    function flashQuestion() {
      root.classList.remove("is-question-flash");
      void root.offsetWidth;
      root.classList.add("is-question-flash");
      if (questionFlashTimer) global.clearTimeout(questionFlashTimer);
      questionFlashTimer = global.setTimeout(() => {
        root.classList.remove("is-question-flash");
        questionFlashTimer = null;
      }, 760);
    }

    function render() {
      if (!state?.available || !state.executionId) {
        root.hidden = true;
        root.innerHTML = "";
        return;
      }
      root.hidden = false;
      const deadline = stateDeadline(state);
      if (state.state === "RESULTS_VISIBLE" && state.category === "contest") {
        const rows = (state.top10 || []).filter((row) => row.correctCount > 0);
        const winners = rows.filter((row) => row.position === 1);
        const winnerTitle = winners.length > 1 ? "¡Tenemos ganadores!" : "¡Tenemos ganador!";
        const winnerMarkup = winners.length
          ? '<div class="knowledge-winners">' + winners.map((row) => '<article><b>#1</b><div><span>' + winnerTitle + '</span><h1>' + escapeHtml(row.label) + '</h1><p>' + row.correctCount + " de " + row.totalQuestions + " correctas · " + formatContestSeconds(row.correctTimeMs) + "</p></div></article>").join("") + "</div>"
          : '<div class="knowledge-no-winner"><span>Resultados</span><h1>No hubo respuestas correctas</h1></div>';
        const remainingRows = rows.filter((row) => row.position !== 1);
        root.innerHTML = '<section class="knowledge-screen-card knowledge-screen-results">' + winnerMarkup
          + (remainingRows.length ? '<div class="knowledge-ranking">' + remainingRows.map((row) => '<div><b>' + row.position + '</b><span>' + escapeHtml(row.label) + '</span><strong>' + row.correctCount + "/" + row.totalQuestions + " · " + formatContestSeconds(row.correctTimeMs) + "</strong></div>").join("") + "</div>" : "")
          + "</section>";
      } else if (state.category === "contest" && ["LOBBY", "COUNTDOWN"].includes(state.state)) {
        const readyCount = state.participantCount || 0;
        const readyLabel = readyCount === 1 ? "persona lista" : "personas listas";
        root.innerHTML = '<section class="knowledge-screen-card knowledge-screen-intro-state">'
          + '<div class="knowledge-screen-presence"><strong>' + readyCount + '</strong><span>' + readyLabel + "</span></div>"
          + '<div class="knowledge-screen-identity">' + categoryIconMarkup("contest", "knowledge-screen-activity-icon")
          + '<h1>' + escapeHtml(state.title) + "</h1></div>"
          + (state.state === "COUNTDOWN"
            ? '<div class="knowledge-screen-countdown">' + countdownMarkup(state) + "</div>"
            : "")
          + "</section>";
      } else if (state.category === "contest" && state.currentQuestion) {
        const hasImage = Boolean(state.currentQuestion.image?.url);
        if (state.substate === "REVEAL" && state.reveal?.correctLabel) {
          root.innerHTML = '<section class="knowledge-screen-card knowledge-screen-reveal"><div class="knowledge-screen-correct-answer"><strong>' + escapeHtml(state.reveal.correctLabel) + "</strong></div></section>";
        } else {
          root.innerHTML = '<section class="knowledge-screen-card knowledge-screen-question' + (hasImage ? " has-question-image" : "") + '"><header><span>Pregunta ' + (state.questionIndex + 1) + " de " + state.questionCount + '</span>' + timerMarkup(deadline, state) + '</header><h1>' + escapeHtml(state.currentQuestion.prompt) + "</h1>" + questionImageMarkup(state.currentQuestion.image, "knowledge-screen-question-image") + "</section>";
        }
      } else if (state.category === "assessment" && state.state === "ACTIVE") {
        root.innerHTML = '<section class="knowledge-screen-card"><span>Evaluación en curso</span><h1>' + escapeHtml(state.title) + '</h1><p>' + (state.submittedCount || 0) + ' entregas · ' + (state.effectiveParticipantCount || 0) + " participantes</p></section>";
      } else {
        const message = state.state === "PROCESSING" || state.state === "PROCESSING_ERROR"
          ? "Estamos calculando los resultados…"
          : state.title;
        const count = ["LOBBY", "COUNTDOWN"].includes(state.state)
          ? state.participantCount || 0
          : state.effectiveParticipantCount || 0;
        const countLabel = ["LOBBY", "COUNTDOWN"].includes(state.state)
          ? (count === 1 ? "persona lista" : "personas listas")
          : (count === 1 ? "participante" : "participantes");
        root.innerHTML = '<section class="knowledge-screen-card"><span>' + LABELS[state.category] + "</span><h1>"
          + (state.state === "COUNTDOWN" ? countdownMarkup(state) : escapeHtml(message))
          + '</h1><p>' + count + " " + countLabel + "</p></section>";
      }
    }
    socket.on("interaction:execution:state", (next) => {
      const previous = state;
      state = { ...next, _receivedAt: Date.now() };
      const enteredQuestion = isNewContestQuestion(previous, state);
      contestAudio.sync(previous, state);
      render();
      if (enteredQuestion) flashQuestion();
    });
    global.setInterval(() => updateRenderedTimers(root, state), 500);
    return { render, getState: () => state };
  }

  global.ImmersaKnowledgeActivities = {
    createController,
    createAudience,
    createScreen,
    participantTabId: tabId
  };
})(window);
