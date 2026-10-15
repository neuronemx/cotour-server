(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventQnaPage = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function createView({ document, controller, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    const $ = id => document.getElementById(id);
    let state, round = null, receipt = null, savedName = null, timer = null, confirmation = null;
    function render(value) {
      state = value;
      if (timer !== null) clearTimeoutFn(timer); timer = null;
      const s = state.snapshot, usable = state.status === 'ready' && Boolean(s), operator = ['STAGE', 'SPEAKER'].includes(state.kind);
      const publicView = usable && state.kind === 'PARTICIPANT', player = state.kind === 'PLAYER';
      $('qna-panel').hidden = player ? !usable || !s.screen.visible : state.status === 'waiting';
      $('qna-controls').hidden = !operator || !usable;
      $('qna-public').hidden = !publicView || !s.roundId;
      $('qna-output').hidden = !usable || !s.screen?.visible;
      $('qna-projected-text').textContent = usable ? s.screen?.question?.text || '' : '';
      $('qna-projected-name').textContent = usable ? s.screen?.question?.name || '' : '';
      const errors = { QNA_COOLDOWN: 'Espera un momento antes de enviar otra pregunta.', QNA_CLOSED: 'La recepción de preguntas está cerrada.',
        QNA_STALE_ROUND: 'La ronda cambió. Comprobando el estado.', QNA_ALREADY_PROJECTED: 'Una pregunta proyectada no se puede eliminar.',
        QNA_QUESTION_NOT_FOUND: 'La pregunta ya no está disponible.', COMMAND_ACK_TIMEOUT: 'Estamos comprobando si se recibió la pregunta.' };
      $('qna-status').hidden = player;
      $('qna-status').textContent = state.code ? errors[state.code] || 'No se pudo completar la acción.'
        : !usable ? 'Comprobando preguntas…' : !s.roundId ? 'Q&A aún no está abierto'
          : publicView && s.questionId ? 'Pregunta registrada.' : s.questionsOpen ? 'Recepción de preguntas abierta' : 'Recepción de preguntas cerrada';
      if (round !== s?.roundId || (publicView && receipt !== s.questionId)) {
        $('qna-question').value = ''; $('qna-consent').checked = false;
      }
      round = s?.roundId || null; receipt = publicView ? s.questionId : null;
      if (!publicView) { $('qna-name').value = ''; savedName = null; }
      else if (savedName === null || $('qna-name').value === savedName) { $('qna-name').value = s.displayName; savedName = s.displayName; }
      $('qna-name').disabled = !publicView || state.pending;
      $('qna-question').disabled = !publicView || state.pending || !s.questionsOpen || s.hasSubmitted;
      $('qna-consent').disabled = $('qna-question').disabled;
      $('qna-submit').disabled = $('qna-question').disabled || !$('qna-question').value.trim();
      $('qna-cooldown').textContent = publicView && s.hasSubmitted ? 'Puedes enviar otra pregunta en unos segundos.' : '';
      if (publicView && s.hasSubmitted && !state.pending) timer = setTimeoutFn(() => { timer = null; controller.refresh(); }, s.cooldownRemainingMs + 100);
      $('qna-list').replaceChildren();
      if (usable && operator) {
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Selecciona una pregunta'; $('qna-list').append(empty);
        for (const q of s.questions) {
          const option = document.createElement('option'); option.value = q.id;
          option.textContent = q.text + (q.answered ? ' · Proyectada' : ''); $('qna-list').append(option);
        }
        $('qna-list').value = s.selectedQuestionId || '';
      }
      $('qna-open').disabled = !usable || state.pending || Boolean(s.roundId);
      for (const action of ['intake', 'hide', 'new-round']) $('qna-' + action).disabled = !usable || state.pending || !s?.roundId;
      $('qna-intake').textContent = s?.questionsOpen ? 'Cerrar recepción' : 'Abrir recepción';
      $('qna-list').disabled = !usable || state.pending;
      const selected = s?.questions?.find(q => q.id === s.selectedQuestionId);
      $('qna-project').disabled = !usable || state.pending || !selected;
      $('qna-delete').disabled = $('qna-project').disabled || Boolean(selected?.answered);
      if (!usable || !operator || state.pending || confirmation?.roundId !== s.roundId) {
        confirmation = null; if ($('qna-confirm-dialog').open) $('qna-confirm-dialog').close();
      }
    }
    $('qna-question').addEventListener('input', () => { $('qna-submit').disabled = $('qna-question').disabled || !$('qna-question').value.trim(); });
    $('qna-submit').addEventListener('click', () => controller.operate('submit', {
      question: $('qna-question').value, name: $('qna-name').value, allowNameOnScreen: $('qna-consent').checked }));
    $('qna-open').addEventListener('click', () => controller.operate('open'));
    $('qna-intake').addEventListener('click', () => controller.operate('set_open', { open: !state.snapshot?.questionsOpen }));
    $('qna-hide').addEventListener('click', () => controller.operate('panel_close'));
    $('qna-list').addEventListener('change', () => controller.operate('select', { questionId: $('qna-list').value }));
    $('qna-project').addEventListener('click', () => controller.operate('project', { questionId: state.snapshot?.selectedQuestionId }));
    function confirm(action) {
      if (!['STAGE', 'SPEAKER'].includes(state.kind) || state.status !== 'ready' || state.pending || !state.snapshot?.roundId) return;
      const questionId = state.snapshot.selectedQuestionId;
      if (action === 'delete' && !state.snapshot.questions.some(q => q.id === questionId && !q.answered)) return;
      confirmation = { action, roundId: state.snapshot.roundId, ...(action === 'delete' ? { questionId } : {}) };
      $('qna-confirm-title').textContent = action === 'delete' ? '¿Eliminar esta pregunta?' : '¿Iniciar una nueva ronda?';
      $('qna-confirm-dialog').showModal();
    }
    $('qna-delete').addEventListener('click', () => confirm('delete'));
    $('qna-new-round').addEventListener('click', () => confirm('new_round'));
    $('qna-cancel').addEventListener('click', () => { confirmation = null; $('qna-confirm-dialog').close(); });
    $('qna-confirm').addEventListener('click', () => {
      const item = confirmation; confirmation = null; $('qna-confirm-dialog').close();
      if (item) { const { action, ...input } = item; controller.operate(action, input); }
    });
    render(controller.getState()); return Object.freeze({ render });
  }
  return Object.freeze({ createView });
});
