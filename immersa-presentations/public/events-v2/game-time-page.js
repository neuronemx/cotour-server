(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaEventGameTimePage=factory();})(typeof window==='object'?window:this,function(){
  'use strict';
  const labels={ready:'Listo para iniciar',countdown:'Preparados…',running:'En juego',paused:'Juego pausado',finished:'Juego terminado',closed:'Juego cerrado'};
  const actionLabels={start_queue:'Abrir juegos',start:'Iniciar juego',pause:'Pausar juego',resume:'Continuar juego',skip:'Saltar juego',end:'Terminar juegos'};
  const format=ms=>{const s=Math.max(0,Math.floor(ms/1000));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');};
  function createView({document,game,time,now=Date.now,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}){
    const $=id=>document.getElementById(id);let gs=game.getState(),ts=time.getState(),catalogKey=null,catalog=[],gameId=null,lastNames=null,held=null,holdTimer=null,clockTimer=null,pollTimer=null,receivedAt=0,confirmation=null;
    const gameFence=()=>JSON.stringify([gs.snapshot?.queueRunId,gs.snapshot?.game?.id,gs.snapshot?.game?.status,gs.snapshot?.queue?.status,gs.snapshot?.queue?.selected]);
    const timeFence=()=>JSON.stringify([ts.snapshot?.timeRunId,ts.snapshot?.revision]);
    function clearConfirm(){confirmation=null;if($('game-time-confirm-dialog').open)$('game-time-confirm-dialog').close();}
    function confirm(family,action,input,title){const state=family==='game'?gs:ts;if(state.status!=='ready'||state.pending)return;confirmation={family,action,input,fence:family==='game'?gameFence():timeFence()};$('game-time-confirm-title').textContent='¿'+title+'?';$('game-time-confirm-dialog').showModal();}
    function stopHold(){held=null;if(holdTimer!==null)clearTimeoutFn(holdTimer);holdTimer=null;}
    function pulse(){holdTimer=null;const g=gs.snapshot?.game;if(!held||gs.status!=='ready'||g?.id!==held.id||!game.availableActions().includes('input')){stopHold();return;}game.operate('input',{direction:held.direction,gameRunId:held.id});holdTimer=setTimeoutFn(pulse,90);}
    function startHold(direction,event){event?.preventDefault?.();stopHold();if(gs.kind!=='PARTICIPANT'||!game.availableActions().includes('input'))return;held={direction,id:gs.snapshot.game.id};pulse();}
    function board(g){
      const canvas=$('game-board');canvas.hidden=gs.kind!=='PLAYER'||!g;
      const ctx=canvas.getContext?.('2d');if(!ctx)return;ctx.clearRect(0,0,960,540);if(canvas.hidden)return;
      ctx.fillStyle='#10172b';ctx.fillRect(0,0,960,540);
      const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x*960,y*540,w*960,h*540);};
      if(g.type==='breakout'){for(const b of g.blocks)if(b.active)rect(b.x,b.y,b.width,b.height,'#75dcff');rect(g.paddle.x-g.paddle.width/2,.9,g.paddle.width,.018,'#fff');}
      else{for(const side of ['left','right']){const p=g.paddles[side];rect(p.x-p.width/2,p.y-p.height/2,p.width,p.height,side==='left'?'#79b7ff':'#ff8484');}}
      ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(g.ball.x*960,g.ball.y*540,g.ball.radius*960,g.ball.radius*540,0,0,Math.PI*2);ctx.fill();
    }
    function renderGame(value){gs=value;const s=gs.snapshot,g=s?.game,usable=gs.status==='ready'&&Boolean(s),operator=['STAGE','SPEAKER'].includes(gs.kind),publicView=gs.kind==='PARTICIPANT';
      $('game-panel').hidden=gs.status==='waiting'||!operator&&(!usable||!g);$('game-operator').hidden=!usable||!operator;
      const errors={INTERACTION_BUSY:'Hay otra interacción activa.',GAME_TEAMS_INCOMPLETE:'Necesitamos participantes en ambos equipos.',GAME_STALE_REVISION:'El juego cambió. Comprueba la acción de nuevo.',GAME_CONTENT_NOT_PREPARED:'Los juegos aún no están preparados.',GAME_ROSTER_LOCKED:'Los equipos ya están cerrados.'};
      $('game-status').textContent=gs.code?errors[gs.code]||'No se pudo completar la acción.':!usable?'Comprobando juegos…':g?(g.type==='breakout'?'Breakout · ':'Pong · ')+labels[g.status]:s.queue?.selected.length?'Juegos seleccionados':'Selecciona los juegos';
      const key=usable&&operator?JSON.stringify(s.queue.catalog):null;
      if(catalogKey!==key){catalogKey=key;catalog=[];$('game-catalog').replaceChildren();if(key)for(const row of s.queue.catalog){const label=document.createElement('label'),input=document.createElement('input'),copy=document.createElement('span');input.type='checkbox';input.setAttribute('aria-label',row.title);copy.textContent=row.title+' · '+row.mode;label.append(input,copy);$('game-catalog').append(label);catalog.push({row,input});input.addEventListener('change',()=>{const selected=catalog.filter(x=>x.input.checked).map(x=>x.row.id);game.operate('configure',{selected,expectedRevision:gs.snapshot.revision});});}}
      for(const {row,input} of catalog){input.checked=Boolean(s?.queue?.selected.includes(row.id));input.disabled=!usable||gs.pending||s.queue.locked||!row.available;}
      const enabled=game.availableActions();for(const action of Object.keys(actionLabels)){$('game-'+action).hidden=!operator||!enabled.includes(action);$('game-'+action).disabled=gs.pending;}
      if(gameId!==g?.id){gameId=g?.id||null;lastNames=null;stopHold();}
      $('game-team-names').hidden=!operator||!usable||g?.type!=='pong'||g.status!=='ready';
      if(operator&&g?.type==='pong')for(const k of ['left','right']){if(!lastNames||$('game-name-'+k).value===lastNames[k])$('game-name-'+k).value=g.teams[k].name;}
      lastNames=operator&&g?.type==='pong'?{left:g.teams.left.name,right:g.teams.right.name}:null;
      if(!usable||!operator||g?.type!=='pong'){$('game-name-left').value='';$('game-name-right').value='';}
      for(const id of ['game-name-left','game-name-right','game-save-names'])$(id).disabled=gs.pending;
      $('game-team-choice').hidden=!usable||!publicView||!enabled.includes('join_team');
      for(const side of ['left','right']){$('game-join-'+side).textContent=g?.type==='pong'?g.teams[side].name:'';$('game-join-'+side).disabled=gs.pending;}
      const input=usable&&publicView&&enabled.includes('input');$('game-inputs').hidden=!input;
      for(const direction of ['left','right','up','down'])$('game-input-'+direction).hidden=!input||!(g.type==='breakout'?['left','right']:['up','down']).includes(direction);
      $('game-membership').textContent=usable&&publicView&&g?.type==='pong'?g.membership.spectator?'Esta partida ya comenzó. Puedes verla en Pantalla.':g.membership.team?'Tu equipo: '+g.teams[g.membership.team].name:'Elige tu equipo':'';
      if(held&&(!input||held.id!==g.id))stopHold();
      $('game-score').textContent=usable&&g?(g.type==='pong'?g.teams.left.name+' '+g.teams.left.score+' · '+g.teams.right.score+' '+g.teams.right.name:publicView?'':String(g.score)+' puntos'):'';
      $('game-remaining').textContent=usable&&g?(g.status==='countdown'&&g.countdown_remaining_ms!==undefined?Math.ceil(g.countdown_remaining_ms/1000)+' s':Math.ceil(g.remaining_ms/1000)+' s'):'';
      $('game-result').textContent=usable&&g?.status==='finished'?g.type==='breakout'?publicView?'Juego terminado':g.score+' puntos':publicView?'Partida terminada':g.winner_team==='tie'?'Empate':g.winner_team?'Ganó '+g.teams[g.winner_team].name:'':'';
      board(usable?g:null);
      if(confirmation?.family==='game'&&(!usable||gs.pending||confirmation.fence!==gameFence()))clearConfirm();
      // Server owns physics and queue transitions. A bounded read also recovers
      // frames after all previous controller witnesses disappeared.
      if(pollTimer!==null)clearTimeoutFn(pollTimer);pollTimer=null;
      if(usable&&g&&gs.kind!=='PARTICIPANT')pollTimer=setTimeoutFn(()=>{pollTimer=null;game.refresh();},1000);
    }
    function clock(){
      if(clockTimer!==null)clearTimeoutFn(clockTimer);clockTimer=null;
      const s=ts.snapshot,usable=ts.status==='ready'&&s,delta=Math.max(0,now()-receivedAt),screen=s?.screen;
      $('time-screen-output').hidden=!usable||!screen?.visible;
      $('time-screen-output').textContent=!usable||!screen?.visible?'':screen.mode==='clock'?new Date(s.serverNow+delta).toLocaleTimeString('es-MX')
        :format(screen.mode==='countdown'?Math.max(0,screen.remainingMs-(screen.running?delta:0)):screen.elapsedMs+(screen.running?delta:0));
      $('time-speaker-output').textContent=usable&&s.speaker?format(s.speaker.elapsedMs+(s.speaker.running?delta:0)):'';
      if(usable&&(screen?.visible||s.speaker?.running))clockTimer=setTimeoutFn(()=>{clockTimer=null;if(screen?.mode==='countdown'&&screen.running&&Math.max(0,now()-receivedAt)>=screen.remainingMs&&!ts.pending)time.refresh();else clock();},500);
    }
    function renderTime(value){if(value.snapshot!==ts.snapshot)receivedAt=now();ts=value;const s=ts.snapshot,usable=ts.status==='ready'&&s,operator=['STAGE','SPEAKER'].includes(ts.kind);
      $('time-panel').hidden=ts.status==='waiting'||ts.kind==='PARTICIPANT'||ts.kind==='PLAYER'&&(!usable||!s.screen.visible);$('time-controls').hidden=!operator||!usable;$('time-speaker').hidden=!operator||!usable;
      $('time-status').textContent=ts.code?ts.code==='TIME_STALE_REVISION'?'El tiempo cambió. Comprueba la acción de nuevo.':'No se pudo completar la acción.':!usable?'Comprobando tiempo…':'';
      const actions=time.availableActions();for(const target of ['screen','speaker'])for(const action of target==='screen'?['stop','resume','reset','hide']:['start','stop','reset']){$('time-'+target+'-'+action).hidden=!operator||!actions.includes(target+':'+action);$('time-'+target+'-'+action).disabled=ts.pending;}
      for(const id of ['time-mode','time-hours','time-minutes','time-seconds','time-start'])$(id).disabled=!usable||ts.pending;
      $('time-duration').hidden=$('time-mode').value!=='countdown';
      if(confirmation?.family==='time'&&(!usable||ts.pending||confirmation.fence!==timeFence()))clearConfirm();clock();
    }
    for(const action of Object.keys(actionLabels))$('game-'+action).addEventListener('click',()=>{if(!game.availableActions().includes(action))return;const input={queueRunId:gs.snapshot.queueRunId,...(gs.snapshot.game?{gameRunId:gs.snapshot.game.id}:{}),...(action==='start_queue'?{expectedRevision:gs.snapshot.revision}:{})};if(['skip','end'].includes(action))confirm('game',action,input,actionLabels[action]);else game.operate(action,input);});
    $('game-save-names').addEventListener('click',()=>game.operate('team_names',{gameRunId:gs.snapshot?.game?.id,left:$('game-name-left').value,right:$('game-name-right').value}));
    for(const side of ['left','right'])$('game-join-'+side).addEventListener('click',()=>game.operate('join_team',{gameRunId:gs.snapshot?.game?.id,team:side}));
    for(const direction of ['left','right','up','down']){const button=$('game-input-'+direction);button.addEventListener('pointerdown',e=>{button.setPointerCapture?.(e.pointerId);startHold(direction,e);});for(const event of ['pointerup','pointercancel','lostpointercapture','blur'])button.addEventListener(event,stopHold);
      button.addEventListener('keydown',e=>{if(!e.repeat&&[' ','Enter'].includes(e.key))startHold(direction,e);});button.addEventListener('keyup',stopHold);}
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')stopHold();});
    $('time-mode').addEventListener('change',()=>renderTime(ts));
    $('time-start').addEventListener('click',()=>{const input={target:'screen',mode:$('time-mode').value,expectedRevision:ts.snapshot?.revision,timeRunId:ts.snapshot?.timeRunId};if(input.mode==='countdown')for(const k of ['hours','minutes','seconds'])input[k]=Number($('time-'+k).value);if(ts.snapshot?.screen.visible)confirm('time','start',input,'Reemplazar el tiempo en Pantalla');else time.operate('start',input);});
    for(const target of ['screen','speaker'])for(const action of target==='screen'?['stop','resume','reset','hide']:['start','stop','reset'])$('time-'+target+'-'+action).addEventListener('click',()=>{const input={target,expectedRevision:ts.snapshot?.revision,timeRunId:ts.snapshot?.timeRunId};if(['reset','hide'].includes(action))confirm('time',action,input,action==='hide'?'Ocultar tiempo':'Reiniciar tiempo');else time.operate(action,input);});
    $('game-time-cancel').addEventListener('click',clearConfirm);$('game-time-confirm').addEventListener('click',()=>{const item=confirmation;clearConfirm();if(item&&item.fence===(item.family==='game'?gameFence():timeFence()))(item.family==='game'?game:time).operate(item.action,item.input);});
    $('game-time-confirm-dialog').addEventListener('cancel',()=>{confirmation=null;});renderGame(gs);renderTime(ts);
    return Object.freeze({renderGame,renderTime,stopHold});
  }
  return Object.freeze({createView,format});
});
