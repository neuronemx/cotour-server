(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventRehearsalKnowledge = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const uuid = x => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x);
  const text = (x, max) => typeof x === 'string' && x.length <= max;
  const token = x => text(x, 96) && x.trim().length > 0;
  const check = x => { if (!x) throw new Error('INVALID_REHEARSAL_KNOWLEDGE'); };
  const states = ['LOBBY', 'COUNTDOWN', 'ACTIVE', 'PROCESSING', 'PROCESSING_ERROR', 'RESULTS_READY', 'RESULTS_VISIBLE'];
  function validate(view, prefix) {
    const k = view.tools?.knowledge;
    check(uuid(view.runId) && k && Array.isArray(k.available) && k.available.length <= 500
      && k.available.every(d => d && token(d.id) && text(d.title, 240) && text(d.titleEn, 240) && ['contest', 'assessment'].includes(d.category))
      && new Set(k.available.map(d => d.id)).size === k.available.length);
    if (k.executionId === null) {
      check(k.definitionId === null && k.screen === null && k.sample === null && k.nextDeadlineAt === null); return k;
    }
    const s = k.screen, a = k.sample;
    check(uuid(k.executionId) && k.available.some(d => d.id === k.definitionId && d.category === s?.category)
      && s.executionId === k.executionId && states.includes(s.state) && text(s.title, 240) && text(s.titleEn, 240)
      && Number.isFinite(Date.parse(s.serverNow)) && Number.isSafeInteger(s.questionCount) && s.questionCount >= 1 && s.questionCount <= 100
      && Number.isSafeInteger(s.questionIndex) && s.questionIndex >= -1 && s.questionIndex < s.questionCount
      && typeof s.resultsVisible === 'boolean' && [0, 1].includes(s.participantCount)
      && (k.nextDeadlineAt === null || Number.isSafeInteger(k.nextDeadlineAt))
      && a && typeof a.submitted === 'boolean' && Number.isSafeInteger(a.answerCount) && a.answerCount >= 0 && a.answerCount <= s.questionCount
      && Array.isArray(a.answers) && a.answers.length <= 100 && a.answers.every(x => token(x.questionId) && token(x.optionId))
      && Array.isArray(a.questions) && a.questions.length <= 100);
    function question(q, options) {
      if (q === null) return;
      check(q && token(q.id) && text(q.prompt, 2000));
      if (options) check(q.en && text(q.en.prompt, 2000) && q.en.options && typeof q.en.options === 'object'
        && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6
        && new Set(q.options.map(o => o.id)).size === q.options.length
        && q.options.every(o => token(o.id) && text(o.label, 500) && o.correct === undefined) && q.correctOptionId === undefined);
      if (q.image) check(typeof q.image.url === 'string' && q.image.url.startsWith(prefix + '/question-images/' + view.runId + '/')
        && new RegExp('^[a-f0-9]{64}/' + k.executionId + '/[a-f0-9-]{36}$', 'i').test(q.image.url.slice((prefix + '/question-images/' + view.runId + '/').length))
        && ['width', 'height'].every(key => Number.isSafeInteger(q.image[key]) && q.image[key] > 0 && q.image[key] <= 4096));
    }
    question(s.currentQuestion, false); question(a.currentQuestion, true); a.questions.forEach(q => question(q, true));
    if (s.reveal) check(s.category === 'contest' && s.substate === 'REVEAL' && text(s.reveal.correctLabel, 500) && text(s.reveal.correctLabelEn, 500));
    if (a.reveal) check(s.category === 'contest' && s.substate === 'REVEAL' && token(a.reveal.correctOptionId));
    check(Array.isArray(s.top10) && s.top10.length <= 1 && s.top10.every(r => text(r.label, 120) && Number.isFinite(r.correctCount)));
    if (a.submissionReceipt) check(Number.isSafeInteger(a.submissionReceipt.answeredCount) && Number.isSafeInteger(a.submissionReceipt.totalQuestions)
      && (a.submissionReceipt.grade === undefined || s.resultsVisible && Number.isFinite(a.submissionReceipt.grade)));
    if (a.personalResult) check((s.category === 'assessment' ? s.resultsVisible && Number.isFinite(a.personalResult.grade)
      : Number.isSafeInteger(a.personalResult.correctCount) && Array.isArray(a.personalResult.answers)));
    return k;
  }
  function create({ document, send }) {
    const $ = id => document.getElementById(id);
    let view, knowledge, pending = false, buttons = [], index = 0, identity, timer, clockOffset = 0;
    function controls() { for (const [b, disabled] of buttons) b.disabled = pending || disabled; }
    function button(label, action, disabled = false) {
      const b = document.createElement('button'); b.textContent = label;
      b.addEventListener('click', () => { if (!pending && view && !b.disabled) action(); }); buttons.push([b, disabled]); return b;
    }
    const line = (parent, text, tag = 'p') => { const e = document.createElement(tag); e.textContent = text; parent.append(e); return e; };
    function command(command, input = {}) { return send({ command, executionId: knowledge.executionId, ...input }); }
    function clear() {
      clearTimeout(timer); timer = null; view = knowledge = null; buttons = []; index = 0; identity = null;
      for (const id of ['knowledge-catalog', 'knowledge-controls', 'knowledge-sample', 'knowledge-preview']) $(id).replaceChildren();
      $('knowledge-tools').hidden = $('knowledge-preview').hidden = true; $('knowledge-clock').textContent = '';
    }
    function appendImage(parent, question) {
      if (!question?.image) return;
      const img = document.createElement('img'); img.src = question.image.url; img.alt = 'Imagen de la pregunta'; img.className = 'knowledge-image';
      img.addEventListener('error', () => { img.hidden = true; }); parent.append(img);
    }
    function translated(q) {
      const english = view.language === 'en' && q.en?.prompt && q.options.every(o => q.en.options[o.id]?.trim());
      return { prompt: english ? q.en.prompt : q.prompt, label: o => english ? q.en.options[o.id] : o.label };
    }
    function render() {
      buttons = []; const k = knowledge, s = k.screen;
      $('knowledge-tools').hidden = false;
      $('knowledge-catalog').replaceChildren(...k.available.map(d => button((d.category === 'contest' ? 'Trivia: ' : 'Evaluación: ')
        + (view.language === 'en' && d.titleEn ? d.titleEn : d.title), () => send({ command: 'open', definitionId: d.id }), !!s || !!view.tools.polls.active || !!view.tools.raffle?.controller)));
      if (!k.available.length) line($('knowledge-catalog'), 'Esta versión no tiene Trivias ni Evaluaciones.');
      const preview = $('knowledge-preview'), control = $('knowledge-controls'), sample = $('knowledge-sample');
      preview.replaceChildren(); control.replaceChildren(); sample.replaceChildren(); preview.hidden = !s;
      if (!s) { controls(); return; }
      const title = view.language === 'en' && s.titleEn ? s.titleEn : s.title;
      line(preview, title, 'h3');
      const labels = { LOBBY: 'Lista para iniciar con una persona de prueba.', COUNTDOWN: 'Preparados…', ACTIVE: s.category === 'assessment' ? 'Evaluación en curso' : 'Pregunta en curso',
        PROCESSING: 'Calculando resultados de prueba…', PROCESSING_ERROR: 'No se pudieron calcular los resultados.', RESULTS_READY: 'Resultados listos para mostrar.', RESULTS_VISIBLE: 'Resultados de prueba' };
      line(preview, labels[s.state]);
      if (s.currentQuestion) { line(preview, view.language === 'en' && s.currentQuestion.promptEn ? s.currentQuestion.promptEn : s.currentQuestion.prompt); appendImage(preview, s.currentQuestion); }
      if (s.reveal) line(preview, 'Respuesta: ' + (view.language === 'en' && s.reveal.correctLabelEn ? s.reveal.correctLabelEn : s.reveal.correctLabel));
      for (const r of s.top10) line(preview, r.label + ' · ' + r.correctCount + ' / ' + r.totalQuestions);
      if (s.state === 'LOBBY') control.append(button('Iniciar prueba', () => command('start')));
      if (['COUNTDOWN', 'ACTIVE'].includes(s.state)) control.append(button('Finalizar prueba', () => command('finalize')));
      if (s.state === 'RESULTS_READY' && s.category === 'assessment') control.append(button('Mostrar resultados de prueba', () => command('show_results')));
      if (s.state === 'PROCESSING_ERROR') control.append(button('Reintentar cálculo', () => command('retry_processing')), button('Forzar resultados de prueba', () => command('force_results')));
      if (['RESULTS_READY', 'RESULTS_VISIBLE'].includes(s.state)) control.append(button('Cerrar prueba', () => command('close')));
      control.append(button('Cancelar prueba', () => command('cancel')));
      const a = k.sample;
      const questions = s.category === 'contest' ? (a.currentQuestion ? [a.currentQuestion] : []) : a.questions;
      index = Math.max(0, Math.min(questions.length - 1, index)); const question = questions[index];
      if (question) {
        const t = translated(question); line(sample, 'Respuesta de prueba · ' + (s.category === 'assessment' ? (index + 1) + ' / ' + questions.length : (s.questionIndex + 1) + ' / ' + s.questionCount), 'h3');
        line(sample, t.prompt); appendImage(sample, question);
        const answer = a.answers.find(x => x.questionId === question.id), options = document.createElement('div'); options.className = 'catalog';
        for (const o of question.options) options.append(button(t.label(o) + (answer?.optionId === o.id ? ' ✓' : ''), () => command('answer', { questionId: question.id, optionId: o.id }),
          s.state !== 'ACTIVE' || s.category === 'contest' && (s.substate !== 'QUESTION_ACTIVE' || !!answer) || a.submitted));
        sample.append(options);
        if (s.category === 'assessment') sample.append(button('Pregunta anterior', () => { index--; render(); }, index === 0), button('Pregunta siguiente', () => { index++; render(); }, index + 1 >= questions.length));
      }
      if (s.category === 'assessment' && s.state === 'ACTIVE' && !a.submitted) sample.append(button('Entregar respuestas de prueba', () => command('submit'), a.answerCount === 0));
      if (a.submissionReceipt) line(sample, 'Entregado: ' + a.submissionReceipt.answeredCount + ' / ' + a.submissionReceipt.totalQuestions + ' respuestas.');
      if (a.personalResult) line(sample, s.category === 'assessment' ? 'Calificación de prueba: ' + a.personalResult.grade + ' / 100' : 'Aciertos de prueba: ' + a.personalResult.correctCount + ' / ' + a.personalResult.totalQuestions);
      controls();
    }
    function update(next, prefix) {
      const k = validate(next, prefix), id = next.runId + ':' + k.executionId;
      if (identity !== id) { clear(); identity = id; }
      clearTimeout(timer); view = next; knowledge = k; clockOffset = k.screen ? Date.parse(k.screen.serverNow) - Date.now() : 0;
      render();
      function clock() {
        if (!view) return;
        $('knowledge-clock').textContent = k.nextDeadlineAt === null ? '' : 'Tiempo restante: ' + Math.max(0, Math.ceil((k.nextDeadlineAt - Date.now() - clockOffset) / 1000)) + ' s';
        if (k.nextDeadlineAt !== null) { timer = setTimeout(clock, 250); timer?.unref?.(); }
      }
      clock();
    }
    return { update, clear, setPending(value) { pending = value; controls(); } };
  }
  return { create, validate };
});
