(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./interaction-images'));
  else root.ImmersaEventKnowledgeConsole = factory(root.ImmersaEventInteractionImages);
})(typeof window === 'object' ? window : this, function (images) {
  'use strict';
  const id = v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const token = v => text(v, 96) && v.trim() === v && Boolean(v);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const terminal = run => !run || ['CLOSED', 'CANCELLED'].includes(run.state);
  const fail = () => { throw Object.assign(new Error('INVALID_KNOWLEDGE_RESPONSE'), { code: 'INVALID_KNOWLEDGE_RESPONSE' }); };
  const check = ok => { if (!ok) fail(); };
  const freeze = Object.freeze;
  function question(q, options = true, imageFor = () => null) {
    if (q === null) return null;
    check(q && token(q.id) && text(q.prompt, 2000) && q.prompt.trim());
    const out = { id: q.id, prompt: q.prompt };
    if(q.image!==undefined&&q.image!==null){const image=imageFor(q.image);check(image);out.image=image;}
    if (options) {
      check(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 6);
      const seen = new Set(); out.options = freeze(q.options.map(o => {
        check(o && token(o.id) && !seen.has(o.id) && text(o.label, 500) && o.label.trim()); seen.add(o.id);
        return freeze({ id: o.id, label: o.label });
      }));
      if (q.en && text(q.en.prompt, 2000)) out.en = freeze({ prompt: q.en.prompt, options: freeze(Object.fromEntries(out.options
        .filter(o => text(q.en.options?.[o.id], 500)).map(o => [o.id, q.en.options[o.id]]))) });
    } else if (text(q.promptEn, 2000)) out.promptEn = q.promptEn;
    return freeze(out);
  }
  function ranking(rows) {
    check(Array.isArray(rows) && rows.length <= 10);
    return freeze(rows.map(row => {
      check(row && integer(row.position) && row.position > 0 && text(row.label, 120) && integer(row.correctCount)
        && integer(row.totalQuestions) && row.totalQuestions <= 100 && row.correctCount <= row.totalQuestions && integer(row.correctTimeMs));
      return freeze({ position: row.position, label: row.label, correctCount: row.correctCount, totalQuestions: row.totalQuestions, correctTimeMs: row.correctTimeMs });
    }));
  }
  function createController({ access, onState = () => {}, createAttemptId = () => crypto.randomUUID() }) {
    let grant = null, generation = -1, liveId = null, snapshot = null, pending = false, sequence = 0, needsRead = false;
    const retired = new Set();
    let state = freeze({ status: 'waiting', kind: null, snapshot: null, pending: false, code: null });
    function publish(status, code = null) { state = freeze({ status, kind: grant?.context.kind || null, snapshot, pending, code }); onState(state); }
    function reset() { sequence++; liveId = snapshot = null; pending = needsRead = false; retired.clear(); publish('waiting'); }
    function updateAccess(value) {
      if (value.status !== 'ready') { grant = null; generation = -1; reset(); return; }
      if (generation !== value.generation) { grant = value; generation = value.generation; reset(); }
      else { grant = value; publish(state.status, state.code); }
    }
    function normalize(value) {
      check(grant && liveId && value && value.eventId === grant.context.eventId && value.liveSessionId === liveId);
      const kind = grant.context.kind, publicView = kind === 'PARTICIPANT';
      const out = { eventId: value.eventId, liveSessionId: liveId, execution: null };
      if (publicView) { check(text(value.displayName, 120)); out.displayName = value.displayName; }
      else {
        check(['STAGE','SPEAKER','PLAYER'].includes(kind) && Array.isArray(value.available) && value.available.length <= 500);
        const seen = new Set(); out.available = freeze(value.available.map(row => {
          check(row && token(row.id) && !seen.has(row.id) && text(row.title, 240) && row.title.trim() && ['contest','assessment'].includes(row.category));
          seen.add(row.id); return freeze({ id: row.id, title: row.title, category: row.category });
        }));
      }
      if (value.execution === null) return freeze(out);
      const r = value.execution;
      check(r && id(r.executionId) && ['contest','assessment'].includes(r.category) && text(r.title, 240)
        && ['LOBBY','COUNTDOWN','ACTIVE','PROCESSING','PROCESSING_ERROR','RESULTS_READY','RESULTS_VISIBLE','CANCELLED','CLOSED'].includes(r.state)
        && [null,'QUESTION_ACTIVE','REVEAL'].includes(r.substate) && integer(r.revision) && date(r.serverNow) && typeof r.resultsVisible === 'boolean');
      const imageFor=image=>images?.scoped(image,grant.context,liveId,'knowledge',r.executionId);
      const run = { executionId: r.executionId, category: r.category, title: r.title, titleEn: text(r.titleEn, 240) ? r.titleEn : '',
        state: r.state, substate: r.substate, revision: r.revision, serverNow: r.serverNow, resultsVisible: r.resultsVisible };
      check((r.category === 'contest' && r.state === 'ACTIVE' ? ['QUESTION_ACTIVE','REVEAL'].includes(r.substate) : r.substate === null)
        && (!r.resultsVisible || ['RESULTS_VISIBLE','CLOSED','CANCELLED'].includes(r.state)));
      for (const key of ['countdownDeadlineAt','questionDeadlineAt','revealDeadlineAt','deadlineAt','processingReadyAt','processingDeadlineAt']) {
        check(r[key] === null || date(r[key])); run[key] = r[key];
      }
      if (publicView) {
        run.participant = null;
        if (r.participant === null) {
          check(typeof r.registrationOpen === 'boolean' && r.registrationOpen === (r.state === 'LOBBY')
            && ['anonymous','optional_name','required_name'].includes(r.identificationMode));
          Object.assign(run, { registrationOpen: r.registrationOpen, identificationMode: r.identificationMode });
        } else {
          const p = r.participant;
          check(p && p.id === grant.context.participantId && text(p.label, 120) && typeof p.tabActive === 'boolean'
            && (p.submittedAt === null || date(p.submittedAt)) && integer(r.questionCount) && r.questionCount > 0 && r.questionCount <= 100
            && integer(r.answerCount) && r.answerCount <= r.questionCount && Array.isArray(r.answers) && r.answers.length === r.answerCount);
          check(integer(p.currentQuestionIndex) && p.currentQuestionIndex < r.questionCount);
          run.participant = freeze({ label: p.label, tabActive: p.tabActive, submittedAt: p.submittedAt, currentQuestionIndex: p.currentQuestionIndex });
          run.questionCount = r.questionCount; run.answerCount = r.answerCount;
          if (r.category === 'contest') { check(Number.isSafeInteger(r.questionIndex) && r.questionIndex >= -1 && r.questionIndex < r.questionCount); run.questionIndex = r.questionIndex; }
          const seen = new Set(); run.answers = freeze(r.answers.map(a => {
            check(a && token(a.questionId) && token(a.optionId) && !seen.has(a.questionId)); seen.add(a.questionId);
            return freeze({ questionId: a.questionId, optionId: a.optionId });
          }));
          run.currentQuestion = r.category === 'contest' && r.state === 'ACTIVE' ? question(r.currentQuestion,true,imageFor) : null;
          check(Array.isArray(r.questions) && r.questions.length <= 100 && r.questions.every(Boolean));
          run.questions = r.category === 'assessment' && r.state === 'ACTIVE' && !p.submittedAt ? freeze(r.questions.map(q => question(q,true,imageFor))) : freeze([]);
          check(new Set(run.questions.map(q => q.id)).size === run.questions.length);
          run.reveal = null;
          if (r.category === 'contest' && r.state === 'ACTIVE' && r.substate === 'REVEAL' && r.reveal) {
            check(run.currentQuestion && run.currentQuestion.options.some(o => o.id === r.reveal.correctOptionId)
              && (r.reveal.selectedOptionId === null || run.currentQuestion.options.some(o => o.id === r.reveal.selectedOptionId)) && typeof r.reveal.correct === 'boolean');
            run.reveal = freeze({ correctOptionId: r.reveal.correctOptionId, selectedOptionId: r.reveal.selectedOptionId, correct: r.reveal.correct });
          }
          run.submissionReceipt = null; run.personalResult = null;
          if (r.category === 'assessment' && p.submittedAt) {
            const receipt = r.submissionReceipt;
            check(receipt && receipt.submittedAt === p.submittedAt && receipt.answeredCount === r.answerCount && receipt.totalQuestions === r.questionCount);
            run.submissionReceipt = freeze({ submittedAt: receipt.submittedAt, answeredCount: receipt.answeredCount, totalQuestions: receipt.totalQuestions });
          }
          if (r.resultsVisible && r.personalResult) {
            if (r.category === 'assessment') { check(Number.isFinite(r.personalResult.grade) && r.personalResult.grade >= 0 && r.personalResult.grade <= 100); run.personalResult = freeze({ grade: r.personalResult.grade }); }
            else {
              const result = r.personalResult;
              check(integer(result.correctCount) && result.correctCount <= r.questionCount && result.totalQuestions === r.questionCount
                && integer(result.correctTimeMs) && integer(result.position) && result.position > 0 && Array.isArray(result.answers) && result.answers.length <= 100);
              run.personalResult = freeze({ correctCount: result.correctCount, totalQuestions: result.totalQuestions, correctTimeMs: result.correctTimeMs, position: result.position,
                answers: freeze(result.answers.map(a => {
                  check(a && token(a.questionId) && text(a.prompt, 2000) && (a.selectedLabel === null || text(a.selectedLabel, 500)) && text(a.correctLabel, 500) && ['omitted','correct','incorrect'].includes(a.status));
                  return freeze({ questionId: a.questionId, prompt: a.prompt, selectedLabel: a.selectedLabel, correctLabel: a.correctLabel, status: a.status });
                })) });
            }
          }
        }
      } else {
        for (const key of ['participantCount','effectiveParticipantCount','submittedCount','questionCount']) { check(integer(r[key])); run[key] = r[key]; }
        check(run.questionCount > 0 && run.questionCount <= 100 && Number.isSafeInteger(r.questionIndex) && r.questionIndex >= -1 && r.questionIndex < run.questionCount);
        run.questionIndex = r.questionIndex;
        run.currentQuestion = r.category === 'contest' && r.state === 'ACTIVE' ? question(r.currentQuestion, kind !== 'PLAYER',imageFor) : null;
        run.reveal = null; run.top10 = freeze([]); run.result = null;
        if (kind === 'PLAYER') {
          if (r.category === 'contest' && r.state === 'ACTIVE' && r.substate === 'REVEAL' && r.reveal) {
            check(text(r.reveal.correctLabel, 500) && integer(r.reveal.responseCount) && integer(r.reveal.correctCount) && r.reveal.correctCount <= r.reveal.responseCount);
            run.reveal = freeze({ correctLabel: r.reveal.correctLabel, correctLabelEn: text(r.reveal.correctLabelEn, 500) ? r.reveal.correctLabelEn : '', responseCount: r.reveal.responseCount, correctCount: r.reveal.correctCount });
          }
          if (r.category === 'contest' && r.resultsVisible) run.top10 = ranking(r.top10);
        } else if (r.result) {
          check(integer(r.result.participantCount) && (r.result.averageGrade === null || Number.isFinite(r.result.averageGrade) && r.result.averageGrade >= 0 && r.result.averageGrade <= 100));
          run.result = freeze({ participantCount: r.result.participantCount, averageGrade: r.result.averageGrade });
          if (r.category === 'contest' && r.resultsVisible) run.top10 = ranking((r.result.top10 || []).map(row => ({ ...row })));
        }
      }
      out.execution = freeze(run); return freeze(out);
    }
    function accept(value) {
      const view = normalize(value), old = snapshot?.execution, run = view.execution;
      if (run && retired.has(run.executionId)) return false;
      if (old && run?.executionId === old.executionId && (run.revision < old.revision || run.revision === old.revision && Date.parse(run.serverNow) < Date.parse(old.serverNow))) return false;
      if (old && run?.executionId !== old.executionId) { retired.add(old.executionId); if (retired.size > 100) retired.delete(retired.values().next().value); }
      snapshot = view; return true;
    }
    async function read() {
      if (!grant || !liveId || pending) return false;
      const version = generation, ticket = ++sequence; pending = true; needsRead = false; publish(snapshot ? 'ready' : 'loading');
      try {
        const result = await access.command('events:knowledge:snapshot');
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw Object.assign(new Error(), { code: result.code });
        accept(result.snapshot); pending = false; publish('ready'); if (needsRead) await read(); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        snapshot = null; pending = false; publish('unavailable', e.code || 'KNOWLEDGE_COMMAND_DENIED'); return false;
      }
    }
    function updateLive(value) {
      if (!grant || value.status !== 'live' || !value.snapshot || value.snapshot.eventId !== grant.context.eventId) { if (liveId) reset(); return; }
      if (liveId === value.snapshot.liveSessionId) return;
      reset(); liveId = value.snapshot.liveSessionId; read();
    }
    function receive(name, value) {
      if (name !== 'events:knowledge:state' || !grant || !liveId || state.status !== 'ready'
        || value?.eventId !== grant.context.eventId || value?.liveSessionId !== liveId) return;
      if (value.execution?.executionId !== snapshot?.execution?.executionId) {
        if (retired.has(value.execution?.executionId) || value.execution === null) return;
        needsRead = true; if (!pending) read(); return;
      }
      try { if (accept(value)) publish('ready', state.code); }
      catch (_) { sequence++; snapshot = null; pending = false; publish('unavailable', 'INVALID_KNOWLEDGE_RESPONSE'); }
    }
    function availableActions() {
      if (!grant || state.status !== 'ready' || !snapshot || !['STAGE','SPEAKER','PLAYER'].includes(state.kind)) return [];
      const r = snapshot.execution;
      if (terminal(r)) return [];
      const map = { LOBBY: [...(r.participantCount ? ['start'] : []), 'cancel'], COUNTDOWN: ['finalize','cancel'], ACTIVE: ['finalize','cancel'],
        PROCESSING: ['force_results','cancel'], PROCESSING_ERROR: ['retry_processing','force_results','cancel'], RESULTS_READY: [...(r.category === 'assessment' ? ['show_results'] : []), 'close'], RESULTS_VISIBLE: ['close'] };
      return map[r.state] || [];
    }
    async function operate(action, input = {}) {
      if (!grant || !liveId || state.status !== 'ready' || pending || !snapshot) return false;
      const r = snapshot.execution, publicView = state.kind === 'PARTICIPANT'; let payload;
      if (action === 'open') {
        if (publicView || !terminal(r) || !snapshot.available.some(row => row.id === input.definitionId)) return false;
        payload = { definitionId: input.definitionId };
      } else {
        if (!r || input.executionId !== undefined && input.executionId !== r.executionId || input.expectedRevision !== undefined && input.expectedRevision !== r.revision) return false;
        payload = { executionId: r.executionId };
        if (!publicView) { if (!availableActions().includes(action)) return false; payload.expectedRevision = r.revision; }
        else if (action === 'join') {
          if (r.participant || !r.registrationOpen || (input.name !== undefined && !text(input.name, 120))) return false;
          if (input.name !== undefined) payload.name = input.name;
        } else if (action === 'claim_tab') {
          if (!r.participant || r.participant.tabActive || r.participant.submittedAt || !['LOBBY','COUNTDOWN','ACTIVE'].includes(r.state)) return false;
        } else if (['answer','submit'].includes(action)) {
          if (!r.participant?.tabActive || r.participant.submittedAt || r.state !== 'ACTIVE') return false;
          if (action === 'submit') { if (r.category !== 'assessment' || !r.answerCount) return false; }
          else {
            const q = r.category === 'contest' ? r.currentQuestion : r.questions.find(q => q.id === input.questionId);
            if (!q || q.id !== input.questionId || !q.options.some(o => o.id === input.optionId)
              || r.category === 'contest' && (r.substate !== 'QUESTION_ACTIVE' || r.answers.some(a => a.questionId === q.id))
              || r.answers.some(a => a.questionId === q.id && a.optionId === input.optionId)) return false;
            const attemptId = createAttemptId(); if (!token(attemptId)) return false;
            Object.assign(payload, { questionId: q.id, optionId: input.optionId, attemptId });
          }
        } else return false;
      }
      const version = generation, ticket = ++sequence; pending = true; needsRead = false; publish('ready');
      try {
        const result = await access.command('events:knowledge:' + action, payload);
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw Object.assign(new Error(), { code: result.code });
        accept(result.snapshot); pending = false; publish('ready'); if (needsRead) await read(); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        pending = false; if (e.code === 'INVALID_KNOWLEDGE_RESPONSE') snapshot = null;
        publish(snapshot ? 'ready' : 'unavailable', e.code || 'KNOWLEDGE_COMMAND_DENIED');
        if (snapshot && (needsRead || ['KNOWLEDGE_STALE_EXECUTION','KNOWLEDGE_STALE_REVISION','KNOWLEDGE_TAB_NOT_ACTIVE','KNOWLEDGE_DUPLICATE','KNOWLEDGE_DEADLINE_PASSED','KNOWLEDGE_INVALID_STATE'].includes(e.code))) await read();
        return false;
      }
    }
    function emergencyActions() {
      if (state.kind !== 'PLAYER' || state.status !== 'ready' || pending || !snapshot) return [];
      const r = snapshot.execution;
      if (terminal(r)) return snapshot.available.map(row => ({ action: 'open', title: row.title, input: { definitionId: row.id } }));
      const titles = { start: 'Iniciar', finalize: 'Finalizar', cancel: 'Cancelar', force_results: 'Forzar resultados', retry_processing: 'Reintentar procesamiento', show_results: 'Mostrar resultados', close: 'Cerrar resultados' };
      return availableActions().map(action => ({ action, title: titles[action] + ' · ' + r.title, input: { executionId: r.executionId, expectedRevision: r.revision },
        confirm: ['finalize','cancel','force_results'].includes(action) || action === 'close' && !r.resultsVisible }));
    }
    return freeze({ updateAccess, updateLive, receive, operate, refresh: read, availableActions, emergencyActions, getState: () => state });
  }
  return freeze({ createController });
});
