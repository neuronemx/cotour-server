(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./interaction-images'));
  else root.ImmersaEventRaffleConsole = factory(root.ImmersaEventInteractionImages);
})(typeof window === 'object' ? window : this, function (images) {
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
    const uuid = v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
    const token = v => text(v, 96) && v.trim() === v;
    const check = v => { if (!v) throw fail('INVALID_RAFFLE_RESPONSE'); };
    const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
    const options = (rows,runId) => {
      check(Array.isArray(rows) && rows.length <= 20); const seen = new Set();
      return Object.freeze(rows.map(o => { check(o && token(o.id) && text(o.label,500) && !seen.has(o.id) && !['asset','thumbnail','thumb'].some(k => o[k])); seen.add(o.id); const out={id:o.id,label:o.label};if(o.image!==undefined){check(runId);const image=images?.scoped(o.image,grant.context,liveId,'raffle',runId);check(image);out.image=image;}return Object.freeze(out); }));
    };
    const winner = w => { check(w && text(w.name,120) && text(w.label,500) && (w.ticketNumber === null || integer(w.ticketNumber) && w.ticketNumber > 0)); return Object.freeze({name:w.name,label:w.label,ticketNumber:w.ticketNumber}); };
    function normalize(value) {
      check(grant && liveId && value && value.eventId === grant.context.eventId && value.liveSessionId === liveId && integer(value.revision)
        && (value.raffleRunId === null || uuid(value.raffleRunId)));
      const kind = grant.context.kind, publicView = kind === 'PARTICIPANT', operator = ['STAGE','SPEAKER'].includes(kind);
      check(publicView || operator || kind === 'PLAYER');
      const out = {eventId:value.eventId,liveSessionId:liveId,revision:value.revision,raffleRunId:value.raffleRunId,active:null};
      if (publicView) { check(typeof value.displayName === 'string' && value.displayName.length <= 120); out.displayName=value.displayName; }
      else {
        check(Array.isArray(value.available) && value.available.length <= 500); const seen = new Set();
        out.available=Object.freeze(value.available.map(row=>{ check(row && token(row.id) && text(row.title,240) && ['free','poll','visual_key'].includes(row.mode) && !seen.has(row.id)); seen.add(row.id);
          return Object.freeze({id:row.id,title:row.title,mode:row.mode,...(row.mode==='visual_key'?{keyOptions:options(row.keyOptions,operator?'catalog':null)}:{})}); }));
      }
      if (operator) { check(integer(value.previousWinnerCount) && Array.isArray(value.winners)); out.previousWinnerCount=value.previousWinnerCount; out.winners=Object.freeze(value.winners.slice(-100).map(winner)); }
      if (value.active === null) return Object.freeze(out);
      const r=value.active; check(r && r.type==='raffle' && uuid(r.id) && r.id===value.raffleRunId && ['free','poll','visual_key'].includes(r.mode)
        && ['collecting','entries_closed','drawing','winner'].includes(r.state) && text(r.title,240) && text(r.prompt,2000) && [2,3,4].includes(r.ticketDigits));
      const active={id:r.id,mode:r.mode,state:r.state,title:r.title,prompt:r.prompt,ticketDigits:r.ticketDigits,options:options(r.options,r.id)};
      for (const key of ['createdAt','entriesClosedAt','drawingAt','revealAt','winnerSelectedAt']) { check(r[key]===null || date(r[key])); active[key]=r[key]; }
      check(r.countdownRemainingMs===null || Number.isFinite(r.countdownRemainingMs) && r.countdownRemainingMs>=0); active.countdownRemainingMs=r.countdownRemainingMs;
      if (publicView) {
        check(typeof r.isWinner==='boolean' && (!r.isWinner || r.state==='winner')); active.isWinner=r.isWinner; active.ownEntry=null; active.ownSelection=null;
        if (r.ownEntry) { const e=r.ownEntry; check(token(e.selectedOptionId) || e.selectedOptionId===null); check(date(e.enteredAt)); active.ownEntry=Object.freeze({...winner(e),selectedOptionId:e.selectedOptionId,enteredAt:e.enteredAt}); }
        if (r.ownSelection) { const e=r.ownSelection; check(e.raffleId===r.id && token(e.selectedOptionId) && date(e.selectedAt)); active.ownSelection=Object.freeze({selectedOptionId:e.selectedOptionId,selectedAt:e.selectedAt}); }
      } else {
        active.winner = r.state==='winner' && r.winner ? winner(r.winner) : null;
        if (kind==='PLAYER') { check(typeof r.hasWinner==='boolean' && r.hasWinner===Boolean(active.winner)); active.displayOption=null;
          if (r.state==='collecting' && r.mode==='visual_key') { const rows=options([r.displayOption],r.id); check(rows[0].id===r.displayOptionId); active.displayOption=rows[0]; }
        } else {
          check(integer(r.entryCount) && integer(r.eligibleCount)); active.entryCount=r.entryCount; active.eligibleCount=r.eligibleCount;
          active.pollResults=null;
          if (r.mode==='poll') { const results=r.pollResults; check(results && integer(results.totalResponses) && Array.isArray(results.options));
            let total=0; const rows=results.options.map((o,i)=>{check(o.id===active.options[i]?.id && integer(o.count) && o.count<=results.totalResponses && o.percentage===(results.totalResponses?Math.round(o.count/results.totalResponses*100):0));total+=o.count;return Object.freeze({id:o.id,label:active.options[i].label,count:o.count,percentage:o.percentage});});
            check(rows.length===active.options.length && total===results.totalResponses);active.pollResults=Object.freeze({totalResponses:results.totalResponses,options:Object.freeze(rows)}); }
        }
      }
      out.active=Object.freeze(active);return Object.freeze(out);
    }
    function accept(value) {
      const view = normalize(value);
      if (snapshot && (view.revision < snapshot.revision || view.revision === snapshot.revision && view.raffleRunId !== snapshot.raffleRunId)) return false;
      snapshot = view; return true;
    }
    async function read() {
      if (!grant || !liveId || pending) return false;
      const version = generation, ticket = ++sequence; pending = true; publish(snapshot ? 'ready' : 'loading');
      try {
        const result = await access.command('events:raffle:snapshot');
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw fail(result.code || 'RAFFLE_ACCESS_DENIED');
        accept(result.snapshot); pending = false; publish('ready'); return true;
      } catch (e) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        snapshot = null; pending = false; publish('unavailable', e.code || 'RAFFLE_ACCESS_DENIED'); return false;
      }
    }
    function updateLive(value) {
      if (!grant || value.status !== 'live' || !value.snapshot || value.snapshot.eventId !== grant.context.eventId) { if (liveId) reset(); return; }
      if (liveId === value.snapshot.liveSessionId) return;
      reset(); liveId = value.snapshot.liveSessionId; read();
    }
    function receive(name, value) {
      if (name !== 'events:raffle:state' || !grant || !liveId || state.status !== 'ready'
        || value?.eventId !== grant.context.eventId || value?.liveSessionId !== liveId) return;
      try { if (accept(value)) publish('ready', state.code); }
      catch (_) { sequence++; snapshot = null; pending = false; publish('unavailable', 'INVALID_RAFFLE_RESPONSE'); }
    }
    function availableActions() {
      if (!grant || state.status!=='ready' || !snapshot || state.kind==='PARTICIPANT') return [];
      const r=snapshot.active;
      return r ? ({collecting:['close_entries','close'],entries_closed:['draw','reset_winners','close'],drawing:['reveal','close'],winner:['close']}[r.state] || []) : snapshot.raffleRunId ? ['reset_winners'] : [];
    }
    async function operate(action,input={}) {
      if (!grant || !liveId || state.status!=='ready' || pending || !snapshot || input.expectedRevision!==undefined && input.expectedRevision!==snapshot.revision) return false;
      const r=snapshot.active, publicView=state.kind==='PARTICIPANT'; let payload;
      if (['open','configure_key'].includes(action)) {
        const definition=snapshot.available?.find(row=>row.id===input.definitionId);
        if (publicView || r || !definition || action==='configure_key' && !definition.keyOptions?.some(o=>o.id===input.optionId)) return false;
        payload={definitionId:definition.id,...(action==='configure_key'?{optionId:input.optionId}:{})};
      } else {
        if (!snapshot.raffleRunId || input.raffleRunId!==undefined && input.raffleRunId!==snapshot.raffleRunId) return false;
        payload={raffleRunId:snapshot.raffleRunId};
        if (publicView) {
          if (!r || r.state!=='collecting' || !['enter','submit_poll_response'].includes(action) || (action==='submit_poll_response')!==(r.mode==='poll')
            || r.mode!=='visual_key' && r.ownEntry || input.name!==undefined && (typeof input.name!=='string' || input.name.length>120)) return false;
          if (r.mode==='free') { if (!(input.name ?? snapshot.displayName).trim()) return false; }
          else { if (!r.options.some(o=>o.id===input.optionId) || r.mode==='visual_key' && r.ownSelection?.selectedOptionId===input.optionId) return false; payload.optionId=input.optionId; }
          if (input.name!==undefined) payload.name=input.name;
        } else if (!availableActions().includes(action)) return false;
      }
      const version=generation,ticket=++sequence;pending=true;publish('ready');
      try {const result=await access.command('events:raffle:'+action,payload);
        if (!grant || generation!==version || sequence!==ticket) return false;
        if (!result.ok) throw fail(result.code || 'RAFFLE_ACCESS_DENIED');
        accept(result.snapshot);pending=false;publish('ready');return true;
      } catch(e) {
        if (!grant || generation!==version || sequence!==ticket) return false;
        pending=false;if(e.code==='INVALID_RAFFLE_RESPONSE')snapshot=null;publish(snapshot?'ready':'unavailable',e.code || 'RAFFLE_ACCESS_DENIED');
        if(snapshot && ['RAFFLE_STALE_EXECUTION','RAFFLE_NOT_ACTIVE','RAFFLE_DUPLICATE_ENTRY','RAFFLE_INVALID_STATE','RAFFLE_ENTRIES_NOT_COLLECTING','RAFFLE_STATE_CHANGED'].includes(e.code))await read();return false;
      }
    }
    function emergencyActions() {
      if(state.kind!=='PLAYER' || state.status!=='ready' || pending || !snapshot)return [];
      const input={raffleRunId:snapshot.raffleRunId,expectedRevision:snapshot.revision};
      if(!snapshot.active) return [...snapshot.available.flatMap(row=>[
        {action:'open',title:row.title,input:{definitionId:row.id,expectedRevision:snapshot.revision}},
        ...(row.keyOptions || []).map(o=>({action:'configure_key',title:'Clave · '+row.title+' · '+o.label,input:{definitionId:row.id,optionId:o.id,expectedRevision:snapshot.revision}}))]),
        ...availableActions().map(action=>({action,title:'Reiniciar ganadores',input,confirm:true}))];
      const labels={close_entries:'Cerrar participación',draw:'Sortear',reveal:'Revelar ganador',close:'Cerrar sorteo',reset_winners:'Reiniciar ganadores'};
      return availableActions().map(action=>({action,title:labels[action]+' · '+snapshot.active.title,input,confirm:['close_entries','draw','close','reset_winners','reveal'].includes(action)}));
    }
    return Object.freeze({ updateAccess, updateLive, receive, operate, refresh: read, availableActions, emergencyActions, getState: () => state });
  }
  return Object.freeze({ createController });
});
