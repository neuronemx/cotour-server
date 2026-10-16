(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaEventSlidesPage=factory();})(typeof window==='object'?window:this,function(){
  'use strict';
  function createView({document,controller,onVisibility=()=>{}}){
    const $=id=>document.getElementById('slides-'+id), slots=['image','preview','next'], loaded={},pending={};
    let state=controller.getState(),scope=null,epoch=0,visible=false,lastKey=null;
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
    document.defaultView?.addEventListener('pagehide',clear);render(state);
    return Object.freeze({render,isVisible:()=>visible});
  }
  return Object.freeze({createView});
});
