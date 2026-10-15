(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventQnaConsole = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const id = v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const fail = code => Object.assign(new Error(code), { code });
  function createController({ access, onState = () => {} }) {
    let grant = null, generation = -1, liveId = null, snapshot = null, pending = false, sequence = 0;
    let state = Object.freeze({ status: 'waiting', kind: null, snapshot: null, pending: false, code: null });
    function publish(status, code = null) { state = Object.freeze({ status, kind: grant?.context.kind || null, snapshot, pending, code }); onState(state); }
    function reset() { sequence++; liveId = snapshot = null; pending = false; publish('waiting'); }
    function updateAccess(value) {
      if (value.status !== 'ready') { grant = null; generation = -1; reset(); return; }
      if (generation !== value.generation) { grant = value; generation = value.generation; reset(); }
      else { grant = value; publish(state.status, state.code); }
    }
    function normalize(value) {
      if (!grant || !liveId || !value || value.eventId !== grant.context.eventId || value.liveSessionId !== liveId
        || !integer(value.revision) || !(value.roundId === null || id(value.roundId)) || !integer(value.roundNumber)
        || Boolean(value.roundId) !== (value.roundNumber > 0) || typeof value.questionsOpen !== 'boolean'
        || (!value.roundId && value.questionsOpen)) throw fail('INVALID_QNA_RESPONSE');
      const out = { eventId: value.eventId, liveSessionId: liveId, revision: value.revision,
        roundId: value.roundId, roundNumber: value.roundNumber, questionsOpen: value.questionsOpen };
      const kind = grant.context.kind;
      if (kind === 'PARTICIPANT') {
        if (!text(value.displayName, 120) || typeof value.hasSubmitted !== 'boolean'
          || !(value.questionId === null || id(value.questionId)) || !integer(value.cooldownRemainingMs)
          || value.cooldownRemainingMs > 10000 || value.hasSubmitted !== (value.cooldownRemainingMs > 0)
          || (value.hasSubmitted && !value.questionId)) throw fail('INVALID_QNA_RESPONSE');
        return Object.freeze({ ...out, displayName: value.displayName, hasSubmitted: value.hasSubmitted,
          questionId: value.questionId, cooldownRemainingMs: value.cooldownRemainingMs });
      }
      if (!value.screen || typeof value.screen.visible !== 'boolean') throw fail('INVALID_QNA_RESPONSE');
      let question = null;
      if (value.screen.visible) {
        const q = value.screen.question;
        if (!q || !id(q.id) || !text(q.text, 1000) || !q.text.trim() || !text(q.name, 120)) throw fail('INVALID_QNA_RESPONSE');
        question = Object.freeze({ id: q.id, text: q.text, name: q.name });
      } else if (value.screen.question !== null) throw fail('INVALID_QNA_RESPONSE');
      out.screen = Object.freeze({ visible: value.screen.visible, question });
      const seen = new Set();
      if (kind === 'PLAYER') {
        if (!Array.isArray(value.availableQuestions)) throw fail('INVALID_QNA_RESPONSE');
        out.availableQuestions = Object.freeze(value.availableQuestions.map((q, index) => {
          if (!q || !id(q.id) || seen.has(q.id) || q.label !== 'Pregunta ' + (index + 1) || typeof q.answered !== 'boolean') throw fail('INVALID_QNA_RESPONSE');
          seen.add(q.id); return Object.freeze({ id: q.id, label: q.label, answered: q.answered });
        }));
      } else if (['STAGE', 'SPEAKER'].includes(kind)) {
        if (!Array.isArray(value.questions)) throw fail('INVALID_QNA_RESPONSE');
        out.questions = Object.freeze(value.questions.map(q => {
          if (!q || !id(q.id) || seen.has(q.id) || !text(q.text, 1000) || !q.text.trim() || !text(q.name, 120)
            || typeof q.allowNameOnScreen !== 'boolean' || typeof q.answered !== 'boolean') throw fail('INVALID_QNA_RESPONSE');
          seen.add(q.id); return Object.freeze({ id: q.id, text: q.text, name: q.name, allowNameOnScreen: q.allowNameOnScreen, answered: q.answered });
        }));
        if (value.selectedQuestionId !== null && !seen.has(value.selectedQuestionId)) throw fail('INVALID_QNA_RESPONSE');
        out.selectedQuestionId = value.selectedQuestionId;
      } else throw fail('INVALID_QNA_RESPONSE');
      if (question && !seen.has(question.id)) throw fail('INVALID_QNA_RESPONSE');
      return Object.freeze(out);
    }
    function accept(value) { const view = normalize(value); if (snapshot && view.revision < snapshot.revision) return false; snapshot = view; return true; }
    async function read() {
      if (!grant || !liveId || pending) return false;
      const version = generation, ticket = ++sequence; pending = true; publish(snapshot ? 'ready' : 'loading');
      try {
        const result = await access.command('events:qna:snapshot');
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw fail(result.code || 'QNA_COMMAND_DENIED');
        accept(result.snapshot); pending = false; publish('ready'); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        snapshot = null; pending = false; publish('unavailable', e.code || 'QNA_COMMAND_DENIED'); return false;
      }
    }
    function updateLive(value) {
      if (!grant || value.status !== 'live' || !value.snapshot || value.snapshot.eventId !== grant.context.eventId) { if (liveId) reset(); return; }
      if (liveId === value.snapshot.liveSessionId) return;
      reset(); liveId = value.snapshot.liveSessionId; read();
    }
    function receive(name, value) {
      if (name !== 'events:qna:state' || !grant || !liveId || state.status !== 'ready'
        || value?.eventId !== grant.context.eventId || value?.liveSessionId !== liveId) return;
      try { if (accept(value)) publish('ready', state.code); }
      catch (_) { sequence++; snapshot = null; pending = false; publish('unavailable', 'INVALID_QNA_RESPONSE'); }
    }
    async function operate(action, input = {}) {
      if (!grant || !liveId || state.status !== 'ready' || pending || !snapshot) return false;
      const control = ['STAGE', 'SPEAKER', 'PLAYER'].includes(grant.context.kind);
      let payload;
      if (action === 'open') { if (!control || snapshot.roundId) return false; payload = {}; }
      else {
        if (!snapshot.roundId || (input.roundId !== undefined && input.roundId !== snapshot.roundId)) return false;
        payload = { roundId: snapshot.roundId };
        if (action === 'submit') {
          if (grant.context.kind !== 'PARTICIPANT' || !snapshot.questionsOpen || snapshot.hasSubmitted
            || !text(input.question, 1000) || !input.question.trim() || typeof input.allowNameOnScreen !== 'boolean'
            || (input.name !== undefined && !text(input.name, 120))) return false;
          Object.assign(payload, { question: input.question, allowNameOnScreen: input.allowNameOnScreen }, input.name === undefined ? {} : { name: input.name });
        } else {
          if (!control) return false;
          if (action === 'set_open') { if (typeof input.open !== 'boolean') return false; payload.open = input.open; }
          else if (['select', 'project', 'delete'].includes(action)) {
            const q = (snapshot.questions || snapshot.availableQuestions).find(q => q.id === input.questionId);
            if (!q || (action === 'delete' && q.answered)) return false; payload.questionId = q.id;
          } else if (!['new_round', 'panel_close'].includes(action)) return false;
        }
      }
      const version = generation, ticket = ++sequence; pending = true; publish('ready');
      try {
        const result = await access.command('events:qna:' + action, payload);
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw fail(result.code || 'QNA_COMMAND_DENIED');
        accept(result.snapshot); pending = false; publish('ready'); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        pending = false; if (e.code === 'INVALID_QNA_RESPONSE') snapshot = null;
        publish(snapshot ? 'ready' : 'unavailable', e.code || 'QNA_COMMAND_DENIED');
        if (['QNA_STALE_ROUND', 'QNA_COOLDOWN', 'QNA_CLOSED', 'QNA_QUESTION_NOT_FOUND', 'QNA_ALREADY_PROJECTED'].includes(e.code)) await read();
        return false;
      }
    }
    function emergencyActions() {
      if (state.kind !== 'PLAYER' || state.status !== 'ready' || pending || !snapshot) return [];
      if (!snapshot.roundId) return [{ action: 'open', title: 'Abrir Q&A', input: {} }];
      const input = { roundId: snapshot.roundId };
      return [{ action: 'set_open', title: snapshot.questionsOpen ? 'Cerrar recepción Q&A' : 'Abrir recepción Q&A', input: { ...input, open: !snapshot.questionsOpen } },
        ...snapshot.availableQuestions.flatMap(q => [
          { action: 'select', title: 'Seleccionar ' + q.label, input: { ...input, questionId: q.id } },
          { action: 'project', title: 'Proyectar ' + q.label, input: { ...input, questionId: q.id } },
          ...(!q.answered ? [{ action: 'delete', title: 'Eliminar ' + q.label, input: { ...input, questionId: q.id }, confirm: true }] : [])]),
        { action: 'panel_close', title: 'Ocultar Q&A', input },
        { action: 'new_round', title: 'Nueva ronda Q&A', input, confirm: true }];
    }
    return Object.freeze({ updateAccess, updateLive, receive, operate, refresh: read, emergencyActions, getState: () => state });
  }
  return Object.freeze({ createController });
});
