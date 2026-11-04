(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ImmersaProductionImages=factory();})(typeof window==='undefined'?this:window,function(){
 'use strict';
 const ready=m=>m.status==='READY_PENDING_DECK_CHECK';
 function library(rows){
  const fail=()=>{throw Error('No se pudo verificar la biblioteca de imágenes.');};
  if(!Array.isArray(rows)||rows.length>200)fail();const seen=new Set();
  return rows.map(m=>{if(!m||typeof m.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(m.id)||seen.has(m.id)||!['READY_PENDING_DECK_CHECK','PROCESSING','FAILED'].includes(m.status))fail();seen.add(m.id);
   if(ready(m)&&(m.type!=='image'||!['image/png','image/jpeg','image/webp'].includes(m.contentType)||typeof m.name!=='string'||!m.name.trim()||m.name.length>120||!Number.isSafeInteger(m.size)||m.size<1||m.size>5*1024*1024||!Number.isSafeInteger(m.width)||m.width<1||m.width>4096||!Number.isSafeInteger(m.height)||m.height<1||m.height>4096))fail();
   return {...m};
  });
 }
 function mount(document,container,rows,{contentUrl}={}){
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  container.replaceChildren();if(!rows.length){container.append(make('p','Todavía no has subido imágenes a esta versión.','hint'));return;}
  const grid=make('div',undefined,'image-library-grid');container.append(grid);
  for(const m of rows){const card=make('article',undefined,'image-library-card');grid.append(card);if(!ready(m)){card.append(make('strong',m.status==='PROCESSING'?'Preparando imagen…':'Carga fallida'),make('p',m.status==='PROCESSING'?'Actualiza su estado al terminar.':'Este archivo no se puede usar. Puedes subir otra imagen.','hint'));continue;}
   card.append(make('strong',m.name),make('p',m.width+' × '+m.height+' px · '+(m.size/1048576).toFixed(2)+' MB','hint'));
   if(contentUrl){const details=make('details'),img=make('img');img.alt=m.name;img.loading='lazy';img.referrerPolicy='no-referrer';img.src=contentUrl(m.id);details.append(make('summary','Vista previa de '+m.name),img);card.append(details);}
  }
 }
 return{library,mount};
});
