(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventRehearsalQna = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const uuid = x => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x);
  const text = (x, max) => typeof x === 'string' && x.length <= max;
  const check = x => { if (!x) throw new Error('INVALID_REHEARSAL_QNA'); };
  function validate(view) {
    const q = view.tools?.qna;
    check(uuid(view.runId) && q && q.maxQuestions === 20 && Array.isArray(q.questions) && q.questions.length <= 20
      && typeof q.questionsOpen === 'boolean' && Number.isSafeInteger(q.roundNumber) && q.roundNumber >= 0 && q.roundNumber <= 1000000
      && Number.isSafeInteger(q.cooldownRemainingMs) && q.cooldownRemainingMs >= 0 && q.cooldownRemainingMs <= 10000
      && q.screen && typeof q.screen.visible === 'boolean');
    check(q.questions.every(x => x && uuid(x.id) && text(x.text, 1000) && x.text.trim() && text(x.name, 120)
      && typeof x.allowNameOnScreen === 'boolean' && typeof x.answered === 'boolean' && ['new', 'selected'].includes(x.status)
      && Number.isSafeInteger(x.createdAt) && x.createdAt >= 0) && new Set(q.questions.map(x => x.id)).size === q.questions.length);
    check(q.selectedQuestionId === null || q.questions.some(x => x.id === q.selectedQuestionId && x.status === 'selected'));
    if (q.roundId === null) check(q.roundNumber === 0 && !q.questionsOpen && !q.questions.length && q.selectedQuestionId === null && !q.screen.visible && q.cooldownRemainingMs === 0);
    else check(uuid(q.roundId) && q.roundNumber >= 1);
    if (q.screen.visible) {
      const question = q.questions.find(x => x.id === q.screen.question?.id);
      check(question?.answered && q.screen.question.text === question.text && q.screen.question.name === (question.allowNameOnScreen ? question.name : ''));
    } else check(q.screen.question === null);
    return q;
  }
  function create({ document, send }) {
    const $ = id => document.getElementById(id);
    let view = null, qna = null, generation = 0, pending = false, timer, cooldownUntil = 0, buttons = [];
    const timers = () => { clearTimeout(timer); timer = null; };
    function controls() {
      const remaining = Math.max(0, cooldownUntil - Date.now());
      $('qna-open').disabled = pending || !!qna?.roundId;
      $('qna-intake').disabled = $('qna-round').disabled = pending || !qna?.roundId;
      $('qna-hide').disabled = pending || !qna?.screen.visible;
      for (const id of ['qna-question', 'qna-name', 'qna-name-visible']) $(id).disabled = pending || !qna?.roundId || !qna.questionsOpen;
      $('qna-submit').disabled = pending || !qna?.roundId || !qna.questionsOpen || remaining > 0 || qna.questions.length >= 20;
      $('qna-cooldown').textContent = remaining > 0 ? 'Otra pregunta de prueba en ' + Math.ceil(remaining / 1000) + ' s.' : '';
      for (const [button, disabled] of buttons) button.disabled = pending || disabled;
    }
    function clear() {
      generation++; timers(); view = qna = null; cooldownUntil = 0; buttons = [];
      $('qna-tools').hidden = $('qna-panel').hidden = $('qna-preview').hidden = true;
      for (const id of ['qna-list', 'qna-preview']) $(id).replaceChildren();
      $('qna-question').value = $('qna-name').value = ''; $('qna-name-visible').checked = false;
      $('qna-status').textContent = $('qna-cooldown').textContent = $('qna-intake-status').textContent = '';
      controls();
    }
    function command(input) { if (view && !pending) return send({ roundId: qna.roundId, ...input }); }
    function button(label, action, disabled = false) {
      const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', action); buttons.push([b, disabled]); return b;
    }
    function update(next) {
      const value = validate(next);
      if (view?.runId !== next.runId) clear();
      timers(); view = next; qna = value; buttons = []; cooldownUntil = Date.now() + value.cooldownRemainingMs;
      $('qna-tools').hidden = false; $('qna-panel').hidden = !qna.roundId;
      $('qna-intake-status').textContent = qna.roundId ? 'Ronda ' + qna.roundNumber + ' · Preguntas de prueba ' + (qna.questionsOpen ? 'abiertas' : 'cerradas') : '';
      $('qna-intake').textContent = qna.questionsOpen ? 'Cerrar recepción de preguntas' : 'Abrir recepción de preguntas';
      const rows = qna.questions.map(question => {
        const card = document.createElement('article'), body = document.createElement('p'), name = document.createElement('p');
        body.textContent = question.text; name.textContent = (question.name || 'Sin nombre') + (question.answered ? ' · Ya proyectada' : question.status === 'selected' ? ' · Seleccionada' : '');
        card.append(body, name, button('Seleccionar', () => command({ command: 'select', questionId: question.id }), question.status === 'selected'),
          button('Proyectar en el ensayo', () => command({ command: 'project', questionId: question.id })),
          button('Eliminar pregunta de prueba', () => command({ command: 'delete', questionId: question.id }), question.answered)); return card;
      });
      $('qna-list').replaceChildren(...rows);
      if (!rows.length) { const empty = document.createElement('p'); empty.textContent = 'No hay preguntas de prueba en esta ronda.'; $('qna-list').append(empty); }
      const preview = $('qna-preview'); preview.replaceChildren(); preview.hidden = !qna.screen.visible;
      if (qna.screen.visible) {
        const question = document.createElement('h3'), name = document.createElement('p');
        question.textContent = qna.screen.question.text; name.textContent = qna.screen.question.name;
        preview.append(question, name);
      }
      controls();
      const epoch = generation;
      function tick() {
        if (generation !== epoch || !view) return;
        controls(); if (cooldownUntil > Date.now()) { timer = setTimeout(tick, 1000); timer?.unref?.(); }
      }
      if (value.cooldownRemainingMs > 0) { timer = setTimeout(tick, 1000); timer?.unref?.(); }
    }
    $('qna-open').addEventListener('click', () => { if (view && !pending) send({ command: 'open' }); });
    $('qna-intake').addEventListener('click', () => command({ command: 'set_open', open: !qna.questionsOpen }));
    $('qna-round').addEventListener('click', () => command({ command: 'new_round' }));
    $('qna-hide').addEventListener('click', () => command({ command: 'panel_close' }));
    $('qna-submit').addEventListener('click', async () => {
      if (!view || pending || $('qna-submit').disabled) return;
      const question = $('qna-question').value.trim(), name = $('qna-name').value.trim();
      if (!question || question.length > 1000 || name.length > 120) { $('qna-status').textContent = 'Escribe una pregunta de hasta 1000 caracteres y un nombre de hasta 120.'; return; }
      const epoch = generation, success = await command({ command: 'submit', question, name, allowNameOnScreen: $('qna-name-visible').checked });
      if (success && epoch === generation) { $('qna-question').value = $('qna-name').value = ''; $('qna-name-visible').checked = false; $('qna-status').textContent = 'Pregunta de prueba añadida.'; }
    });
    return { update, clear, setPending(value) { pending = value; controls(); } };
  }
  return { create, validate };
});
