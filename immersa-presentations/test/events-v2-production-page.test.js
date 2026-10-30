const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/events-v2/production-page.js'),'utf8'),html=fs.readFileSync(require.resolve('../events-v2/production.html'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),org=id(1),event=id(2),activity=id(3),stage=id(4),deck=id(5),version=id(6),grant=id(7),token='a'.repeat(43);
async function settle(){for(let i=0;i<80;i++)await Promise.resolve();}
function page({approved=true,bound=true,endsAt='2099-01-01T00:00:00.000Z',savedConfiguration=null,englishStatus='NOT_UPLOADED',englishUploadError=null,slides=1}={}){
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
 const data={event:{eventId:event,organizationId:org,title:'Own event',timezone:'America/Mexico_City'},stages:[{id:stage,name:'Main'}],activities:[{id:activity,title:'Own activity',stageId:stage,accessLevel:'FREE',status:'SCHEDULED',versionId:bound?version:null,bindingRevision:bound?1:0,liveSessionId:null,scheduledStartsAt:null,scheduledEndsAt:null,durationMinutes:60}],versions:[{deckId:deck,versionId:version,title:'Own Deck',number:1,preparationStatus:'CONVERTED',slideCount:slides,approvalDigest:approved?'b'.repeat(64):null,configurationDigest:savedConfiguration?'c'.repeat(64):null}],endsAt,publicAccess:[]};
 const calls=[],navigations=[];
 const fetch=async(url,options)=>{calls.push({url,...options});let value;
  if(url.endsWith('/organizations'))value=[{id:org,name:'Own org'}];else if(url.endsWith('/events'))value=[{eventId:event,title:'Own event'}];else if(url.endsWith('/production'))value=structuredClone(data);
  else if(url.endsWith('/translations/en/preparation'))value={status:englishStatus,language:'en',slideCount:slides};
  else if(url.endsWith('/translations/en/source')&&options.method==='POST'){if(englishUploadError){englishStatus='FAILED';return{ok:false,json:async()=>({code:englishUploadError})};}englishStatus='CONVERTED';value={status:'CONVERTED',language:'en',slideCount:slides};}
  else if(url.endsWith('/configuration')&&options.method==='GET')value={configuration:savedConfiguration};
  else if(url.endsWith('/configuration')&&options.method==='POST'){data.versions[0].configurationDigest='c'.repeat(64);savedConfiguration=JSON.parse(options.body);value={};}
  else if(url.endsWith('/grants'))value={grantId:grant,eventId:event,token};
  else if(url.endsWith('/deck-binding')){data.activities[0].versionId=version;value={};}
  else if(url.endsWith('/schedule')){const input=JSON.parse(options.body);Object.assign(data.activities[0],input,{scheduledEndsAt:new Date(Date.parse(input.scheduledStartsAt)+input.durationMinutes*60000).toISOString()});value={};}
  else if(url.endsWith('/activities'))value={id:activity};else throw Error('Unexpected request '+url);
  return{ok:true,json:async()=>value};};
 const location={pathname:'/events-v2/production',search:'',assign:url=>navigations.push(url)},window={location,ImmersaProductionInteractions:require('../public/events-v2/production-interactions')};
 vm.runInNewContext(source,{document,window,location,history:{replaceState(){}},fetch,FormData,URLSearchParams,Intl,Date,Error});
 return{elements,tabs,data,calls,navigations,setEnglishStatus:v=>englishStatus=v,find:(parent,text)=>walk(parent).find(e=>e.textContent===text),walk,zone};
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
 const h=page({approved:false});await settle();h.elements['deck-list'].children[0].fire('click');await settle();
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
 const h=page({approved:false});await settle();h.elements['deck-list'].children[0].fire('click');await settle();h.find(h.elements['slide-interactions'],'Agregar Trivia').fire('click');h.elements['save-configuration'].fire('click');await settle();assert.match(h.elements.message.textContent,/título/);assert.equal(h.calls.some(x=>x.method==='POST'&&x.url.endsWith('/configuration')),false);assert.equal(h.find(h.elements['slide-interactions'],'Agregar Juego'),undefined);
});

test('English fields stay hidden without a converted PDF, and upload preserves unsaved Spanish preparation',async()=>{
 const h=page({approved:false});await settle();h.elements['deck-list'].children[0].fire('click');await settle();
 assert.equal(h.elements['notes-en-details'].hidden,true);assert.equal(h.elements['english-settings'].hidden,true);assert.equal(h.elements['preview-english-option'].disabled,true);
 h.find(h.elements['slide-interactions'],'Agregar Trivia').fire('click');assert.equal(h.find(h.elements['slide-interactions'],'Título en inglés'),undefined);
 h.elements['slide-notes'].value='No perder estos apuntes';h.elements['poll-enabled'].checked=true;h.elements['poll-question'].value='Pregunta pendiente';h.elements['poll-options'].value='Una\nDos';
 h.elements['english-pdf'].files=[new Blob(['%PDF-fixture'],{type:'application/pdf'})];h.elements['english-upload-form'].fire('submit');await settle();
 assert.equal(h.elements['slide-notes'].value,'No perder estos apuntes');assert.equal(h.elements['poll-question'].value,'Pregunta pendiente');assert.ok(h.find(h.elements['slide-interactions'],'Trivia'));
 assert.equal(h.elements['notes-en-details'].hidden,false);assert.equal(h.elements['notes-en-details'].open,false);assert.equal(h.elements['english-enabled'].checked,true);assert.equal(h.elements['english-upload-form'].hidden,true);
 const call=h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/translations/en/source'));assert.ok(call.body instanceof FormData);assert.ok(call.body.get('pdf'));assert.equal(h.elements['save-configuration'].disabled,false);
});
test('English notes, Poll and Trivia serialize with stable option IDs and survive slide switches and sealing',async()=>{
 const h=page({approved:false,englishStatus:'CONVERTED',slides:2});await settle();h.elements['deck-list'].children[0].fire('click');await settle();
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
 const h=page({approved:false,englishStatus:'CONVERTED'});await settle();h.elements['deck-list'].children[0].fire('click');await settle();const e=h.elements;e['slide-notes-en'].value='Keep me';e['presenter-language'].value='en';e['presenter-language'].fire('change');e['english-enabled'].checked=false;e['english-enabled'].fire('change');assert.equal(e['presenter-language'].value,'es');assert.equal(e['presenter-language'].disabled,true);assert.equal(e['notes-en-details'].hidden,false);
 e['save-configuration'].fire('click');await settle();const sent=JSON.parse(h.calls.find(c=>c.method==='POST'&&c.url.endsWith('/configuration')).body);assert.deepEqual(sent.language,{englishEnabled:false,presenterLanguage:'es'});assert.equal(sent.slides[0].notes.en,'Keep me');assert.equal(e['english-settings'].hidden,false);
});
test('English processing, malformed status and count mismatch have explicit outcomes without leaking drafts to a new version',async()=>{
 const pending=page({approved:false,englishStatus:'PROCESSING'});await settle();pending.elements['deck-list'].children[0].fire('click');await settle();assert.equal(pending.elements['save-configuration'].disabled,true);pending.setEnglishStatus('CONVERTED');pending.elements['refresh-english'].fire('click');await settle();assert.equal(pending.elements['save-configuration'].disabled,false);
 const malformed=page({approved:false,englishStatus:'unknown'});await settle();malformed.elements['deck-list'].children[0].fire('click');await settle();assert.equal(malformed.elements['save-configuration'].disabled,true);assert.equal(malformed.elements['prepared-editor'].hidden,true);
 const h=page({approved:false,englishUploadError:'LOCALE_SLIDE_COUNT_MISMATCH'});await settle();h.elements['deck-list'].children[0].fire('click');await settle();h.elements['slide-notes'].value='Apuntes propios';h.elements['english-pdf'].files=[new Blob(['%PDF-fixture'])];h.elements['english-upload-form'].fire('submit');await settle();assert.match(h.elements.message.textContent,/mismo número/);assert.equal(h.elements['slide-notes'].value,'Apuntes propios');assert.equal(h.elements['notes-en-details'].hidden,true);assert.equal(h.elements['save-configuration'].disabled,false);
 h.data.versions.push({...h.data.versions[0],versionId:id(12),number:2});h.elements.refresh.fire('click');await settle();h.elements['deck-list'].children[1].fire('click');await settle();assert.equal(h.elements['slide-notes'].value,'');assert.equal(h.elements['slide-notes-en'].value,'');
});
