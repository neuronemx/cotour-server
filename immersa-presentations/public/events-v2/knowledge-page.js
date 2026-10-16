(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventKnowledgePage = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const labels = { LOBBY: 'Esperando participantes', COUNTDOWN: 'Preparados para comenzar', ACTIVE: 'Actividad en curso', PROCESSING: 'Procesando resultados…',
    PROCESSING_ERROR: 'No se pudo completar el procesamiento.', RESULTS_READY: 'Resultados listos para publicar', RESULTS_VISIBLE: 'Resultados publicados', CLOSED: 'Actividad cerrada', CANCELLED: 'Actividad cancelada' };
  const actions = { start: 'Iniciar', finalize: 'Finalizar actividad', cancel: 'Cancelar actividad', show_results: 'Mostrar resultados', close: 'Cerrar resultados', retry_processing: 'Reintentar procesamiento', force_results: 'Forzar resultados' };
  function createView({ document, controller, getLanguage=()=> 'es', now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    const $ = id => document.getElementById(id);
    let state, runId = null, index = 0, signature = null, options = [], savedName = null, timer = null, timingKey = null, receivedAt = 0, confirmation = null;
    function deadline(r) { return r?.state === 'COUNTDOWN' ? r.countdownDeadlineAt : r?.state === 'PROCESSING' ? r.processingReadyAt || r.processingDeadlineAt
      : r?.state === 'ACTIVE' ? r.category === 'assessment' ? r.deadlineAt : r.substate === 'REVEAL' ? r.revealDeadlineAt : r.questionDeadlineAt : null; }
    function clock() {
      if (timer !== null) clearTimeoutFn(timer); timer = null;
      const r = state.snapshot?.execution, at = deadline(r);
      $('knowledge-clock').textContent = '';
      if (state.status !== 'ready' || !at || !r || ['CLOSED','CANCELLED'].includes(r.state)) return;
      const remaining = Math.max(0, Date.parse(at) - Date.parse(r.serverNow) - Math.max(0, now() - receivedAt));
      $('knowledge-clock').textContent = remaining > 0 ? Math.ceil(remaining / 1000) + ' s' : 'Comprobando el estado…';
      timer = setTimeoutFn(() => { timer = null; if (remaining <= 0 && !state.pending) controller.refresh(); else clock(); }, remaining > 0 ? 500 : 1000);
    }
    const appendText = (parent, tag, value) => { const node = document.createElement(tag); node.textContent = value; parent.append(node); return node; };
    function render(value) {
      state = value;
      const english=getLanguage()==='en',translated=(es,en)=>english&&typeof en==='string'&&en.trim()?en:es||'';
      const s = state.snapshot, r = s?.execution, usable = state.status === 'ready' && Boolean(s), publicView = state.kind === 'PARTICIPANT';
      const operator = ['STAGE','SPEAKER'].includes(state.kind), ended = !r || ['CLOSED','CANCELLED'].includes(r.state);
      if (runId !== r?.executionId) { runId = r?.executionId || null; index = r?.participant?.currentQuestionIndex || 0; savedName = null; }
      const nextTiming = r ? [r.executionId,r.revision,r.serverNow].join(':') : null;
      if (timingKey !== nextTiming) { timingKey = nextTiming; receivedAt = now(); }
      $('knowledge-panel').hidden = state.kind === 'PLAYER' ? !usable || ended : state.status === 'waiting';
      $('knowledge-controls').hidden = !operator || !usable;
      $('knowledge-title').textContent = usable ? translated(r?.title,r?.titleEn) : '';
      const errors = { INTERACTION_BUSY: 'Hay otra interacción activa.', KNOWLEDGE_NO_READY_PARTICIPANTS: 'Espera a que una persona pulse Entrar.',
        KNOWLEDGE_TAB_NOT_ACTIVE: 'La actividad está activa en otra pestaña.', KNOWLEDGE_STALE_REVISION: 'La actividad cambió. Estamos comprobando el estado.',
        KNOWLEDGE_STALE_EXECUTION: 'Hay una nueva actividad.', KNOWLEDGE_DUPLICATE: 'La respuesta ya está registrada.', KNOWLEDGE_DEADLINE_PASSED: 'El tiempo para responder terminó.',
        COMMAND_ACK_TIMEOUT: 'Estamos comprobando si se guardó la acción.', KNOWLEDGE_CONTENT_NOT_PREPARED: 'Las actividades aún no están preparadas.' };
      $('knowledge-status').textContent = state.code ? errors[state.code] || 'No se pudo completar la acción.' : !usable ? 'Comprobando actividades…' : r ? labels[r.state] : 'No hay Trivia/Evaluación abierta';
      $('knowledge-counts').textContent = usable && !publicView && r ? r.participantCount + ' participantes · ' + r.submittedCount + ' entregas' : '';
      const previous = $('knowledge-catalog').value; $('knowledge-catalog').replaceChildren();
      if (usable && operator) {
        for (const row of s.available) { const option = document.createElement('option'); option.value = row.id; option.textContent = (row.category === 'contest' ? 'Trivia · ' : 'Evaluación · ') + row.title; $('knowledge-catalog').append(option); }
        $('knowledge-catalog').value = s.available.some(row => row.id === previous) ? previous : s.available[0]?.id || '';
      }
      $('knowledge-catalog').disabled = !usable || state.pending || !ended;
      $('knowledge-open').disabled = !usable || state.pending || !ended || !s?.available?.length;
      const enabled = controller.availableActions();
      for (const action of Object.keys(actions)) { $('knowledge-' + action).hidden = !operator || !enabled.includes(action); $('knowledge-' + action).disabled = state.pending; }
      const registration = usable && publicView && r && !r.participant;
      $('knowledge-registration').hidden = !registration || !r.registrationOpen;
      $('knowledge-name-label').hidden = r?.identificationMode === 'anonymous'; $('knowledge-name').hidden = r?.identificationMode === 'anonymous';
      if (!registration) { $('knowledge-name').value = ''; savedName = null; }
      else if (savedName === null || $('knowledge-name').value === savedName) { $('knowledge-name').value = s.displayName; savedName = s.displayName; }
      $('knowledge-name').required = r?.identificationMode === 'required_name'; $('knowledge-name').disabled = state.pending;
      $('knowledge-join').disabled = !registration || state.pending || !r.registrationOpen;
      const p = usable && publicView ? r?.participant : null;
      $('knowledge-claim').hidden = !p || p.tabActive || p.submittedAt || !['LOBBY','COUNTDOWN','ACTIVE'].includes(r.state);
      $('knowledge-claim').disabled = state.pending;
      $('knowledge-tab-status').textContent = p && !p.tabActive && !ended ? 'La actividad está activa en otra pestaña.' : '';
      const qs = publicView ? r?.category === 'assessment' ? r.questions || [] : r?.currentQuestion ? [r.currentQuestion] : [] : [];
      index = Math.max(0, Math.min(index, qs.length - 1));
      const q = publicView ? qs[index] : r?.currentQuestion;
      $('knowledge-question').textContent = usable && q ? translated(q.prompt,q.en?.prompt||q.promptEn) : '';
      $('knowledge-progress').textContent = p && r.questionCount ? (r.category === 'assessment' && qs.length ? index + 1 : (r.questionIndex ?? 0) + 1) + '/' + r.questionCount : '';
      const nextSignature = usable && publicView && p && q ? JSON.stringify([r.executionId,q.id,q.options,english,q.en]) : null;
      if (signature !== nextSignature) {
        signature = nextSignature; options = []; $('knowledge-options').replaceChildren();
        if (nextSignature) for (const option of q.options) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = translated(option.label,q.en?.options?.[option.id]);
          button.addEventListener('click', () => controller.operate('answer', { questionId: q.id, optionId: option.id }));
          options.push({ button, id: option.id }); $('knowledge-options').append(button);
        }
      }
      const answer = p && q ? r.answers.find(a => a.questionId === q.id) : null;
      for (const option of options) {
        option.button.disabled = state.pending || !p?.tabActive || r.state !== 'ACTIVE' || Boolean(p.submittedAt) || (r.category === 'contest' && (r.substate !== 'QUESTION_ACTIVE' || Boolean(answer)));
        option.button.setAttribute('aria-pressed', String(answer?.optionId === option.id));
      }
      $('knowledge-answer-status').textContent = p && answer ? 'Respuesta guardada.' : '';
      $('knowledge-assessment-nav').hidden = !p || r.category !== 'assessment' || !qs.length;
      $('knowledge-prev').disabled = index === 0; $('knowledge-next').disabled = index >= qs.length - 1;
      $('knowledge-submit').hidden = !p || r.category !== 'assessment' || r.state !== 'ACTIVE' || Boolean(p.submittedAt);
      $('knowledge-submit').disabled = state.pending || !p?.tabActive || !r?.answerCount;
      $('knowledge-receipt').textContent = p && r.submissionReceipt ? 'Evaluación enviada · ' + r.submissionReceipt.answeredCount + '/' + r.submissionReceipt.totalQuestions + ' respuestas · ' + new Date(r.submissionReceipt.submittedAt).toLocaleString('es-MX') : '';
      $('knowledge-results').replaceChildren();
      if (usable && r?.reveal) {
        const correctLabel = publicView ? translated(r.currentQuestion?.options.find(o => o.id === r.reveal.correctOptionId)?.label,r.currentQuestion?.en?.options?.[r.reveal.correctOptionId]) : translated(r.reveal.correctLabel,r.reveal.correctLabelEn);
        appendText($('knowledge-results'), 'p', (english?'Correct answer: ':'Respuesta correcta: ') + (correctLabel || ''));
      }
      if (usable && r?.top10?.length) for (const row of r.top10) appendText($('knowledge-results'), 'p', row.position + '. ' + row.label + ' · ' + row.correctCount + '/' + row.totalQuestions + ' · ' + (row.correctTimeMs / 1000).toFixed(2) + ' s');
      if (usable && operator && r?.result) appendText($('knowledge-results'), 'p', 'Resultados: ' + r.result.participantCount + ' participantes' + (r.result.averageGrade === null ? '' : ' · Promedio: ' + r.result.averageGrade));
      if (p && r.personalResult) {
        const result = r.personalResult;
        appendText($('knowledge-results'), 'p', r.category === 'assessment' ? 'Tu calificación: ' + result.grade + '/100' : 'Tu resultado: ' + result.correctCount + '/' + result.totalQuestions + ' · Posición ' + result.position);
        for (const answer of result.answers || []) appendText($('knowledge-results'), 'p', answer.prompt + ' · Tu respuesta: ' + (answer.selectedLabel || 'Sin respuesta') + ' · Correcta: ' + answer.correctLabel);
      }
      if (!usable || state.pending || !r || confirmation?.executionId !== r.executionId || confirmation?.expectedRevision !== r.revision) {
        confirmation = null; if ($('knowledge-confirm-dialog').open) $('knowledge-confirm-dialog').close();
      }
      clock();
    }
    $('knowledge-open').addEventListener('click', () => controller.operate('open', { definitionId: $('knowledge-catalog').value }));
    $('knowledge-join').addEventListener('click', () => controller.operate('join', state.snapshot?.execution?.identificationMode === 'anonymous' ? {} : { name: $('knowledge-name').value }));
    $('knowledge-claim').addEventListener('click', () => controller.operate('claim_tab'));
    for (const [id, direction] of [['knowledge-prev', -1],['knowledge-next', 1]]) $(id).addEventListener('click', () => { index += direction; render(state); });
    function request(action) {
      const r = state.snapshot?.execution;
      if (!r || state.status !== 'ready' || state.pending || (action === 'submit' ? state.kind !== 'PARTICIPANT' || r.category !== 'assessment' || !r.participant?.tabActive || r.participant.submittedAt || !r.answerCount : !controller.availableActions().includes(action))) return;
      if (['submit','finalize','cancel','force_results'].includes(action) || action === 'close' && !r.resultsVisible) {
        confirmation = { action, executionId: r.executionId, expectedRevision: r.revision };
        $('knowledge-confirm-title').textContent = action === 'submit' ? '¿Enviar la evaluación?' : '¿' + actions[action] + '?';
        $('knowledge-confirm-detail').textContent = action === 'submit' ? 'Se enviarán ' + r.answerCount + ' de ' + r.questionCount + ' respuestas guardadas. Después no podrás cambiarlas.' : 'Se aplicará a la actividad actual.';
        $('knowledge-confirm-dialog').showModal();
      } else controller.operate(action, { executionId: r.executionId, expectedRevision: r.revision });
    }
    for (const action of Object.keys(actions)) $('knowledge-' + action).addEventListener('click', () => request(action));
    $('knowledge-submit').addEventListener('click', () => request('submit'));
    $('knowledge-cancel-confirm').addEventListener('click', () => { confirmation = null; $('knowledge-confirm-dialog').close(); });
    $('knowledge-confirm').addEventListener('click', () => { const item = confirmation; confirmation = null; $('knowledge-confirm-dialog').close(); if (item) { const { action, ...input } = item; controller.operate(action, input); } });
    render(controller.getState()); return Object.freeze({ render });
  }
  return Object.freeze({ createView });
});
