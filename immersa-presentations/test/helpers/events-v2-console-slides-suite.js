const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {io}=require('socket.io-client');
const {createClient,consumeLink}=require('../../public/events-v2/access-client');
const {createController:createLive,targetKey}=require('../../public/events-v2/live-console');
const {createController:createSlides}=require('../../public/events-v2/slides-console');
const {normalizeSlides}=require('../../events-v2/slides-runtime');
async function consoleSlidesSuite(t,f){
 const {sql,request,grants,base,a,o1,preparations}=f,admin=f.ids.get('admin1'),stageId=crypto.randomUUID(),otherStage=crypto.randomUUID(),activity=crypto.randomUUID(),otherActivity=crypto.randomUUID(),liveId=crypto.randomUUID(),otherLive=crypto.randomUUID();
 await grants.setWindow(admin,o1,a,new Date(f.now().getTime()+2*86400000).toISOString());
 await sql('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?),(?,?,?)',[stageId,a,'Slides console',otherStage,a,'Other slides console']);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=','base64');
 const r=id=>({assetId:id,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),contentType:'image/png',width:1,height:1});
 const catalog={englishEnabled:true,presenterLanguage:'en',slides:Array.from({length:5},(_,i)=>({es:{full:r('es-'+i),notes:'Notas privadas ES '+i+' <b>literal</b>'},...(i===0?{en:{full:r('en-0'),notes:'Private English notes 0'}}:{})}))};
 for(const [id,stage,run]of [[activity,stageId,liveId],[otherActivity,otherStage,otherLive]]){
  await sql("INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,deck_id,deck_check_status,access_level,status) VALUES (?,?,?,?,?,'DECK_CHECK','FREE','LIVE')",[id,a,stage,'Slides fixture','console-slides-deck']);
  await sql('INSERT INTO event_live_sessions (id,event_workspace_id,event_stage_id,event_activity_id,deck_id) VALUES (?,?,?,?,?)',[run,a,stage,id,'console-slides-deck']);
  preparations.set(run,{eventId:a,liveSessionId:run,deckId:'console-slides-deck',versionId:'slides-v1',slideCount:5,polls:[],knowledge:[],raffles:[],games:[],resources:[],playlists:[],slideDigest:normalizeSlides(catalog,5).digest,...structuredClone(catalog)});
  f.slideImages.set(run,new Map([...Array.from({length:5},(_,i)=>['es-'+i,bytes]),['en-0',bytes]]));
 }
 const active=new Set();const close=()=>{for(const c of active)c.access.close();};t.after(close);
 async function until(p,label){const end=Date.now()+25000;while(!p()){if(Date.now()>end)throw Error('Slides timeout: '+label);await new Promise(r=>setTimeout(r,10));}}
 async function issue(view,kind,scope){return {view,issued:await grants.issue(admin,o1,a,{kind,purpose:kind==='PLAYER'?'player':'live',...scope})};}
 function open(item){let cookie=item.cookie,live,slides;const commands=[];const link=consumeLink(new URL(`${base}/events-v2/console/${item.view}/${a}/${item.issued.grantId}`+(item.issued.token?'#token='+item.issued.token:'')),{replaceState(){}});
  const access=createClient({binding:link.binding,now:()=>f.now().getTime(),requestTimeoutMs:15000,retryDelayMs:10,fetch:async(url,options)=>{const response=await fetch(base+url,{...options,headers:{...options.headers,origin:base,...(cookie?{cookie}:{})}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;},io:(ns,options)=>io(base+ns,{...options,extraHeaders:{origin:base},transports:['websocket'],forceNew:true}),onState:s=>{slides.updateAccess(s);live.updateAccess(s);},onEvent:(name,value)=>live.receive(name,value)});
  const original=access.command;const client={...access,command:(name,input)=>{commands.push(name);return original(name,input);}};
  live=createLive({access:client,onState:s=>slides?.updateLive(s)});slides=createSlides({access:client});
  const c={access,live,slides,commands,cookie:()=>cookie,snapshot:()=>slides.getState().snapshot,ready:()=>until(()=>live.getState().status==='live'&&slides.getState().status==='ready'&&!slides.getState().pending,'snapshots'),start:async()=>{await access.start(link.token);await until(()=>access.getState().status==='ready','access');if(['stage','audience'].includes(item.view))await live.select(targetKey(access.getState().targets.find(r=>r.activityId===activity)));await c.ready();}};active.add(c);return c;
 }
 const stage=open(await issue('stage','STAGE',{stageId})),speaker=open(await issue('speaker','SPEAKER',{activityId:activity})),player=open(await issue('screen','PLAYER',{liveSessionId:liveId}));
 const registered=await request(null,'POST',`/api/events-v2/public/${f.publicId}/participants`,{name:'Slides attendee'});assert.equal(registered.status,201);
 const attendeeGrantId=registered.body.context.grantId;const attendee=open({view:'audience',issued:{grantId:attendeeGrantId},cookie:registered.headers.get('set-cookie').split(';')[0]});
 const image=(c,url,options={})=>fetch(base+url,{...options,headers:{cookie:c.cookie(),...options.headers}});
 try{
 await t.test('shipped slide consoles separate private previews from transmission and serve reauthorized images with personal English fallback',async()=>{
  await stage.start();await speaker.start();await player.start();await attendee.start();assert.equal(stage.snapshot().prompter.current.text,'Private English notes 0');assert.equal(speaker.snapshot().prompter.current.text,'Private English notes 0');assert.equal(stage.snapshot().prompter.next.text,'Notas privadas ES 1 <b>literal</b>');for(const c of [player,attendee]){const raw=await c.access.command('events:slides:snapshot',{language:'es'});assert.equal(raw.ok,true);assert.equal(raw.snapshot.prompter,undefined);assert.equal(JSON.stringify(raw).includes('Private English notes'),false);assert.equal(JSON.stringify(raw).includes('Notas privadas'),false);}assert.equal(player.snapshot().language,'en');assert.equal(attendee.snapshot().language,'es');assert.equal(player.snapshot().preview,undefined);
  assert.equal(await attendee.slides.setLanguage('en'),true);assert.equal(attendee.snapshot().slide.language,'en');const url=attendee.snapshot().slide.url,before=f.imageOpens();
  assert.equal((await fetch(base+url)).status,401);assert.equal(f.imageOpens(),before);
  const head=await image(attendee,url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),'no-store');assert.equal(f.imageOpens(),before);
  const etag=head.headers.get('etag');assert.equal((await image(attendee,url,{headers:{'if-none-match':etag}})).status,304);assert.equal(f.imageOpens(),before);
  const part=await image(attendee,url,{headers:{range:'bytes=1-3'}});assert.equal(part.status,206);assert.deepEqual(Buffer.from(await part.arrayBuffer()),bytes.subarray(1,4));assert.equal(f.imageOpens(),before+1);
  assert.equal((await image(attendee,url,{headers:{range:'bytes=9999-'}})).status,416);
  for(const bad of [url.replace('/0/full','/1/full'),url.replace('/0/full','/0/thumb'),url.replace('/'+liveId+'/', '/'+otherLive+'/'),url+'?path=public'])assert.equal((await image(attendee,bad)).status,403);
  assert.equal((await image(attendee,url,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await image(player,player.snapshot().slide.url.replace('/en/','/es/'))).status,403);
  assert.equal(await stage.live.operate('pause'),true);await stage.ready();assert.equal(await stage.live.operate('next'),true);await stage.ready();await player.ready();await attendee.ready();
  assert.equal(stage.snapshot().preview.index,1);assert.equal(stage.snapshot().prompter.current.text,'Notas privadas ES 1 <b>literal</b>');assert.equal(stage.snapshot().prompter.current.index,1);assert.equal(stage.snapshot().prompter.current.language,'es');assert.equal(stage.snapshot().slide.index,0);assert.equal(stage.snapshot().next.index,2);assert.equal(player.snapshot().slide.index,0);assert.equal((await image(stage,stage.snapshot().preview.url)).status,200);
  assert.equal(await stage.live.operate('play'),true);await until(()=>attendee.snapshot()?.slide.index===1&&player.snapshot()?.slide.index===1,'resumed slide');assert.equal(attendee.snapshot().language,'en');assert.equal(attendee.snapshot().slide.language,'es');
 });
 await t.test('private slides deny changed access levels, changed preparation, revocation and finished lives without opening bytes',async()=>{
  let url=attendee.snapshot().slide.url;const before=f.imageOpens(),idleUrl=url.replace('/'+liveId+'/', '/'+otherLive+'/');
  // Negative fixtures use an unbound Live. Periodic review must remain free to
  // revoke actual observers without racing an unrelated later assertion.
  await sql("UPDATE event_activities SET access_level='PAID' WHERE id=?",[otherActivity]);const denied=await image(attendee,idleUrl);assert.equal(denied.status,403);assert.equal((await denied.json()).code,'LIVE_ACCESS_DENIED');assert.equal(f.imageOpens(),before);await sql("UPDATE event_activities SET access_level='FREE' WHERE id=?",[otherActivity]);
  const data=preparations.get(otherLive);data.slides[0].en.notes='Changed private notes';const changed=await image(attendee,idleUrl);assert.equal(changed.status,403);assert.equal((await changed.json()).code,'CONTENT_VERSION_CHANGED');data.slides[0].en.notes='Private English notes 0';
  await grants.revoke(admin,o1,a,attendeeGrantId);await f.grantSockets.reviewAll();await until(()=>attendee.access.getState().status==='denied','revoke');assert.equal(attendee.snapshot(),null);assert.ok([401,403].includes((await image(attendee,url)).status));assert.equal(f.imageOpens(),before);
  await grants.revoke(admin,o1,a,speaker.access.getState().context.grantId);await f.grantSockets.reviewAll();await until(()=>speaker.snapshot()===null,'speaker notes revoked');
  url=player.snapshot().slide.url;assert.equal(stage.access.getState().status,'ready');await stage.live.operate('finish');await until(()=>player.snapshot()===null,'finish');const ended=await sql('SELECT status,ended_at FROM event_live_sessions WHERE id=?',[liveId]);assert.equal(ended[0].status,'FINISHED');assert.ok(ended[0].ended_at);assert.equal(stage.commands.filter(n=>n==='events:lifecycle:finish').length,1);assert.equal((await image(player,url)).status,403);assert.equal(f.imageOpens(),before);
 });
 }finally{close();}
}
module.exports={consoleSlidesSuite};
