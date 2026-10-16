(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventGameTimeConsole = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const integer = v => Number.isSafeInteger(v) && v >= 0;
  const number = v => Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
  const uuid = v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
  const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;
  const kinds = ['STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT'];
  const gameIds = ['breakout', 'pong'];
  const check = value => { if (!value) throw Object.assign(new Error('INVALID_GAME_TIME_RESPONSE'), { code: 'INVALID_GAME_TIME_RESPONSE' }); };
  const freeze = Object.freeze;
  function numeric(source, fields) {
    check(source && fields.every(k => number(source[k]) && Math.abs(source[k]) <= 10));
    return freeze(Object.fromEntries(fields.map(k => [k, source[k]])));
  }
  function teams(source) {
    check(source);
    return freeze(Object.fromEntries(['left', 'right'].map(key => {
      const t = source[key]; check(t && text(t.name, 24) && integer(t.score));
      return [key, freeze({ name: t.name, score: t.score })];
    })));
  }
  function gameProjection(v, kind) {
    check(v.queueRunId === null || uuid(v.queueRunId));
    const out = { eventId: v.eventId, liveSessionId: v.liveSessionId, revision: v.revision, queueRunId: v.queueRunId, game: null };
    if (kind !== 'PARTICIPANT') {
      const q = v.queue;
      check(q && ['idle','running','finished'].includes(q.status) && Array.isArray(q.catalog) && q.catalog.length <= 2
        && Array.isArray(q.selected) && q.selected.length <= 2 && new Set(q.selected).size === q.selected.length
        && q.selected.every(id => gameIds.includes(id)) && typeof q.locked === 'boolean' && q.locked === (q.status !== 'idle')
        && integer(q.revision) && Number.isSafeInteger(q.current_index) && q.current_index >= -1 && q.current_index <= 1
        && ['', ...gameIds].includes(q.current_game_type) && ['', ...gameIds].includes(q.next_game_type)
        && (q.transition_at_ms === null || number(q.transition_at_ms)));
      const seen = new Set();
      const catalog = q.catalog.map(row => {
        check(row && gameIds.includes(row.id) && !seen.has(row.id) && text(row.title,120) && text(row.mode,120)
          && integer(row.difficulty) && typeof row.available === 'boolean'); seen.add(row.id);
        return freeze({id:row.id,title:row.title,mode:row.mode,difficulty:row.difficulty,available:row.available});
      });
      check(q.selected.every(id => seen.has(id)) && (q.status === 'idle' ? !v.queueRunId && !v.game : Boolean(v.queueRunId && v.game)));
      out.queue = freeze({status:q.status,selected:freeze([...q.selected]),current_game_type:q.current_game_type,current_index:q.current_index,
        next_game_type:q.next_game_type,transition_at_ms:q.transition_at_ms,locked:q.locked,revision:q.revision,catalog:freeze(catalog)});
    }
    if (v.game === null) return freeze(out);
    const g = v.game;
    check(g && uuid(g.id) && v.queueRunId && gameIds.includes(g.type) && ['ready','countdown','running','paused','finished','closed'].includes(g.status)
      && number(g.remaining_ms) && g.remaining_ms >= 0);
    const result = {id:g.id,type:g.type,status:g.status,remaining_ms:g.remaining_ms};
    if (g.type === 'pong') {
      result.teams = teams(g.teams);
      if (kind === 'PARTICIPANT') {
        const m = g.membership; check(m && ['', 'left', 'right'].includes(m.team) && typeof m.spectator === 'boolean' && typeof m.roster_locked === 'boolean');
        result.membership = freeze({team:m.team,spectator:m.spectator,roster_locked:m.roster_locked});
      }
    }
    if (kind !== 'PARTICIPANT') {
      result.ball = numeric(g.ball,['x','y','radius']); check(result.ball.radius > 0 && result.ball.radius <= 1);
      if (g.type === 'pong') {
        result.paddles = freeze(Object.fromEntries(['left','right'].map(k=>[k,numeric(g.paddles?.[k],['x','y','width','height'])])));
        check(['','left','right','tie'].includes(g.winner_team)); result.winner_team = g.winner_team;
        if (kind !== 'PLAYER') { check(g.roster_counts && integer(g.roster_counts.left) && integer(g.roster_counts.right)); result.roster_counts = freeze({left:g.roster_counts.left,right:g.roster_counts.right}); }
      } else {
        check(integer(g.score) && integer(g.misses) && number(g.countdown_remaining_ms) && g.countdown_remaining_ms >= 0 && Array.isArray(g.blocks) && g.blocks.length <= 100);
        result.score=g.score;result.misses=g.misses;result.countdown_remaining_ms=g.countdown_remaining_ms;
        result.paddle=numeric(g.paddle,['x','width']);
        result.blocks=freeze(g.blocks.map(b=>{check(typeof b.active==='boolean');return freeze({...numeric(b,['x','y','width','height']),active:b.active});}));
      }
    }
    out.game=freeze(result); return freeze(out);
  }
  function timeProjection(v,kind) {
    check(number(v.serverNow) && (v.timeRunId === null || uuid(v.timeRunId)));
    const out={eventId:v.eventId,liveSessionId:v.liveSessionId,revision:v.revision,serverNow:v.serverNow,timeRunId:v.timeRunId,screen:null};
    if(kind==='PARTICIPANT') return freeze(out);
    const s=v.screen; check(s && [null,'stopwatch','countdown','clock'].includes(s.mode) && typeof s.visible==='boolean' && typeof s.running==='boolean'
      && ['elapsedMs','remainingMs','durationMs'].every(k=>number(s[k])&&s[k]>=0));
    out.screen=freeze({mode:s.mode,visible:s.visible,running:s.running,elapsedMs:s.elapsedMs,remainingMs:s.remainingMs,durationMs:s.durationMs});
    if(['STAGE','SPEAKER'].includes(kind)){check(v.speaker && typeof v.speaker.running==='boolean' && number(v.speaker.elapsedMs) && v.speaker.elapsedMs>=0);out.speaker=freeze({running:v.speaker.running,elapsedMs:v.speaker.elapsedMs});}
    return freeze(out);
  }
  function createFamily({access,onState=()=>{}}, family) {
    let grant=null,generation=-1,liveId=null,snapshot=null,pending=false,sequence=0;
    let state=freeze({status:'waiting',kind:null,snapshot:null,pending:false,code:null});
    function publish(status,code=null){state=freeze({status,kind:grant?.context.kind||null,snapshot,pending,code});onState(state);}
    function reset(){sequence++;liveId=snapshot=null;pending=false;publish('waiting');}
    function updateAccess(value){if(value.status!=='ready'){grant=null;generation=-1;reset();return;}if(generation!==value.generation){grant=value;generation=value.generation;reset();}else{grant=value;publish(state.status,state.code);}}
    function accept(value){
      check(grant && liveId && value && kinds.includes(grant.context.kind) && value.eventId===grant.context.eventId && value.liveSessionId===liveId && integer(value.revision));
      const view=family==='game'?gameProjection(value,grant.context.kind):timeProjection(value,grant.context.kind);
      const run=family==='game'?'queueRunId':'timeRunId';
      if(snapshot && (view.revision<snapshot.revision || view.revision===snapshot.revision && view[run]!==snapshot[run]
        || family==='time' && view.revision===snapshot.revision && view.serverNow<snapshot.serverNow))return false;
      snapshot=view;return true;
    }
    async function send(action,payload,read=false){
      const version=generation,ticket=++sequence;pending=true;publish(snapshot?'ready':'loading');
      try{const result=await access.command('events:'+family+':'+action,payload);
        if(!grant||version!==generation||ticket!==sequence)return false;
        if(!result.ok)throw Object.assign(new Error(result.code||'LIVE_ACCESS_DENIED'),{code:result.code||'LIVE_ACCESS_DENIED'});
        accept(result.snapshot);pending=false;publish('ready');return true;
      }catch(e){if(!grant||version!==generation||ticket!==sequence)return false;pending=false;
        if(read||e.code==='INVALID_GAME_TIME_RESPONSE')snapshot=null;
        publish(snapshot?'ready':'unavailable',e.code||'LIVE_ACCESS_DENIED');
        if(snapshot && /^(GAME_(STALE_RUN|STALE_REVISION|INVALID_STATE|QUEUE_LOCKED|ROSTER_LOCKED|SPECTATOR)|TIME_(STALE_REVISION|INVALID_STATE))$/.test(e.code))await refresh();
        return false;}
    }
    function refresh(){if(!grant||!liveId||pending)return Promise.resolve(false);return send('snapshot',{},true);}
    function updateLive(value){if(!grant||value.status!=='live'||!value.snapshot||value.snapshot.eventId!==grant.context.eventId){if(liveId)reset();return;}if(liveId===value.snapshot.liveSessionId)return;reset();liveId=value.snapshot.liveSessionId;refresh();}
    function receive(name,value){if(name!=='events:'+family+':state'||!grant||!liveId||state.status!=='ready'||value?.eventId!==grant.context.eventId||value?.liveSessionId!==liveId)return;try{if(accept(value))publish('ready',state.code);}catch(_){sequence++;snapshot=null;pending=false;publish('unavailable','INVALID_GAME_TIME_RESPONSE');}}
    function availableActions(){
      if(!grant||state.status!=='ready'||!snapshot)return [];
      if(family==='time'){
        if(state.kind==='PARTICIPANT')return [];
        const s=snapshot.screen,rows=['screen:start'];
        if(s.visible){if(s.running)rows.push('screen:stop');else if(s.mode==='stopwatch'||s.mode==='countdown'&&s.remainingMs>0)rows.push('screen:resume');if(s.mode!=='clock')rows.push('screen:reset');rows.push('screen:hide');}
        if(snapshot.speaker){rows.push(snapshot.speaker.running?'speaker:stop':'speaker:start');if(snapshot.speaker.running||snapshot.speaker.elapsedMs>0)rows.push('speaker:reset');}return rows;
      }
      const g=snapshot.game,q=snapshot.queue;
      if(state.kind==='PARTICIPANT')return !g?[]:g.status==='ready'||g.status==='running'?g.type==='breakout'?['input']:g.membership.spectator?[]:[...(g.status==='ready'&&!g.membership.roster_locked?['join_team']:[]),...(g.membership.team?['input']:[])]:[];
      if(q.status==='idle')return ['configure',...(q.selected.length?['start_queue']:[])];
      return ['end',...(q.status==='running'?['skip']:[]),...(g.status==='ready'?['start',...(g.type==='pong'?['team_names']:[])]:g.status==='running'?['pause']:g.status==='paused'?['resume']:[])];
    }
    function operate(action,input={}){
      if(!grant||!liveId||state.status!=='ready'||pending||!snapshot)return Promise.resolve(false);
      if(input.expectedRevision!==undefined && input.expectedRevision!==snapshot.revision)return Promise.resolve(false);
      if(family==='time'){
        const target=input.target;if(!availableActions().includes(target+':'+action))return Promise.resolve(false);
        if(input.timeRunId!==undefined && input.timeRunId!==snapshot.timeRunId)return Promise.resolve(false);
        const payload={target,action,expectedRevision:snapshot.revision};
        if(target==='screen'&&action==='start'){if(!['stopwatch','countdown','clock'].includes(input.mode))return Promise.resolve(false);payload.mode=input.mode;
          if(input.mode==='countdown'){if(![['hours',99],['minutes',59],['seconds',59]].every(([k,max])=>integer(input[k])&&input[k]<=max)||input.hours+input.minutes+input.seconds===0)return Promise.resolve(false);for(const k of ['hours','minutes','seconds'])payload[k]=input[k];}}
        return send('control',payload);
      }
      if(!availableActions().includes(action))return Promise.resolve(false);
      const g=snapshot.game,q=snapshot.queue;
      if(input.queueRunId!==undefined&&input.queueRunId!==snapshot.queueRunId||input.gameRunId!==undefined&&input.gameRunId!==g?.id)return Promise.resolve(false);
      let payload;
      if(['configure','start_queue','skip','end'].includes(action)){
        payload={expectedRevision:snapshot.revision};
        if(action==='configure'){if(!Array.isArray(input.selected)||input.selected.length>2||new Set(input.selected).size!==input.selected.length||input.selected.some(id=>!q.catalog.some(row=>row.id===id&&row.available)))return Promise.resolve(false);payload.selected=[...input.selected];}
        if(['skip','end'].includes(action))payload.queueRunId=snapshot.queueRunId;
      }else{payload={gameRunId:g.id};
        if(action==='team_names'){if(!['left','right'].every(k=>text(input[k],24)))return Promise.resolve(false);payload.left=input.left;payload.right=input.right;}
        if(action==='join_team'){if(!['left','right'].includes(input.team))return Promise.resolve(false);payload.team=input.team;}
        if(action==='input'){if(!(g.type==='breakout'?['left','right']:['up','down']).includes(input.direction))return Promise.resolve(false);payload.direction=input.direction;}}
      return send(action,payload);
    }
    function emergencyActions(){
      if(state.kind!=='PLAYER'||state.status!=='ready'||pending||!snapshot)return [];
      if(family==='time'){
        const input={target:'screen',expectedRevision:snapshot.revision,timeRunId:snapshot.timeRunId},labels={stop:'Pausar tiempo',resume:'Continuar tiempo',reset:'Reiniciar tiempo',hide:'Ocultar tiempo'};
        return [{action:'start',title:'Cronómetro en Pantalla',input:{...input,mode:'stopwatch'},confirm:snapshot.screen.visible},
          {action:'start',title:'Hora actual',input:{...input,mode:'clock'},confirm:snapshot.screen.visible},
          ...[1,5,10,15,30,60].map(minutes=>({action:'start',title:'Temporizador · '+minutes+' min',input:{...input,mode:'countdown',hours:Math.floor(minutes/60),minutes:minutes%60,seconds:0},confirm:snapshot.screen.visible})),
          ...availableActions().filter(x=>x!=='screen:start').map(x=>({action:x.split(':')[1],title:labels[x.split(':')[1]],input,confirm:['screen:reset','screen:hide'].includes(x)}))];
      }
      const q=snapshot.queue,input={queueRunId:snapshot.queueRunId,...(snapshot.game?{gameRunId:snapshot.game.id}:{})};
      if(q.status==='idle')return [...q.catalog.filter(x=>x.available).map(row=>({action:'configure',title:(q.selected.includes(row.id)?'Quitar ':'Seleccionar ')+row.title,input:{selected:q.selected.includes(row.id)?q.selected.filter(id=>id!==row.id):[...q.selected,row.id],expectedRevision:snapshot.revision}})),
        ...(q.selected.length?[{action:'start_queue',title:'Abrir juegos',input:{expectedRevision:snapshot.revision}}]:[])];
      const labels={start:'Iniciar juego',pause:'Pausar juego',resume:'Continuar juego',skip:'Saltar juego',end:'Terminar juegos'};
      // Physics revisions change every frame. Bind menu consent to the queue and
      // current game, then send the latest observed revision at execution time.
      // The server still rejects a revision race; a rejection reads, never retries.
      return availableActions().filter(a=>labels[a]).map(action=>({action,title:labels[action],input,confirm:['skip','end'].includes(action)}));
    }
    return freeze({updateAccess,updateLive,receive,refresh,operate,availableActions,emergencyActions,getState:()=>state});
  }
  return freeze({createGameController:options=>createFamily(options,'game'),createTimeController:options=>createFamily(options,'time')});
});
