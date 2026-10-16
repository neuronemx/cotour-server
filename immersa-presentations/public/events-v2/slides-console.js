(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaEventSlidesConsole=factory();})(typeof window==='object'?window:this,function(){
  'use strict';
  const integer=v=>Number.isSafeInteger(v)&&v>=0, languages=['es','en'];
  const check=v=>{if(!v)throw Object.assign(new Error('INVALID_SLIDES_RESPONSE'),{code:'INVALID_SLIDES_RESPONSE'});};
  function normalize(value,context,liveId){
    check(value&&value.eventId===context.eventId&&value.liveSessionId===liveId&&integer(value.revision)&&/^[a-f0-9]{64}$/.test(value.contentVersion)
      && Array.isArray(value.availableLanguages)&&['es','es,en'].includes(value.availableLanguages.join(','))&&value.availableLanguages.includes(value.language));
    const prefix='/api/events-v2/live/'+context.eventId+'/'+liveId+'/'+context.grantId+'/slides/'+value.contentVersion+'/';
    function image(row,variant){check(row&&integer(row.index)&&row.index<100000&&value.availableLanguages.includes(row.language)
      && row.url===prefix+row.language+'/'+row.index+'/'+variant);return Object.freeze({index:row.index,language:row.language,url:row.url});}
    const out={eventId:value.eventId,liveSessionId:liveId,revision:value.revision,contentVersion:value.contentVersion,
      availableLanguages:Object.freeze([...value.availableLanguages]),language:value.language,slide:image(value.slide,'full')};
    if(['STAGE','SPEAKER'].includes(context.kind)){out.preview=image(value.preview,'thumb');out.next=value.next===null?null:image(value.next,'thumb');check(!out.next||out.next.index===out.preview.index+1);
      if(Object.hasOwn(value,'prompter')){
        const notes=(row,image)=>{if(!image){check(row===null);return null;}check(row&&row.index===image.index&&(row.language===image.language||image.language==='en'&&row.language==='es')&&typeof row.text==='string'&&row.text.length<=8000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(row.text));return Object.freeze({index:row.index,language:row.language,text:row.text});};
        check(value.prompter&&typeof value.prompter==='object');out.prompter=Object.freeze({current:notes(value.prompter.current,out.preview),next:notes(value.prompter.next,out.next)});
      }
    }
    check(['STAGE','SPEAKER','PLAYER','PARTICIPANT'].includes(context.kind));return Object.freeze(out);
  }
  function createController({access,onState=()=>{}}){
    let grant=null,generation=-1,liveId=null,lastLive=null,revision=-1,sequence=0,snapshot=null,pending=false,preferred='es',accessStatus='idle';
    let state=Object.freeze({status:'waiting',kind:null,snapshot:null,pending:false,code:null,accessStatus});
    function publish(status,code=null){state=Object.freeze({status,kind:grant?.context.kind||null,snapshot,pending,code,accessStatus,
      scope:grant&&liveId?grant.context.eventId+':'+grant.context.grantId+':'+liveId:null,expectedRevision:revision});onState(state);}
    function reset(){sequence++;liveId=null;revision=-1;snapshot=null;pending=false;publish('waiting');}
    function updateAccess(value){accessStatus=value.status;if(value.status!=='ready'){grant=null;generation=-1;if(['denied','closed'].includes(value.status)){preferred='es';lastLive=null;}reset();return;}
      if(generation!==value.generation){grant=value;generation=value.generation;reset();}else grant=value;}
    async function refresh(){if(!grant||!liveId)return false;const version=generation,ticket=++sequence,scope=liveId;pending=true;publish('loading');
      try{const result=await access.command('events:slides:snapshot',{language:preferred});if(!grant||version!==generation||ticket!==sequence||scope!==liveId)return false;
        if(!result.ok)throw Object.assign(new Error(result.code),{code:result.code});const view=normalize(result.snapshot,grant.context,liveId);
        check(view.revision>=revision&&(!snapshot||view.revision>=snapshot.revision&&view.contentVersion===snapshot.contentVersion));
        snapshot=view;preferred=view.language;pending=false;publish('ready');return true;
      }catch(error){if(!grant||version!==generation||ticket!==sequence)return false;snapshot=null;pending=false;publish('unavailable',error.code||'SLIDES_CONTENT_NOT_PREPARED');return false;}}
    function updateLive(value){if(!grant||value.status!=='live'||!value.snapshot||value.snapshot.eventId!==grant.context.eventId){if(liveId)reset();return;}
      const next=value.snapshot;if(liveId!==next.liveSessionId){reset();liveId=next.liveSessionId;if(lastLive!==liveId)preferred='es';lastLive=liveId;revision=next.revision;refresh();}
      else if(next.revision>revision){revision=next.revision;refresh();}}
    function setLanguage(language){if(!grant||state.kind!=='PARTICIPANT'||!snapshot||!snapshot.availableLanguages.includes(language))return Promise.resolve(false);preferred=language;return refresh();}
    return Object.freeze({updateAccess,updateLive,refresh,setLanguage,getState:()=>state,getLanguage:()=>snapshot?.language||'es'});
  }
  function translated(source,english,language){return language==='en'&&typeof english==='string'&&english.trim()?english:source||'';}
  return Object.freeze({createController,normalize,translated});
});
