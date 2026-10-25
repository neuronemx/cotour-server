const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/events-v2/production-page.js'),'utf8'),html=fs.readFileSync(require.resolve('../events-v2/production.html'),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),org=id(1),event=id(2),activity=id(3),stage=id(4),deck=id(5),version=id(6),grant=id(7),token='a'.repeat(43);
async function settle(){for(let i=0;i<80;i++)await Promise.resolve();}
function page({approved=true,bound=true,endsAt='2099-01-01T00:00:00.000Z'}={}){
 class E{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.handlers={};this.value='';this.disabled=false;this.hidden=false;this.dataset={};this.classList={toggle(){}};this.isConnected=true;}
  set innerHTML(_){throw Error('Unsafe HTML');}
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
 const data={event:{eventId:event,organizationId:org,title:'Own event',timezone:'America/Mexico_City'},stages:[{id:stage,name:'Main'}],activities:[{id:activity,title:'Own activity',stageId:stage,accessLevel:'FREE',status:'SCHEDULED',versionId:bound?version:null,bindingRevision:bound?1:0,liveSessionId:null,scheduledStartsAt:null,scheduledEndsAt:null,durationMinutes:60}],versions:[{deckId:deck,versionId:version,title:'Own Deck',number:1,preparationStatus:'CONVERTED',slideCount:1,approvalDigest:approved?'b'.repeat(64):null,configurationDigest:null}],endsAt,publicAccess:[]};
 const calls=[],navigations=[];
 const fetch=async(url,options)=>{calls.push({url,...options});let value;
  if(url.endsWith('/organizations'))value=[{id:org,name:'Own org'}];else if(url.endsWith('/events'))value=[{eventId:event,title:'Own event'}];else if(url.endsWith('/production'))value=structuredClone(data);
  else if(url.endsWith('/grants'))value={grantId:grant,eventId:event,token};
  else if(url.endsWith('/deck-binding')){data.activities[0].versionId=version;value={};}
  else if(url.endsWith('/schedule')){const input=JSON.parse(options.body);Object.assign(data.activities[0],input,{scheduledEndsAt:new Date(Date.parse(input.scheduledStartsAt)+input.durationMinutes*60000).toISOString()});value={};}
  else if(url.endsWith('/activities'))value={id:activity};else throw Error('Unexpected request '+url);
  return{ok:true,json:async()=>value};};
 const location={pathname:'/events-v2/production',search:'',assign:url=>navigations.push(url)},window={location};
 vm.runInNewContext(source,{document,window,location,history:{replaceState(){}},fetch,FormData,URLSearchParams,Intl,Date,Error});
 return{elements,tabs,data,calls,navigations,find:(parent,text)=>walk(parent).find(e=>e.textContent===text),walk,zone};
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
