(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventPollConsole = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const id = v => text(v, 120);
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const fail = code => Object.assign(new Error(code), { code });
  function createController({ access, onState = () => {} }) {
    let grant = null, generation = -1, liveId = null, snapshot = null, pending = false, sequence = 0;
    let state = Object.freeze({ status: 'waiting', kind: null, snapshot: null, pending: false, code: null });
    function publish(status, code = null) {
      state = Object.freeze({ status, kind: grant?.context.kind || null, snapshot, pending, code }); onState(state);
    }
    function reset() { sequence++; liveId = snapshot = null; pending = false; publish('waiting'); }
    function updateAccess(value) {
      if (value.status !== 'ready') { grant = null; generation = -1; reset(); return; }
      if (generation !== value.generation) { grant = value; generation = value.generation; reset(); }
      else { grant = value; publish(state.status, state.code); }
    }
    function normalize(value) {
      if (!grant || !liveId || !value || value.eventId !== grant.context.eventId || value.liveSessionId !== liveId
        || !integer(value.revision) || typeof value.resultsVisible !== 'boolean') throw fail('INVALID_POLL_RESPONSE');
      const kind = grant.context.kind, control = ['STAGE', 'SPEAKER', 'PLAYER'].includes(kind);
      const out = { eventId: value.eventId, liveSessionId: liveId, revision: value.revision,
        pollRunId: null, active: null, resultsVisible: value.resultsVisible };
      if (control) {
        if (!Array.isArray(value.available) || value.available.length > 500) throw fail('INVALID_POLL_RESPONSE');
        const seen = new Set(); out.available = Object.freeze(value.available.map(row => {
          if (!row || !id(row.id) || !text(row.title, 1000) || seen.has(row.id)) throw fail('INVALID_POLL_RESPONSE');
          seen.add(row.id); return Object.freeze({ id: row.id, title: row.title });
        })); out.results = null;
      }
      if (kind === 'PARTICIPANT') out.response = null;
      if (value.active === null) {
        if (value.pollRunId !== null || (control && value.results !== null) || (kind === 'PARTICIPANT' && value.response !== null)) throw fail('INVALID_POLL_RESPONSE');
        return Object.freeze(out);
      }
      const active = value.active;
      if (!active || active.type !== 'poll' || !id(active.id) || !text(active.prompt, 2000)
        || typeof value.pollRunId !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.pollRunId)
        || !Array.isArray(active.options) || active.options.length < 2 || active.options.length > 20) throw fail('INVALID_POLL_RESPONSE');
      const seen = new Set(), options = active.options.map(row => {
        if (!row || !id(row.id) || !text(row.label, 500) || seen.has(row.id)) throw fail('INVALID_POLL_RESPONSE');
        seen.add(row.id); return Object.freeze({ id: row.id, label: row.label });
      });
      out.pollRunId = value.pollRunId; out.active = { id: active.id, type: 'poll', prompt: active.prompt, options: Object.freeze(options) };
      if (['STAGE', 'SPEAKER'].includes(kind)) {
        if (!text(active.title, 1000)) throw fail('INVALID_POLL_RESPONSE'); out.active.title = active.title;
      }
      // Preserve only bounded translations supplied by the canonical engine.
      const en = active.en;
      if (en && typeof en.prompt === 'string' && en.prompt.length <= 2000) {
        out.active.en = Object.freeze({ prompt: en.prompt, options: Object.freeze(Object.fromEntries(options
          .filter(row => text(en.options?.[row.id], 500)).map(row => [row.id, en.options[row.id]]))) });
      }
      out.active = Object.freeze(out.active);
      if (control && value.results !== null && (kind !== 'PLAYER' || value.resultsVisible)) {
        const r = value.results;
        if (!r || r.interactionId !== active.id || !integer(r.totalResponses) || !Array.isArray(r.options) || r.options.length !== options.length) throw fail('INVALID_POLL_RESPONSE');
        let total = 0;
        const rows = r.options.map((row, index) => {
          if (!row || row.id !== options[index].id || !integer(row.count) || row.count > r.totalResponses
            || row.percentage !== (r.totalResponses ? Math.round(row.count / r.totalResponses * 100) : 0)) throw fail('INVALID_POLL_RESPONSE');
          total += row.count; return Object.freeze({ ...options[index], count: row.count, percentage: row.percentage });
        });
        if (total !== r.totalResponses) throw fail('INVALID_POLL_RESPONSE');
        out.results = Object.freeze({ totalResponses: r.totalResponses, options: Object.freeze(rows) });
      }
      if (kind === 'PARTICIPANT' && value.response !== null) {
        const response = value.response;
        if (!response || (response.audienceId !== undefined && response.audienceId !== grant.context.participantId)
          || (response.interactionId !== undefined && response.interactionId !== active.id)
          || !seen.has(response.optionId) || typeof response.submittedAt !== 'string' || !Number.isFinite(Date.parse(response.submittedAt))) throw fail('INVALID_POLL_RESPONSE');
        out.response = Object.freeze({ optionId: response.optionId, submittedAt: response.submittedAt });
      }
      return Object.freeze(out);
    }
    function accept(value) {
      const view = normalize(value);
      if (snapshot && view.revision < snapshot.revision) return false;
      snapshot = view; return true;
    }
    async function read() {
      if (!grant || !liveId || pending) return false;
      const version = generation, ticket = ++sequence; pending = true; publish(snapshot ? 'ready' : 'loading');
      try {
        const result = await access.command('events:poll:snapshot');
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw fail(result.code || 'POLL_ACCESS_DENIED');
        accept(result.snapshot); pending = false; publish('ready'); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        snapshot = null; pending = false; publish('unavailable', e.code || 'POLL_ACCESS_DENIED'); return false;
      }
    }
    function updateLive(value) {
      if (!grant || value.status !== 'live' || !value.snapshot || value.snapshot.eventId !== grant.context.eventId) { if (liveId) reset(); return; }
      if (liveId === value.snapshot.liveSessionId) return;
      reset(); liveId = value.snapshot.liveSessionId; read();
    }
    function receive(name, value) {
      if (name !== 'events:poll:state' || !grant || !liveId || state.status !== 'ready'
        || value?.eventId !== grant.context.eventId || value?.liveSessionId !== liveId) return;
      try { if (accept(value)) publish('ready', state.code); }
      catch (_) { sequence++; snapshot = null; pending = false; publish('unavailable', 'INVALID_POLL_RESPONSE'); }
    }
    async function operate(action, input = {}) {
      if (!grant || !liveId || state.status !== 'ready' || pending || !snapshot) return false;
      const kind = grant.context.kind, control = ['STAGE', 'SPEAKER', 'PLAYER'].includes(kind);
      let payload;
      if (action === 'launch') {
        if (!control || snapshot.active || !snapshot.available.some(row => row.id === input.interactionId)) return false;
        payload = { interactionId: input.interactionId };
      } else {
        if (!snapshot.active || !snapshot.pollRunId) return false;
        if (action === 'submit') {
          if (kind !== 'PARTICIPANT' || snapshot.response || !snapshot.active.options.some(row => row.id === input.optionId)) return false;
          payload = { pollRunId: snapshot.pollRunId, optionId: input.optionId };
        } else {
          if (!control || !['show', 'hide', 'close'].includes(action)) return false;
          payload = { pollRunId: snapshot.pollRunId };
        }
      }
      const version = generation, ticket = ++sequence; pending = true; publish('ready');
      try {
        const result = await access.command('events:poll:' + action, payload);
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw fail(result.code || 'POLL_ACCESS_DENIED');
        accept(result.snapshot); pending = false; publish('ready'); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        pending = false;
        if (e.code === 'INVALID_POLL_RESPONSE') snapshot = null;
        publish(snapshot ? 'ready' : 'unavailable', e.code || 'POLL_ACCESS_DENIED');
        if (e.code === 'POLL_DUPLICATE_RESPONSE' || e.code === 'POLL_NOT_ACTIVE') await read();
        return false;
      }
    }
    function emergencyActions() {
      if (state.kind !== 'PLAYER' || state.status !== 'ready' || state.pending || !snapshot) return [];
      if (!snapshot.active) return snapshot.available.map(row => ({ action: 'launch', title: row.title, input: { interactionId: row.id } }));
      return [{ action: snapshot.resultsVisible ? 'hide' : 'show', title: snapshot.resultsVisible ? 'Ocultar resultados' : 'Mostrar resultados', input: {} },
        { action: 'close', title: 'Cerrar encuesta', input: {} }];
    }
    return Object.freeze({ updateAccess, updateLive, receive, operate, refresh: read, emergencyActions, getState: () => state });
  }
  return Object.freeze({ createController });
});
