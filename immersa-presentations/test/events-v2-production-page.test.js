const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/events-v2/production-page.js'),'utf8'),html=fs.readFileSync(require.resolve('../events-v2/production.html'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),org=id(1),event=id(2),activity=id(3),stage=id(4),deck=id(5),version=id(6),grant=id(7),token='a'.repeat(43);
function deckButton(h,index=0){return h.walk(h.elements['deck-list']).filter(e=>typeof e.className==='string'&&e.className.split(' ').includes('deck-card'))[index];}
async function settle(){for(let i=0;i<80;i++)await Promise.resolve();}
function page({approved=true,bound=true,endsAt='2099-01-01T00:00:00.000Z',savedConfiguration=null,englishStatus='NOT_UPLOADED',englishUploadError=null,slides=1,media=[],mediaError=false,mediaUploadError=null,images=[],imageError=false,imageUploadError=null,bindingError=null}={}){
 class E{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.value='';this.disabled=false;this.hidden=false;this.dataset={};this.classList={toggle(){}};this.isConnected=true;}
  set innerHTML(_){throw Error('Unsafe HTML');}
  set type(v){if(this.tagName==='SELECT')throw TypeError('select.type is read-only');this.inputType=v;}
  get type(){return this.tagName==='SELECT'?'select-one':this.inputType;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){const off=x=>{x.isConnected=false;x.children.forEach(off);};this.children.forEach(off);this.children=[];this.append(...items);}
  setAttribute(n,v){this[n]=v;}
  addEventListener(n,f){(this.handlers[n]||=[]).push(f);}
  fire(n){for(const f of this.handlers[n]||[])f({preventDefault(){}});}
  get elements(){return Object.fromEntries(walk(this).filter(x=>x.name).map(x=>[x.name,x]));}
  reset(){}
 }
 const walk=e=>[e,...e.children.flatMap(walk)],elements=Object.fromEntries([...html.matchAll(/<(\w+)[^>]*id="([^"]+)"[^>]*>/g)].map(m=>[m[2],Object.assign(new E(m[1]),{id:m[2]})]));
 for(const match of html.matchAll(/<form id="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g))for(const m of match[2].matchAll(/<(input|select)[^>]*name="([^"]+)"[^>]*>/g)){const eid=/id="([^"]+)"/.exec(m[0])?.[1],e=elements[eid]||new E(m[1]);e.name=m[2];e.value=/value="([^"]*)"/.exec(m[0])?.[1]||'';elements[match[1]].append(e);}
 const tabs=['program','decks','operation'].map(v=>Object.assign(new E('button'),{dataset:{view:v}}));
 const zone=new E(),publicButtons=['FREE','PAID'].map(v=>Object.assign(new E('button'),{dataset:{public:v}}));
 const all=()=>[...Object.values(elements).flatMap(walk),...tabs,...publicButtons];
 const document={getElementById:id=>elements[id],createElement:tag=>new E(tag),querySelectorAll:s=>s==='[data-view]'?tabs:s==='[data-public]'?publicButtons:s==='.schedule-zone'?[zone]:all().filter(e=>['BUTTON','INPUT','SELECT','TEXTAREA'].includes(e.tagName))};
 const data={event:{eventId:event,organizationId:org,title:'Own event',timezone:'America/Mexico_City'},stages:[{id:stage,name:'Main'}],activities:[{id:activity,title:'Own activity',stageId:stage,accessLevel:'FREE',status:'SCHEDULED',deckId:bound?deck:null,versionId:bound?version:null,bindingRevision:bound?1:0,liveSessionId:null,scheduledStartsAt:null,scheduledEndsAt:null,durationMinutes:60}],versions:[{deckId:deck,versionId:version,title:'Own Deck',number:1,preparationStatus:'CONVERTED',slideCount:slides,approvalDigest:approved?'b'.repeat(64):null,configurationDigest:savedConfiguration?'c'.repeat(64):null}],endsAt,publicAccess:[]};
 const calls=[],navigations=[];
 const fetch=async(url,options)=>{calls.push({url,...options});let value;
  if(url.endsWith('/organizations'))value=[{id:org,name:'Own org'}];else if(url.endsWith('/events'))value=[{eventId:event,title:'Own event'}];else if(url.endsWith('/production'))value=structuredClone(data);
  else if(url.endsWith('/translations/en/preparation'))value={status:englishStatus,language:'en',slideCount:slides};
  else if(url.endsWith('/translations/en/source')&&options.method==='POST'){if(englishUploadError){englishStatus='FAILED';return{ok:false,json:async()=>({code:englishUploadError})};}englishStatus='CONVERTED';value={status:'CONVERTED',language:'en',slideCount:slides};}
  else if(url.endsWith('/images')&&options.method==='GET'){if(imageError)return{ok:false,json:async()=>({code:'IMAGE_UNAVAILABLE'})};value={images};}
  else if(url.endsWith('/images')&&options.method==='POST'){if(imageUploadError)return{ok:false,json:async()=>({code:imageUploadError})};images.push(imageFixture(40+images.length,options.body.get('name')));value=images.at(-1);}
  else if(url.endsWith('/media')&&options.method==='GET'){if(mediaError)return{ok:false,json:async()=>({code:'MEDIA_UNAVAILABLE'})};value={media};}
  else if(url.endsWith('/media')&&options.method==='POST'){if(mediaUploadError)return{ok:false,json:async()=>({code:mediaUploadError})};media.push({id:id(20+media.length),name:options.body.get('name'),type:options.body.get('category')==='fx'?'video':'audio',status:'READY_PENDING_DECK_CHECK',duration:15,size:1234,...(options.body.get('category')==='fx'?{category:'fx',contentType:'video/webm',fx:require('../public/events-v2/av-fx').parseCue(options.body.get('cue'))}:{})});value=media.at(-1);}
  else if(url.endsWith('/configuration')&&options.method==='GET')value={configuration:savedConfiguration};
  else if(url.endsWith('/configuration')&&options.method==='POST'){data.versions[0].configurationDigest='c'.repeat(64);savedConfiguration=JSON.parse(options.body);if(savedConfiguration.audiovisual){savedConfiguration.av={resources:media.filter(m=>savedConfiguration.audiovisual.assetIds.includes(m.id)),playlists:savedConfiguration.audiovisual.playlists};delete savedConfiguration.audiovisual;}value={};}
  else if(url.endsWith('/grants'))value={grantId:grant,eventId:event,token};
  else if(url.endsWith('/versions')&&options.method==='POST'){const deckId=url.split('/').at(-2),own=data.versions.filter(v=>v.deckId===deckId),number=Math.max(...own.map(v=>v.number))+1,newVersion={deckId,versionId:id(60+data.versions.length),title:own[0].title,number,preparationStatus:null,slideCount:null,approvalDigest:null,configurationDigest:null};data.versions.push(newVersion);value={id:newVersion.versionId,deckId,eventId:event,number,status:'DRAFT'};}
  else if(url.endsWith('/deck-binding')){if(bindingError)return{ok:false,json:async()=>({code:bindingError})};const a=data.activities.find(a=>url.includes('/activities/'+a.id+'/')),input=JSON.parse(options.body);if(input.expectedRevision!==(a.bindingRevision||0))return{ok:false,json:async()=>({code:'BINDING_REVISION_CONFLICT'})};Object.assign(a,options.method==='DELETE'?{deckId:null,versionId:null}:{deckId:input.deckId,versionId:input.versionId});a.bindingRevision=(a.bindingRevision||0)+1;value={};}
  else if(url.endsWith('/schedule')){const input=JSON.parse(options.body);Object.assign(data.activities[0],input,{scheduledEndsAt:new Date(Date.parse(input.scheduledStartsAt)+input.durationMinutes*60000).toISOString()});value={};}
  else if(url.endsWith('/activities'))value={id:activity};else throw Error('Unexpected request '+url);
  return{ok:true,json:async()=>value};};
 const location={pathname:'/events-v2/production',search:'',assign:url=>navigations.push(url)},window={location,ImmersaProductionInteractions:require('../public/events-v2/production-interactions'),ImmersaProductionMedia:require('../public/events-v2/production-media'),ImmersaProductionImages:require('../public/events-v2/production-images'),ImmersaEventFx:require('../public/events-v2/av-fx')};
 vm.runInNewContext(source,{document,window,location,history:{replaceState(){}},fetch,FormData,URLSearchParams,Intl,Date,Error});
 return{elements,tabs,data,calls,navigations,setEnglishStatus:v=>englishStatus=v,setMediaError:v=>mediaError=v,setImageError:v=>imageError=v,setBindingError:v=>bindingError=v,find:(parent,text)=>walk(parent).find(e=>e.textContent===text),walk,zone};
}
test('Production opens Stage in one action with the selected activity and fragment-only grant',async()=>{
 const h=page();await settle();const button=h.find(h.elements['operation-list'],'Abrir Stage');assert.equal(button.disabled,false);button.fire('click');await settle();
 assert.equal(h.navigations.length,1);const url=new URL(h.navigations[0],'https://example.test');assert.equal(url.search,'');const link=require('../public/events-v2/access-client').consumeLink(url,{replaceState(){}});assert.equal(link.token,token);assert.equal(link.activityId,activity);assert.equal(link.binding.grantId,grant);
 const request=h.calls.find(x=>x.url.endsWith('/grants'));assert.deepEqual(JSON.parse(request.body),{kind:'STAGE',purpose:'live',stageId:stage});
});
test('Production explains missing approval, binding and expired window instead of leaving inaccessible controls unexplained',async()=>{
 for(const config of [{approved:false,bound:false},{bound:false},{endsAt:'2000-01-01T00:00:00.000Z'}]){const h=page(config);await settle();assert.equal(h.find(h.elements['operation-list'],'Abrir Stage').disabled,true);const text=h.walk(h.elements['operation-list']).map(e=>e.textContent||'').join(' ');assert.match(text,/Falta preparar|Selecciona una versión aprobada|cierre del evento/);}
});
test('Existing unscheduled activities expose editable start/duration and persist UTC instants',async()=>{
 const h=page();await settle();const form=h.walk(h.elements['activity-list']).find(e=>e.tagName==='FORM');form.elements.scheduledStartsAt.value='2026-11-01T10:00';form.elements.durationMinutes.value='45';form.fire('submit');await settle();const call=h.calls.find(x=>x.url.endsWith('/schedule'));assert.equal(call.method,'PUT');const sent=JSON.parse(call.body);assert.equal(sent.scheduledStartsAt,new Date('2026-11-01T10:00').toISOString());assert.equal(sent.durationMinutes,45);assert.match(h.elements.message.textContent,/Horario actualizado/);
});


test('Production issues a separate rehearsal grant and link without starting a live', async () => {
  const h=page();await settle();const button=h.find(h.elements['operation-list'],'Generar enlace de ensayo');assert.equal(button.disabled,false);
  button.fire('click');await settle();assert.equal(h.navigations.length,0);
  const request=h.calls.find(x=>x.url.endsWith('/grants'));assert.deepEqual(JSON.parse(request.body),{kind:'SPEAKER',purpose:'rehearsal',activityId:activity});
  const anchor=h.find(h.elements['operation-list'],'Entrar al ensayo privado');
  const url=new URL(anchor.href,'https://example.test');const link=require('../public/events-v2/access-client').consumeLink(url,{replaceState(){}});
  assert.equal(link.binding.view,'rehearsal');assert.equal(link.token,token);assert.equal(url.search,'');
});

test('Production prepares Trivia, Evaluation and Free Raffle and seals all controls after save', async () => {
 const h=page({approved:false});await settle();deckButton(h,0).fire('click');await settle();
 const root=h.elements['slide-interactions'];
 for(const label of ['Agregar Trivia','Agregar Evaluación','Agregar Sorteo Libre']){h.find(root,label).fire('click');await settle();}
 const cards=root.children.filter(e=>e.className==='interaction-card');assert.equal(cards.length,3);
 const fill=(label,value,parent)=>{const field=h.find(parent,label).children[0];field.value=value;field.fire(field.tagName==='SELECT'?'change':'input');};
 cards.forEach((card,i)=>{fill('Título',['Trivia propia','Evaluación propia','Sorteo propio'][i],card);if(i===2){fill('Invitación para participar','Participa aquí',card);return;}fill('Pregunta','¿Qué opción?',card);fill('Opciones, una por línea (2 a 6)','Primera\nSegunda',card);fill('Número de la respuesta correcta','2',card);});
 h.find(cards[0],'Agregar pregunta').fire('click');assert.ok(h.find(root,'Pregunta 2'));h.find(root,'Quitar pregunta 2').fire('click');
 h.elements['save-configuration'].fire('click');await settle();
 const call=h.calls.find(x=>x.url.endsWith('/configuration')&&x.method==='POST');assert.ok(call,h.elements.message.textContent);const config=JSON.parse(call.body);
 const normalized=require('../events-v2/deck-configuration').normalizeConfiguration(config,1);assert.equal(normalized.knowledge.length,2);assert.equal(normalized.raffles[0].mode,'free');assert.equal(normalized.knowledge[0].questions[0].correctOptionId,'option-2');assert.equal(normalized.slides[0].knowledgeIds.length,2);assert.equal(normalized.slides[0].raffleIds.length,1);
 assert.equal(h.elements['save-configuration'].disabled,true);assert.ok(h.walk(root).filter(e=>['INPUT','SELECT','TEXTAREA'].includes(e.tagName)).every(e=>e.disabled));assert.equal(h.find(root,'Agregar Trivia'),undefined);
});
test('Production validation prevents submitting incomplete questions and does not activate Games',async()=>{
 const h=page({approved:false});await settle();deckButton(h,0).fire('click');await settle();h.find(h.elements['slide-interactions'],'Agregar Trivia').fire('click');h.elements['save-configuration'].fire('click');await settle();assert.match(h.elements.message.textContent,/título/);assert.equal(h.calls.some(x=>x.method==='POST'&&x.url.endsWith('/configuration')),false);assert.equal(h.find(h.elements['slide-interactions'],'Agregar Juego'),undefined);
});

test('English fields stay hidden without a converted PDF, and upload preserves unsaved Spanish preparation',async()=>{
 const h=page({approved:false});await settle();deckButton(h,0).fire('click');await settle();
 assert.equal(h.elements['notes-en-details'].hidden,true);assert.equal(h.elements['english-settings'].hidden,true);assert.equal(h.elements['preview-english-option'].disabled,true);
 h.find(h.elements['slide-interactions'],'Agregar Trivia').fire('click');assert.equal(h.find(h.elements['slide-interactions'],'Título en inglés'),undefined);
 h.elements['slide-notes'].value='No perder estos apuntes';h.elements['poll-enabled'].checked=true;h.elements['poll-question'].value='Pregunta pendiente';h.elements['poll-options'].value='Una\nDos';
 h.elements['english-pdf'].files=[new Blob(['%PDF-fixture'],{type:'application/pdf'})];h.elements['english-upload-form'].fire('submit');await settle();
 assert.equal(h.elements['slide-notes'].value,'No perder estos apuntes');assert.equal(h.elements['poll-question'].value,'Pregunta pendiente');assert.ok(h.find(h.elements['slide-interactions'],'Trivia'));
 assert.equal(h.elements['notes-en-details'].hidden,false);assert.equal(h.elements['notes-en-details'].open,false);assert.equal(h.elements['english-enabled'].checked,true);assert.equal(h.elements['english-upload-form'].hidden,true);
 const call=h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/translations/en/source'));assert.ok(call.body instanceof FormData);assert.ok(call.body.get('pdf'));assert.equal(h.elements['save-configuration'].disabled,false);
});
test('English notes, Poll and Trivia serialize with stable option IDs and survive slide switches and sealing',async()=>{
 const h=page({approved:false,englishStatus:'CONVERTED',slides:2});await settle();deckButton(h,0).fire('click');await settle();
 const e=h.elements;e['slide-notes'].value='Primero';e['slide-notes-en'].value='First';e['slide-notes-en'].fire('input');assert.match(e['notes-en-summary'].textContent,/✓/);e['poll-enabled'].checked=true;e['poll-question'].value='¿Cuál?';e['poll-options'].value='Una\nDos';e['poll-question-en'].value='Which?';e['poll-options-en'].value='\nTwo';
 h.find(e['slide-interactions'],'Agregar Trivia').fire('click');const card=e['slide-interactions'].children.find(x=>x.className==='interaction-card');const fill=(label,value)=>{const field=h.walk(card).find(e=>e.tagName==='LABEL'&&e.textContent===label).children[0];field.value=value;field.fire('input');};
 fill('Título','Una Trivia');fill('Pregunta','¿Qué?');fill('Opciones, una por línea (2 a 6)','A\nB');fill('Título en inglés','A quiz');fill('Pregunta en inglés','What?');fill('Opciones en inglés, una por línea','Alpha\n');
 e.thumbnails.children[1].fire('click');e['slide-notes'].value='Segundo';e['slide-notes-en'].value='Second';e.thumbnails.children[0].fire('click');assert.equal(e['slide-notes-en'].value,'First');assert.equal(e['notes-en-details'].open,false);
 e['preview-language'].value='en';e['preview-language'].fire('change');assert.match(e['slide-preview'].src,/translations\/en\/slides/);assert.match(e.thumbnails.children[0].children[0].src,/translations\/en/);
 e['presenter-language'].value='en';e['presenter-language'].fire('change');e['save-configuration'].fire('click');await settle();const sent=JSON.parse(h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/configuration')).body);
 assert.deepEqual(sent.language,{englishEnabled:true,presenterLanguage:'en'});assert.equal(sent.slides[0].notes.en,'First');assert.equal(sent.slides[1].notes.en,'Second');assert.equal(sent.polls[0].en.options['option-1'],undefined);assert.equal(sent.polls[0].en.options['option-2'],'Two');assert.equal(sent.knowledge[0].titleEn,'A quiz');assert.equal(sent.knowledge[0].questions[0].en.options['option-1'],'Alpha');
 require('../events-v2/deck-configuration').normalizeConfiguration(sent,2);assert.equal(e['english-enabled'].disabled,true);assert.equal(e['slide-notes-en'].disabled,true);assert.equal(e['english-upload-form'].hidden,true);assert.equal(e['save-configuration'].disabled,true);
});
test('Disabling English keeps prepared translations but forces presenter Spanish and never discards the uploaded PDF',async()=>{
 const h=page({approved:false,englishStatus:'CONVERTED'});await settle();deckButton(h,0).fire('click');await settle();const e=h.elements;e['slide-notes-en'].value='Keep me';e['presenter-language'].value='en';e['presenter-language'].fire('change');e['english-enabled'].checked=false;e['english-enabled'].fire('change');assert.equal(e['presenter-language'].value,'es');assert.equal(e['presenter-language'].disabled,true);assert.equal(e['notes-en-details'].hidden,false);
 e['save-configuration'].fire('click');await settle();const sent=JSON.parse(h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/configuration')).body);assert.deepEqual(sent.language,{englishEnabled:false,presenterLanguage:'es'});assert.equal(sent.slides[0].notes.en,'Keep me');assert.equal(e['english-settings'].hidden,false);
});
test('English processing, malformed status and count mismatch have explicit outcomes without leaking drafts to a new version',async()=>{
 const pending=page({approved:false,englishStatus:'PROCESSING'});await settle();deckButton(pending,0).fire('click');await settle();assert.equal(pending.elements['save-configuration'].disabled,true);pending.setEnglishStatus('CONVERTED');pending.elements['refresh-english'].fire('click');await settle();assert.equal(pending.elements['save-configuration'].disabled,false);
 const malformed=page({approved:false,englishStatus:'unknown'});await settle();deckButton(malformed,0).fire('click');await settle();assert.equal(malformed.elements['save-configuration'].disabled,true);assert.equal(malformed.elements['prepared-editor'].hidden,true);
 const h=page({approved:false,englishUploadError:'LOCALE_SLIDE_COUNT_MISMATCH'});await settle();deckButton(h,0).fire('click');await settle();h.elements['slide-notes'].value='Apuntes propios';h.elements['english-pdf'].files=[new Blob(['%PDF-fixture'])];h.elements['english-upload-form'].fire('submit');await settle();assert.match(h.elements.message.textContent,/mismo número/);assert.equal(h.elements['slide-notes'].value,'Apuntes propios');assert.equal(h.elements['notes-en-details'].hidden,true);assert.equal(h.elements['save-configuration'].disabled,false);
 h.data.versions.push({...h.data.versions[0],versionId:id(12),number:2});h.elements.refresh.fire('click');await settle();deckButton(h,0).fire('click');await settle();assert.equal(h.elements['slide-notes'].value,'');assert.equal(h.elements['slide-notes-en'].value,'');
});

const mediaFixture=(n,type='audio')=>({id:id(n),name:(type==='audio'?'Audio ':'Video ')+n,type,status:'READY_PENDING_DECK_CHECK',duration:20,size:1234});
test('Production uploads privately, preserves notes and incomplete playlist drafts, and requires explicit selection',async()=>{
 const h=page({approved:false,media:[mediaFixture(20)]});await settle();deckButton(h,0).fire('click');await settle();const e=h.elements,root=e['media-library'];
 e['slide-notes'].value='Conservar mis apuntes';h.find(root,'Crear playlist de audio').fire('click');
 e['media-file'].files=[new Blob(['mp3-fixture'],{type:'audio/mpeg'})];e['media-name'].value='Mi audio';e['media-upload-form'].fire('submit');await settle();
 const call=h.calls.find(c=>c.url.endsWith('/media')&&c.method==='POST');assert.ok(call.body instanceof FormData);assert.equal(call.body.get('name'),'Mi audio');assert.ok(call.body.get('media'));assert.equal(e['slide-notes'].value,'Conservar mis apuntes');assert.ok(h.find(root,'Playlist de audio'));assert.equal(h.find(root,'Incluir Mi audio').children[0].checked,false);
 h.find(root,'Quitar playlist').fire('click');e['save-configuration'].fire('click');await settle();const sent=JSON.parse(h.calls.find(c=>c.url.endsWith('/configuration')&&c.method==='POST').body);assert.deepEqual(sent.audiovisual,{assetIds:[],playlists:[]});assert.equal(sent.slides[0].notes.es,'Conservar mis apuntes');
});
test('Production serializes only selected assets in ordered homogeneous playlists and locks after save',async()=>{
 const h=page({approved:false,media:[mediaFixture(20),mediaFixture(21),mediaFixture(22,'video')]});await settle();deckButton(h,0).fire('click');await settle();const e=h.elements,root=e['media-library'];
 const check=label=>{const field=h.find(root,label).children[0];field.checked=true;field.fire('change');};check('Incluir Audio 20');check('Incluir Audio 21');h.find(root,'Crear playlist de audio').fire('click');
 const name=h.find(root,'Nombre de la playlist').children[0];name.value='Entrada';name.fire('input');check('Agregar Audio 20');check('Agregar Audio 21');assert.equal(h.find(root,'Agregar Video 22'),undefined);h.find(root,'Subir Audio 21').fire('click');
 const selection=h.find(root,'Incluir Audio 20').children[0];selection.checked=false;selection.fire('change');assert.match(e.message.textContent,/Quita primero/);assert.equal(h.find(root,'Incluir Audio 20').children[0].checked,true);
 e['save-configuration'].fire('click');await settle();const sent=JSON.parse(h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/configuration')).body);assert.deepEqual(sent.audiovisual.assetIds,[id(20),id(21)]);assert.deepEqual(sent.audiovisual.playlists[0].resourceIds,[id(21),id(20)]);require('../events-v2/deck-configuration').normalizeConfiguration(sent,1);assert.equal(e['media-upload-form'].hidden,true);assert.ok(h.walk(root).filter(x=>x.tagName==='INPUT').every(x=>x.disabled));assert.equal(h.find(root,'Incluir Audio 20').children[0].checked,true);assert.equal(h.find(root,'Nombre de la playlist').children[0].value,'Entrada');
});
test('Production fails closed on unavailable or processing media and refresh restores unsaved notes',async()=>{
 const h=page({approved:false,mediaError:true});await settle();deckButton(h,0).fire('click');await settle();assert.equal(h.elements['save-configuration'].disabled,true);assert.equal(h.elements['refresh-media'].disabled,false);h.elements['slide-notes'].value='Antes de actualizar';h.setMediaError(false);h.elements['refresh-media'].fire('click');await settle();assert.equal(h.elements['save-configuration'].disabled,false);assert.equal(h.elements['slide-notes'].value,'Antes de actualizar');
 const pending=page({approved:false,media:[{id:id(20),status:'PROCESSING'}]});await settle();deckButton(pending,0).fire('click');await settle();assert.equal(pending.elements['save-configuration'].disabled,true);assert.match(pending.elements['media-status'].textContent,/preparación/);
 const invalid=page({approved:false,mediaUploadError:'INVALID_MEDIA'});await settle();deckButton(invalid,0).fire('click');await settle();invalid.elements['media-file'].files=[new Blob(['bad'])];invalid.elements['media-name'].value='Archivo';invalid.elements['media-upload-form'].fire('submit');await settle();assert.match(invalid.elements.message.textContent,/compatible/);assert.equal(invalid.elements['save-configuration'].disabled,false);
});
test('Production restores sealed catalogs without silently selecting the rest of the library',async()=>{
 const config={slides:[{id:'slide-001',notes:{es:'Guardado'}}],polls:[],knowledge:[],raffles:[],games:[],av:{resources:[mediaFixture(20)],playlists:[{id:'intro',name:'Entrada',type:'audio',resourceIds:[id(20)]}]}};
 const h=page({approved:false,savedConfiguration:config,media:[mediaFixture(20),mediaFixture(21)]});await settle();deckButton(h,0).fire('click');await settle();assert.equal(h.find(h.elements['media-library'],'Incluir Audio 20').children[0].checked,true);assert.equal(h.find(h.elements['media-library'],'Incluir Audio 21').children[0].checked,false);assert.equal(h.find(h.elements['media-library'],'Nombre de la playlist').children[0].value,'Entrada');assert.equal(h.elements['save-configuration'].disabled,true);assert.equal(h.elements['media-upload-form'].hidden,true);
});

test('Production FX category requires a TXT, posts its cue without trusting MIME and preserves prepared notes',async()=>{const h=page({approved:false});await settle();deckButton(h,0).fire('click');await settle();const e=h.elements;e['slide-notes'].value='No perder notas';e['media-category'].value='fx';e['media-category'].fire('change');assert.equal(e['media-cue-label'].hidden,false);e['media-file'].files=[new Blob(['webm'])];e['media-name'].value='Transición';e['media-cue'].files=[new File(['03:15\nFPS=30'],'transition.txt')];e['media-upload-form'].fire('submit');await new Promise(r=>setImmediate(r));await settle();const call=h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/media'));assert.ok(call,e.message.textContent);assert.equal(call.body.get('category'),'fx');assert.equal(call.body.get('cue'),'03:15\nFPS=30');assert.equal(e['slide-notes'].value,'No perder notas');assert.ok(h.find(e['media-library'],'Incluir Transición'));});

function imageFixture(n,name='Imagen '+n){return{id:id(n),name,status:'READY_PENDING_DECK_CHECK',type:'image',contentType:'image/png',width:64,height:32,size:1234};}
function fillQuestion(h,root){const fill=(label,value)=>{const f=h.find(root,label).children[0];f.value=value;f.fire('input');};fill('Título','Trivia de imágenes');fill('Pregunta','¿Qué ves?');fill('Opciones, una por línea (2 a 6)','Uno\nDos');}
test('Production image upload keeps drafts and playlists, never auto assigns, and explicit question selection survives navigation and sealing',async()=>{
 const h=page({approved:false,slides:2,englishStatus:'CONVERTED',images:[imageFixture(40)]});await settle();const e=h.elements;deckButton(h,0).fire('click');await settle();
 h.find(e['slide-interactions'],'Agregar Trivia').fire('click');fillQuestion(h,e['slide-interactions']);e['slide-notes'].value='Conservar notas';e['slide-notes-en'].value='Keep notes';h.find(e['media-library'],'Crear playlist de audio').fire('click');
 e['image-file'].files=[new File(['fixture'],'pregunta.png')];e['image-name'].value='Mi diagrama';e['image-upload-form'].fire('submit');await settle();
 const upload=h.calls.find(c=>c.url.endsWith('/images')&&c.method==='POST');assert.ok(upload.body instanceof FormData);assert.equal(upload.body.get('name'),'Mi diagrama');assert.ok(upload.body.get('image'));assert.equal(e['slide-notes'].value,'Conservar notas');assert.equal(e['slide-notes-en'].value,'Keep notes');assert.ok(h.find(e['media-library'],'Playlist de audio'));
 let select=h.find(e['slide-interactions'],'Imagen de la pregunta (opcional)').children[0];assert.equal(select.value,'');select.value=id(41);select.fire('change');
 let preview=h.walk(e['slide-interactions']).find(x=>x.className==='question-image-preview');assert.ok(preview.src.endsWith('/versions/'+version+'/images/'+id(41)+'/content'));assert.equal(preview.referrerPolicy,'no-referrer');
 e.thumbnails.children[1].fire('click');e.thumbnails.children[0].fire('click');assert.equal(h.find(e['slide-interactions'],'Imagen de la pregunta (opcional)').children[0].value,id(41));
 e['refresh-images'].fire('click');await settle();assert.equal(h.find(e['slide-interactions'],'Imagen de la pregunta (opcional)').children[0].value,id(41));assert.equal(h.find(e['slide-interactions'],'Pregunta').children[0].value,'¿Qué ves?');
 h.find(e['media-library'],'Quitar playlist').fire('click');e['save-configuration'].fire('click');await settle();
 const sent=JSON.parse(h.calls.find(c=>c.url.endsWith('/configuration')&&c.method==='POST').body);assert.equal(sent.knowledge[0].questions[0].imageAssetId,id(41));assert.equal(sent.images,undefined);assert.equal(sent.slides[0].notes.en,'Keep notes');assert.deepEqual(sent.audiovisual.assetIds,[]);require('../events-v2/deck-configuration').normalizeConfiguration(sent,2);
 assert.equal(e['image-upload-form'].hidden,true);assert.equal(h.find(e['slide-interactions'],'Imagen de la pregunta (opcional)').children[0].disabled,true);assert.ok(h.walk(e['slide-interactions']).some(x=>x.className==='question-image-preview'));
});
test('Removing a question image affects only the draft, never deletes or silently selects library files',async()=>{
 const h=page({approved:false,images:[imageFixture(40)]});await settle();deckButton(h,0).fire('click');await settle();const root=h.elements['slide-interactions'];h.find(root,'Agregar Evaluación').fire('click');fillQuestion(h,root);
 let field=h.find(root,'Imagen de la pregunta (opcional)').children[0];field.value=id(40);field.fire('change');field=h.find(root,'Imagen de la pregunta (opcional)').children[0];field.value='';field.fire('change');assert.equal(h.walk(root).some(x=>x.className==='question-image-preview'),false);
 h.elements['save-configuration'].fire('click');await settle();const sent=JSON.parse(h.calls.find(c=>c.url.endsWith('/configuration')&&c.method==='POST').body);assert.equal(Object.hasOwn(sent.knowledge[0].questions[0],'imageAssetId'),false);assert.equal(h.calls.some(c=>c.method==='DELETE'),false);
});
test('Image library failures and pending metadata block save and explicit refresh recovers without losing drafts',async()=>{
 const h=page({approved:false,imageError:true});await settle();const e=h.elements;deckButton(h,0).fire('click');await settle();assert.equal(e['save-configuration'].disabled,true);assert.equal(e['refresh-images'].disabled,false);e['slide-notes'].value='Conservar';h.setImageError(false);e['refresh-images'].fire('click');await settle();assert.equal(e['save-configuration'].disabled,false);assert.equal(e['slide-notes'].value,'Conservar');
 for(const images of [[{id:id(40),status:'PROCESSING'}],[{...imageFixture(40),contentType:'image/svg+xml'}]]){const h=page({approved:false,images});await settle();deckButton(h,0).fire('click');await settle();assert.equal(h.elements['save-configuration'].disabled,true);}
 const failed=page({approved:false,images:[{id:id(40),status:'FAILED'}]});await settle();deckButton(failed,0).fire('click');await settle();failed.find(failed.elements['slide-interactions'],'Agregar Trivia').fire('click');assert.equal(failed.find(failed.elements['slide-interactions'],'Imagen de la pregunta (opcional)').children[0].children.length,1);
});
test('Missing referenced images cannot silently disappear during a library refresh; invalid uploads are not retried',async()=>{
 const images=[imageFixture(40)],h=page({approved:false,images,imageUploadError:'INVALID_IMAGE'});await settle();const e=h.elements;deckButton(h,0).fire('click');await settle();const root=e['slide-interactions'];h.find(root,'Agregar Trivia').fire('click');fillQuestion(h,root);const select=h.find(root,'Imagen de la pregunta (opcional)').children[0];select.value=id(40);select.fire('change');images.splice(0);e['refresh-images'].fire('click');await settle();
 assert.equal(h.find(root,'Imagen de la pregunta (opcional)').children[0].value,id(40));e['save-configuration'].fire('click');await settle();assert.match(e.message.textContent,/imagen.*no está lista/);assert.equal(h.calls.some(c=>c.method==='POST'&&c.url.endsWith('/configuration')),false);
 e['image-file'].files=[new File(['bad'],'bad.svg')];e['image-name'].value='No válido';e['image-upload-form'].fire('submit');await settle();assert.match(e.message.textContent,/estática PNG/);assert.equal(h.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/images')).length,1);assert.equal(h.find(root,'Pregunta').children[0].value,'¿Qué ves?');
});

const nextActivity=(h,n,extra={})=>({...h.data.activities[0],id:id(n),title:'Actividad '+n,deckId:null,versionId:null,bindingRevision:0,...extra});
const versionCopy=(h,n,number,extra={})=>({...h.data.versions[0],versionId:id(n),number,...extra});
test('Production groups versions by Deck, sorts latest first, searches safely and never switches existing bindings implicitly',async()=>{
 const h=page();await settle();h.data.versions.push(versionCopy(h,12,2,{approvalDigest:null,configurationDigest:null}),versionCopy(h,13,3,{preparationStatus:null,slideCount:null,approvalDigest:null}),versionCopy(h,14,1,{deckId:id(15),title:'Otro <Deck>'}));h.elements.refresh.fire('click');await settle();
 const groups=h.elements['deck-list'].children;assert.equal(groups.length,2);const cards=h.walk(groups[0]).filter(e=>e.className?.startsWith('deck-card'));assert.equal(cards.length,3);assert.equal(cards[0].children[0].textContent,'Versión 3');assert.equal(cards[2].children[0].textContent,'Versión 1');assert.ok(h.find(cards[2],'Asociada a 1 actividad'));
 const select=h.walk(h.elements['operation-list']).find(e=>e.tagName==='SELECT');assert.equal(select.value,version);assert.equal(h.calls.some(c=>c.method==='PUT'&&c.url.endsWith('/deck-binding')),false);
 h.elements['deck-search'].value='OTRO';h.elements['deck-search'].fire('input');assert.equal(h.elements['deck-list'].children.length,1);assert.ok(h.find(h.elements['deck-list'],'Otro <Deck>'));h.elements['deck-search'].value='No existe';h.elements['deck-search'].fire('input');assert.ok(h.find(h.elements['deck-list'],'No hay Decks con ese nombre.'));
});
test('Approved version can be reused explicitly by another activity and detached without changing content or other associations',async()=>{
 const config={slides:[{id:'slide-001',notes:{es:'Guardado'}}],polls:[],knowledge:[],raffles:[],games:[]},h=page({savedConfiguration:config});await settle();h.data.activities.push(nextActivity(h,31));h.elements.refresh.fire('click');await settle();deckButton(h).fire('click');await settle();const panel=h.elements['version-management'],select=h.find(panel,'Actividad para esta versión').children[0];assert.equal(select.value,'');select.value=id(31);h.find(panel,'Usar versión en actividad').fire('click');await settle();
 let calls=h.calls.filter(c=>c.url.endsWith('/deck-binding'));assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].body),{deckId:deck,versionId:version,expectedRevision:0});assert.ok(calls[0].url.includes('/activities/'+id(31)+'/'));assert.equal(h.data.activities[0].versionId,version);assert.equal(h.data.activities[1].versionId,version);assert.ok(h.find(panel,'Own activity · Pendiente'));assert.ok(h.find(panel,'Actividad 31 · Pendiente'));assert.ok(h.find(deckButton(h),'Asociada a 2 actividades'));
 h.find(panel,'Retirar de Actividad 31').fire('click');await settle();calls=h.calls.filter(c=>c.url.endsWith('/deck-binding'));assert.equal(calls[1].method,'DELETE');assert.deepEqual(JSON.parse(calls[1].body),{expectedRevision:1});assert.equal(h.data.activities[1].versionId,null);assert.equal(h.data.activities[0].versionId,version);assert.equal(h.calls.some(c=>c.method==='POST'&&(c.url.endsWith('/source')||c.url.endsWith('/configuration')||c.url.endsWith('/deck-check'))),false);assert.equal(h.data.versions[0].configurationDigest,'c'.repeat(64));assert.match(h.elements.message.textContent,/sigue disponible/);
});
test('Version assignment lists only editable activities, labels replacements and refuses unapproved versions',async()=>{
 const h=page();await settle();h.data.versions.push(versionCopy(h,12,2));h.data.activities.push(nextActivity(h,31,{liveSessionId:id(41)}),nextActivity(h,32,{status:'CANCELLED'}),nextActivity(h,33,{deckId:deck,versionId:id(12),bindingRevision:3}));h.elements.refresh.fire('click');await settle();deckButton(h,1).fire('click');await settle();const panel=h.elements['version-management'],options=h.find(panel,'Actividad para esta versión').children[0].children;assert.deepEqual(options.map(x=>x.value),['',id(33)]);assert.match(options[1].textContent,/reemplaza Own Deck v2/);
 h.data.versions[0].approvalDigest=null;h.elements.refresh.fire('click');await settle();assert.equal(h.find(panel,'Usar versión en actividad'),undefined);assert.ok(h.find(panel,'Aprueba esta versión con Deck Check para poder elegirla aquí.'));
});
test('Conflicting binding refreshes metadata and requires another explicit choice without retrying or losing editor fields',async()=>{
 const h=page({bindingError:'BINDING_REVISION_CONFLICT'});await settle();h.data.activities.push(nextActivity(h,31));h.elements.refresh.fire('click');await settle();deckButton(h).fire('click');await settle();h.elements['slide-notes'].value='No perder apuntes';const panel=h.elements['version-management'];h.find(panel,'Actividad para esta versión').children[0].value=id(31);h.find(panel,'Usar versión en actividad').fire('click');await settle();assert.equal(h.calls.filter(c=>c.url.endsWith('/deck-binding')).length,1);assert.match(h.elements.message.textContent,/asociación cambió.*Ya actualizamos/);assert.equal(h.elements['slide-notes'].value,'No perder apuntes');assert.equal(h.find(panel,'Actividad para esta versión').children[0].value,'');assert.equal(h.data.activities[1].versionId,null);
});
test('Creating an empty version uses its returned ID and does not copy approval, move activities or reupload content',async()=>{
 const h=page();await settle();const before=structuredClone(h.data.activities);h.find(h.elements['deck-list'],'Crear versión vacía de Own Deck').fire('click');await settle();const created=h.data.versions.find(v=>v.number===2);assert.ok(created);assert.deepEqual(h.data.activities,before);assert.equal(created.approvalDigest,null);assert.equal(created.configurationDigest,null);assert.equal(created.preparationStatus,null);assert.equal(h.elements['prepared-editor'].hidden,true);assert.equal(h.elements['upload-form'].hidden,false);assert.match(h.elements['deck-title'].textContent,/versión 2/);assert.match(h.elements.message.textContent,/creada vacía/);assert.equal(h.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/versions')).length,1);assert.equal(h.calls.some(c=>c.url.endsWith('/deck-binding')&&c.method!=='GET'),false);
});
test('Operation and version usage prevent assignment/removal while the activity is live or not scheduled',async()=>{
 for(const state of [{liveSessionId:id(41)},{status:'CANCELLED'}]){const h=page();await settle();Object.assign(h.data.activities[0],state);h.elements.refresh.fire('click');await settle();const root=h.elements['operation-list'];assert.equal(h.walk(root).find(e=>e.tagName==='SELECT').disabled,true);assert.equal(h.find(root,'Asociar Deck').disabled,true);assert.equal(h.find(root,'Retirar Deck de Own activity').disabled,true);h.find(root,'Retirar Deck de Own activity').fire('click');await settle();assert.equal(h.calls.some(c=>c.url.endsWith('/deck-binding')),false);deckButton(h).fire('click');await settle();assert.equal(h.find(h.elements['version-management'],'Retirar de Own activity').disabled,true);}
});
