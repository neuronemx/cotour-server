(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaEventSlidesPage=factory();})(typeof window==='object'?window:this,function(){
  'use strict';
  function createView({document,controller,onVisibility=()=>{},getDrawingEnabled=()=>false}){
    const $=id=>document.getElementById('slides-'+id), slots=['image','preview','next'], loaded={},pending={};
    let state=controller.getState(),scope=null,epoch=0,visible=false,lastKey=null,notesKey=null,pointerId=null,lastY=0;
    function hidePrompter(){pointerId=null;$('prompter').hidden=true;$('notes-current').textContent='';$('notes-next').textContent='';$('notes-current').scrollTop=0;}
    function canRead(){return state.status==='ready'&&['STAGE','SPEAKER'].includes(state.kind)&&!getDrawingEnabled()&&!!state.snapshot?.prompter?.current.text.trim();}
    function showPrompter(){if(!canRead())return false;const notes=state.snapshot.prompter;$('notes-current').textContent=notes.current.text;$('notes-current').lang=notes.current.language;$('notes-next').textContent=notes.next?.text||'';$('notes-next').lang=notes.next?.language||notes.current.language;$('notes-next').hidden=!notes.next?.text.trim();$('prompter').className=notes.next?.text.trim()?'has-preview':'';$('prompter').hidden=false;$('notes-current').scrollTop=0;return true;}
    const target=$('prompter-target');
    target.addEventListener('pointerdown',event=>{if(event.button!==0||!showPrompter())return;pointerId=event.pointerId;lastY=event.clientY;target.setPointerCapture?.(pointerId);event.preventDefault();});
    target.addEventListener('pointermove',event=>{if(pointerId===null||event.pointerId!==pointerId)return;if(!canRead()){hidePrompter();return;}$('notes-current').scrollTop+=lastY-event.clientY;lastY=event.clientY;event.preventDefault();});
    target.addEventListener('pointerup',event=>{if(event.pointerId===pointerId)hidePrompter();});
    for(const name of ['pointercancel','lostpointercapture','blur'])target.addEventListener(name,hidePrompter);
    target.addEventListener('keydown',event=>{if(event.key==='Escape')hidePrompter();else if([' ','Enter'].includes(event.key)&&canRead()){event.preventDefault();if(!event.repeat)showPrompter();}});
    target.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key))hidePrompter();});
    target.addEventListener('dragstart',event=>event.preventDefault());
    target.addEventListener('contextmenu',event=>event.preventDefault());
    document.defaultView?.addEventListener('blur',hidePrompter);
    document.addEventListener?.('visibilitychange',()=>{if(document.hidden)hidePrompter();});
    function cancel(){epoch++;for(const row of Object.values(pending)){row.image.onload=row.image.onerror=null;row.image.removeAttribute('src');}for(const k of Object.keys(pending))delete pending[k];}
    function visibility(value){visible=value;onVisibility(visible);}
    function clear(){cancel();for(const slot of slots){$(slot).removeAttribute('src');$(slot).hidden=true;delete loaded[slot];}lastKey=null;scope=null;visibility(false);}
    function load(slot,row){if(!row){$(slot).hidden=true;$(slot).removeAttribute('src');delete loaded[slot];return;}
      if(loaded[slot]===row.url){$(slot).hidden=false;return;}
      const image=document.createElement('img'),ticket=epoch,key=lastKey;image.referrerPolicy='no-referrer';pending[slot]={image};
      image.onload=()=>{if(ticket!==epoch||key!==lastKey||pending[slot]?.image!==image)return;delete pending[slot];const old=$(slot);image.id=old.id;image.alt='Slide '+(row.index+1);image.hidden=false;image.onload=image.onerror=null;old.replaceWith(image);loaded[slot]=row.url;if(slot==='image'){$('status').textContent='';visibility(true);}};
      image.onerror=()=>{if(ticket!==epoch||key!==lastKey||pending[slot]?.image!==image)return;delete pending[slot];$('status').textContent='No se pudo cargar el slide preparado.';};
      image.src=row.url;
    }
    function render(value){state=value;const s=state.snapshot,usable=state.status==='ready'&&!!s;
      const nextNotesKey=usable?JSON.stringify([state.scope,s.contentVersion,s.revision,s.prompter]):null;
      if(nextNotesKey!==notesKey||!canRead())hidePrompter();notesKey=nextNotesKey;
      target.tabIndex=canRead()?0:-1;target.setAttribute?.('aria-disabled',String(!canRead()));
      $('language-controls').hidden=!usable||state.kind!=='PARTICIPANT'||!s.availableLanguages.includes('en');
      $('language-es').disabled=!usable||state.pending||s?.language==='es';$('language-en').disabled=!usable||state.pending||s?.language==='en';
      $('operator').hidden=!usable||!['STAGE','SPEAKER'].includes(state.kind);
      if(!usable){cancel();if(state.status==='loading'&&scope===state.scope||['retrying','connecting'].includes(state.accessStatus)){
          $('status').textContent=loaded.image?'Sincronizando contenido…':'Preparando slides…';return;}
        clear();$('status').textContent=state.status==='unavailable'?'Los slides privados todavía no están preparados.':'';return;}
      if(scope&&scope!==state.scope)clear();scope=state.scope;
      const key=JSON.stringify([scope,s.contentVersion,s.revision,s.language,s.slide,s.preview,s.next]);
      if(lastKey!==key){cancel();lastKey=key;load('image',s.slide);load('preview',s.preview||null);load('next',s.next||null);}
      $('fallback').textContent=s.language==='en'&&s.slide.language==='es'?'Este slide se muestra en español.':'';
    }
    $('language-es').addEventListener('click',()=>controller.setLanguage('es'));$('language-en').addEventListener('click',()=>controller.setLanguage('en'));
    document.defaultView?.addEventListener('pagehide',()=>{hidePrompter();clear();});render(state);
    return Object.freeze({render,isVisible:()=>visible,hidePrompter});
  }
  return Object.freeze({createView});
});
