(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaEventRafflePage=factory();})(typeof window==='object'?window:this,function(){
  'use strict';
  const labels={collecting:'Participación abierta',entries_closed:'Participación cerrada',drawing:'Sorteando…',winner:'Ganador revelado'};
  const actions={close_entries:'Cerrar participación',draw:'Sortear',reveal:'Revelar ganador',close:'Cerrar sorteo',reset_winners:'Reiniciar ganadores'};
  function createView({document,controller,now=Date.now,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}){
    const $=id=>document.getElementById(id);let state,savedName=null,runId=null,signature=null,buttons=[],confirmation=null,timer=null,timing=null,receivedAt=0;
    function clock(){if(timer!==null)clearTimeoutFn(timer);timer=null;const r=state.snapshot?.active;$('raffle-clock').textContent='';
      if(state.status!=='ready'||r?.state!=='drawing')return;
      const remaining=Math.max(0,r.countdownRemainingMs-Math.max(0,now()-receivedAt));$('raffle-clock').textContent=remaining>0?Math.ceil(remaining/1000)+' s':'Esperando revelación…';
      timer=setTimeoutFn(()=>{timer=null;if(remaining<=0&&!state.pending)controller.refresh();else clock();},remaining>0?500:1000);
    }
    function render(value){state=value;const s=state.snapshot,r=s?.active,usable=state.status==='ready'&&Boolean(s),publicView=state.kind==='PARTICIPANT',operator=['STAGE','SPEAKER'].includes(state.kind);
      if(runId!==s?.raffleRunId){runId=s?.raffleRunId||null;savedName=null;}
      const nextTiming=r?[r.id,r.state,r.countdownRemainingMs].join(':'):null;if(timing!==nextTiming){timing=nextTiming;receivedAt=now();}
      $('raffle-panel').hidden=state.kind==='PLAYER'?!usable||!r:state.status==='waiting';$('raffle-controls').hidden=!operator||!usable;
      $('raffle-title').textContent=usable?r?.title||'':'';$('raffle-prompt').textContent=usable?r?.prompt||'':'';
      const errors={INTERACTION_BUSY:'Hay otra interacción activa.',RAFFLE_NAME_REQUIRED:'Escribe tu nombre.',RAFFLE_NO_ENTRIES:'No hay participaciones válidas.',RAFFLE_NO_ELIGIBLE_ENTRIES:'No quedan participantes elegibles. Puedes reiniciar ganadores.',RAFFLE_NO_CONNECTED_ELIGIBLE_ENTRIES:'No hay participantes elegibles conectados.',RAFFLE_WINNER_NOT_CONNECTED:'La persona seleccionada no está conectada.',RAFFLE_STALE_EXECUTION:'El sorteo cambió. Comprobando estado…',RAFFLE_DUPLICATE_ENTRY:'Tu participación ya está guardada.',RAFFLE_CONTENT_NOT_PREPARED:'Los sorteos aún no están preparados.'};
      $('raffle-status').textContent=state.code?errors[state.code]||'No se pudo completar la acción.':!usable?'Comprobando sorteos…':r?labels[r.state]:'No hay sorteo abierto';
      const old=$('raffle-catalog').value,oldKey=$('raffle-key').value;$('raffle-catalog').replaceChildren();
      if(usable&&operator)for(const row of s.available){const o=document.createElement('option');o.value=row.id;o.textContent=row.title;$('raffle-catalog').append(o);}
      $('raffle-catalog').value=s?.available?.some(row=>row.id===old)?old:s?.available?.[0]?.id||'';
      const definition=s?.available?.find(row=>row.id===$('raffle-catalog').value);$('raffle-key').replaceChildren();
      if(operator&&definition?.keyOptions)for(const row of definition.keyOptions){const o=document.createElement('option');o.value=row.id;o.textContent=row.label;$('raffle-key').append(o);}
      $('raffle-key').value=definition?.keyOptions?.some(row=>row.id===oldKey)?oldKey:definition?.keyOptions?.[0]?.id||'';
      $('raffle-key-controls').hidden=!operator||!definition?.keyOptions||Boolean(r);
      for(const id of ['raffle-catalog','raffle-open','raffle-key','raffle-configure-key'])$(id).disabled=!usable||state.pending||Boolean(r)||!definition;
      const enabled=controller.availableActions();for(const action of Object.keys(actions)){$('raffle-'+action).hidden=!operator||!enabled.includes(action);$('raffle-'+action).disabled=state.pending;}
      $('raffle-counts').textContent=usable&&operator&&r?r.entryCount+' participantes · '+r.eligibleCount+' elegibles':'';
      const collecting=usable&&publicView&&r?.state==='collecting';$('raffle-registration').hidden=!collecting||r.mode!=='visual_key'&&Boolean(r.ownEntry);
      if(!collecting){$('raffle-name').value='';savedName=null;}else if(savedName===null||$('raffle-name').value===savedName){$('raffle-name').value=s.displayName;savedName=s.displayName;}
      $('raffle-name').disabled=state.pending;$('raffle-name').required=r?.mode==='free';$('raffle-enter').hidden=!collecting||r.mode!=='free';$('raffle-enter').disabled=state.pending;
      const sig=collecting?JSON.stringify([r.id,r.mode,r.options]):null;
      if(signature!==sig){signature=sig;buttons=[];$('raffle-options').replaceChildren();if(collecting)for(const row of r.options){const button=document.createElement('button');button.type='button';button.textContent=row.label;button.addEventListener('click',()=>controller.operate(r.mode==='poll'?'submit_poll_response':'enter',{optionId:row.id,name:$('raffle-name').value}));buttons.push({id:row.id,button});$('raffle-options').append(button);}}
      for(const row of buttons){row.button.disabled=state.pending||r.mode!=='visual_key'&&Boolean(r.ownEntry);row.button.setAttribute('aria-pressed',String((r.ownEntry?.selectedOptionId||r.ownSelection?.selectedOptionId)===row.id));}
      const entry=publicView?r?.ownEntry:null,selection=publicView?r?.ownSelection:null;
      $('raffle-receipt').textContent=entry?'Estás participando… · '+String(entry.ticketNumber).padStart(r.ticketDigits,'0')+' · Mucha suerte':selection?(r.state==='collecting'?'Selección guardada.':r.state==='entries_closed'||r.state==='drawing'?'Tu selección no participa en este sorteo.':'Selección registrada.') :'';
      $('raffle-winner').textContent=usable&&r?.state==='winner'?publicView?r.isWinner?'Ganaste':'El ganador ya fue revelado.':r.winner?r.winner.name+' · '+String(r.winner.ticketNumber).padStart(r.ticketDigits,'0'):'' :'';
      $('raffle-display-option').textContent=usable&&state.kind==='PLAYER'?r?.displayOption?.label||'':'';
      if(confirmation&&(!usable||state.pending||confirmation.raffleRunId!==s.raffleRunId||confirmation.expectedRevision!==s.revision)){confirmation=null;if($('raffle-confirm-dialog').open)$('raffle-confirm-dialog').close();}clock();
    }
    $('raffle-catalog').addEventListener('change',()=>render(state));$('raffle-open').addEventListener('click',()=>controller.operate('open',{definitionId:$('raffle-catalog').value,expectedRevision:state.snapshot?.revision}));
    $('raffle-configure-key').addEventListener('click',()=>controller.operate('configure_key',{definitionId:$('raffle-catalog').value,optionId:$('raffle-key').value,expectedRevision:state.snapshot?.revision}));
    $('raffle-enter').addEventListener('click',()=>controller.operate('enter',{name:$('raffle-name').value}));
    for(const [action,title] of Object.entries(actions))$('raffle-'+action).addEventListener('click',()=>{if(state.status!=='ready'||state.pending||!controller.availableActions().includes(action))return;confirmation={action,raffleRunId:state.snapshot.raffleRunId,expectedRevision:state.snapshot.revision};$('raffle-confirm-title').textContent='¿'+title+'?';$('raffle-confirm-detail').textContent=action==='reset_winners'?'Los ganadores anteriores volverán a ser elegibles.':'Se aplicará al sorteo actual.';$('raffle-confirm-dialog').showModal();});
    $('raffle-cancel-confirm').addEventListener('click',()=>{confirmation=null;$('raffle-confirm-dialog').close();});$('raffle-confirm').addEventListener('click',()=>{const item=confirmation;confirmation=null;$('raffle-confirm-dialog').close();if(item){const{action,...input}=item;controller.operate(action,input);}});
    render(controller.getState());return Object.freeze({render});
  }return Object.freeze({createView});
});
