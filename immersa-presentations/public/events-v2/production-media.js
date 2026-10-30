(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaProductionMedia=factory();})(typeof window==='undefined'?this:window,function(){
 'use strict';
 const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
 const ready=m=>m.status==='READY_PENDING_DECK_CHECK';
 function library(rows){
  if(!Array.isArray(rows)||rows.length>200)throw Error('No se pudo verificar la biblioteca audiovisual.');
  const seen=new Set();return rows.map(m=>{
   if(!m||!id(m.id)||seen.has(m.id)||!['READY_PENDING_DECK_CHECK','PROCESSING','FAILED'].includes(m.status))throw Error('No se pudo verificar la biblioteca audiovisual.');seen.add(m.id);
   if(ready(m)&&(typeof m.name!=='string'||!m.name.trim()||m.name.length>120||!['audio','video'].includes(m.type)||!Number.isFinite(m.duration)||m.duration<=0))throw Error('No se pudo verificar un recurso audiovisual.');
   return {...m};
  });
 }
 function create(rows,configuration=null){
  const state={resources:library(rows),selected:[],playlists:[]};
  if(configuration?.av){state.selected=configuration.av.resources.map(m=>m.id);state.playlists=configuration.av.playlists.map(p=>({...p,resourceIds:[...p.resourceIds]}));}
  serialize(state);return state;
 }
 function refresh(state,rows){const next=library(rows);serialize({...state,resources:next,playlists:[]});if(state.playlists.some(p=>p.resourceIds.some(asset=>!next.some(m=>m.id===asset&&ready(m)&&m.type===p.type))))throw Error('No se pudo verificar un recurso de las playlists.');state.resources=next;}
 function serialize(state){
  const assetIds=[...state.selected];
  if(new Set(assetIds).size!==assetIds.length||assetIds.some(asset=>!state.resources.some(m=>m.id===asset&&ready(m))))throw Error('Un recurso seleccionado no está listo. Actualiza la biblioteca antes de guardar.');
  if(state.playlists.length>100)throw Error('Puedes preparar hasta 100 playlists.');
  const seen=new Set(),playlists=state.playlists.map(p=>{
   const name=typeof p.name==='string'?p.name.trim():'';
   if(!/^[a-zA-Z0-9_-]{1,120}$/.test(p.id)||seen.has(p.id)||!name||name.length>120||!['audio','video'].includes(p.type)||!Array.isArray(p.resourceIds)||!p.resourceIds.length||p.resourceIds.length>200||new Set(p.resourceIds).size!==p.resourceIds.length)throw Error('Cada playlist necesita nombre y al menos un recurso del mismo tipo.');seen.add(p.id);
   if(p.resourceIds.some(asset=>!assetIds.includes(asset)||!state.resources.some(m=>m.id===asset&&m.type===p.type)))throw Error('Las playlists sólo admiten recursos seleccionados de su mismo tipo.');
   return{id:p.id,name,type:p.type,resourceIds:[...p.resourceIds]};
  });return{assetIds,playlists};
 }
 function select(state,asset,enabled){
  if(!state.resources.some(m=>m.id===asset&&ready(m)))throw Error('El recurso todavía no está listo.');
  if(!enabled&&state.playlists.some(p=>p.resourceIds.includes(asset)))throw Error('Quita primero este recurso de sus playlists.');
  if(enabled&&!state.selected.includes(asset))state.selected.push(asset);else if(!enabled)state.selected=state.selected.filter(x=>x!==asset);
 }
 function addPlaylist(state,type){if(!['audio','video'].includes(type)||state.playlists.length>=100)throw Error('No se puede agregar otra playlist.');let n=1;while(state.playlists.some(p=>p.id==='playlist-'+n))n++;const p={id:'playlist-'+n,name:'',type,resourceIds:[]};state.playlists.push(p);return p;}
 function duration(seconds){const total=Math.round(seconds);return Math.floor(total/60)+':'+String(total%60).padStart(2,'0');}
 function mount(document,container,state,{locked=false,isBusy=()=>false,onError=()=>{},contentUrl}={}){
  const controls=[],disabled=()=>locked||isBusy();
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const guard=fn=>()=>{if(disabled())return;try{fn();}catch(e){onError(e.message);render();}};
  function input(labelText,value,parent,change,type='text'){const label=make('label',labelText),field=make('input');field.type=type;if(type==='checkbox')field.checked=value;else field.value=value;field.maxLength=120;field.disabled=disabled();controls.push(field);field.addEventListener(type==='checkbox'?'change':'input',guard(()=>change(type==='checkbox'?field.checked:field.value)));label.append(field);parent.append(label);if(type==='checkbox')label.className='checkbox';return field;}
  function button(parent,text,fn,extraDisabled=false){const b=make('button',text,'secondary');b.type='button';b.disabled=disabled()||extraDisabled;b.dataset.boundary=String(extraDisabled);controls.push(b);b.addEventListener('click',guard(fn));parent.append(b);return b;}
  function render(){
   controls.length=0;for(const preview of container.querySelectorAll?.('audio,video')||[])preview.pause();container.replaceChildren();const summary=make('p',state.selected.length+' de '+state.resources.filter(ready).length+' recursos seleccionados · '+state.playlists.length+' playlists','hint');container.append(summary);
   if(!state.resources.length)container.append(make('p','Todavía no has subido audio o video a esta versión.','hint'));
   const resources=make('div',undefined,'media-grid');container.append(resources);
   for(const m of state.resources){const card=make('article',undefined,'media-card');resources.append(card);if(!ready(m)){card.append(make('strong',m.status==='PROCESSING'?'Preparando recurso…':'Carga fallida'),make('p',m.status==='PROCESSING'?'Actualiza la biblioteca al terminar.':'Este archivo no se puede seleccionar. Puedes subir otro archivo.','hint'));continue;}
    input('Incluir '+m.name,state.selected.includes(m.id),card,checked=>{select(state,m.id,checked);render();},'checkbox');card.append(make('p',(m.type==='audio'?'Audio':'Video')+' · '+duration(m.duration)+' · '+(m.size/1048576).toFixed(1)+' MB','hint'));
    if(contentUrl){const details=make('details',undefined,'media-preview'),summary=make('summary','Vista previa de '+m.name),player=make(m.type);player.controls=true;player.preload='none';player.src=contentUrl(m.id);if(m.type==='video')player.playsInline=true;details.append(summary,player);details.addEventListener('toggle',()=>{if(!details.open)player.pause?.();});card.append(details);}
   }
   const lists=make('div',undefined,'playlist-list');container.append(lists);
   for(const p of state.playlists){const card=make('article',undefined,'playlist-card');lists.append(card);card.append(make('h4','Playlist de '+(p.type==='audio'?'audio':'video')));input('Nombre de la playlist',p.name,card,value=>{p.name=value;});
    const available=state.resources.filter(m=>ready(m)&&m.type===p.type&&state.selected.includes(m.id));if(!available.length)card.append(make('p','Selecciona primero recursos de '+(p.type==='audio'?'audio':'video')+' en la biblioteca.','hint'));
    for(const m of available)input('Agregar '+m.name,p.resourceIds.includes(m.id),card,checked=>{p.resourceIds=checked?[...p.resourceIds,m.id]:p.resourceIds.filter(x=>x!==m.id);render();},'checkbox');
    const order=make('ol',undefined,'playlist-order');card.append(order);p.resourceIds.forEach((asset,index)=>{const item=make('li'),name=state.resources.find(m=>m.id===asset)?.name||'Recurso no disponible';item.append(make('span',name));button(item,'Subir '+name,()=>{[p.resourceIds[index-1],p.resourceIds[index]]=[p.resourceIds[index],p.resourceIds[index-1]];render();},index===0);button(item,'Bajar '+name,()=>{[p.resourceIds[index+1],p.resourceIds[index]]=[p.resourceIds[index],p.resourceIds[index+1]];render();},index===p.resourceIds.length-1);order.append(item);});
    button(card,'Quitar playlist',()=>{state.playlists=state.playlists.filter(x=>x!==p);render();});
   }
   if(!locked){const actions=make('div',undefined,'inline-actions');container.append(actions);for(const type of ['audio','video'])button(actions,'Crear playlist de '+type,()=>{addPlaylist(state,type);render();});}
  }
  render();return{sync(){for(const field of controls)field.disabled=disabled()||field.tagName==='BUTTON'&&field.dataset.boundary==='true';},render};
 }
 return{create,refresh,serialize,select,addPlaylist,mount};
});
