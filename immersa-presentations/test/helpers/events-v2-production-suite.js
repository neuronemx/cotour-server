const assert=require('node:assert/strict'),crypto=require('node:crypto');
async function productionSuite(t,f){const{request,sql,domain,base,cookies,ids,o1,a,b,stageB,publicId,setDomainEnabled}=f,root='/api/events-v2/organizations/'+o1+'/events/'+a;let stage,activity,pilot;
 try{
 await t.test('Production shell requires real account auth and flag; public join shell exposes no event data',async()=>{
  const page=await fetch(base+'/events-v2/production',{headers:{cookie:cookies.get('producer')}});assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('Centro de Producción'));assert.ok(!html.includes(publicId));assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const anon=await fetch(base+'/events-v2/production',{redirect:'manual'});assert.equal(anon.status,302);assert.match(anon.headers.get('location'),/^\/auth\?returnTo=/);
  const join=await fetch(base+'/events-v2/join/'+publicId);assert.equal(join.status,200);assert.ok((await join.text()).includes('Entrar al evento'));
  setDomainEnabled(false);try{for(const url of ['/events-v2/production','/events-v2/join/'+publicId,root+'/production'])assert.equal((await fetch(base+url)).status,404);}finally{setDomainEnabled(true);}
 });
 await t.test('Production metadata requires current event roles, including for platform admins and organization members',async()=>{
  for(const actor of [null,'platform','member','admin2'])assert.notEqual((await request(actor,'GET',root+'/production')).status,200);
  const own=await request('producer','GET',root+'/production');assert.equal(own.status,200);assert.equal(own.body.event.eventId,a);assert.ok(own.body.stages.every(s=>s.id!==stageB));assert.equal((await request('producer','GET',root.replace('/events/'+a,'/events/'+b)+'/production')).status,404);
 });
 await t.test('Production creates event-owned stages and activities and rejects foreign stages and forged fields',async()=>{
  const s=await request('producer','POST',root+'/stages',{name:'Production '+crypto.randomUUID()});assert.equal(s.status,201);stage=s.body.id;assert.equal((await request('producer','POST',root+'/stages',{name:s.body.name})).status,409);
  const created=await request('producer','POST',root+'/activities',{title:'Production activity',stageId:stage,accessLevel:'FREE'});assert.equal(created.status,201);activity=created.body.id;
  assert.equal((await request('dual','POST',root+'/activities',{title:'Wrong event',stageId:stageB,accessLevel:'FREE'})).status,404);assert.equal((await request('producer','POST',root+'/activities',{title:'Forged',stageId:stage,accessLevel:'FREE',eventId:b})).status,400);assert.equal((await request('member','POST',root+'/stages',{name:'Denied'})).status,404);
  const snapshot=(await request('producer','GET',root+'/production')).body;assert.equal(snapshot.activities.find(x=>x.id===activity).stageId,stage);assert.equal(snapshot.activities.find(x=>x.id===activity).liveSessionId,null);
 });
 await t.test('Production mutations enforce same origin and roll back if audit insertion fails',async()=>{
  const count=async()=>Number((await sql('SELECT COUNT(*) n FROM event_stages WHERE event_workspace_id=?',[a]))[0].n),before=await count();assert.equal((await request('producer','POST',root+'/stages',{name:'Cross site'},{origin:'https://foreign.invalid'})).status,403);
  await domain.pool.query("CREATE TRIGGER reject_production_audit BEFORE INSERT ON event_security_audit FOR EACH ROW BEGIN IF NEW.action='stage.create' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PRODUCTION_TEST_FAILURE'; END IF; END");try{assert.equal((await request('producer','POST',root+'/stages',{name:'Rolled back'})).status,503);}finally{await domain.pool.query('DROP TRIGGER reject_production_audit');}assert.equal(await count(),before);
 });
 await t.test('Public access is explicit, level-bound and idempotent and cannot revive disabled links',async()=>{
  const first=await request('producer','POST',root+'/public-access',{audienceLevel:'FREE'});assert.equal(first.status,201);assert.equal(first.body.publicId,publicId);assert.equal((await request('producer','POST',root+'/public-access',{audienceLevel:'FREE'})).body.publicId,publicId);assert.equal((await request('producer','POST',root+'/public-access',{audienceLevel:'ALL'})).status,400);
  await sql('UPDATE event_public_qrs SET active=0 WHERE public_id=?',[publicId]);try{assert.equal((await request('producer','POST',root+'/public-access',{audienceLevel:'FREE'})).status,409);}finally{await sql('UPDATE event_public_qrs SET active=1 WHERE public_id=?',[publicId]);}
 });
 await t.test('Pilot setup is platform-only and grants organization Admin explicitly to its authenticated account',async()=>{
  assert.equal((await request('producer','POST','/api/events-v2/platform/pilot-organization',{name:'Denied'})).status,403);assert.equal((await request('platform','POST','/api/events-v2/platform/pilot-organization',{name:'Forged',adminUserId:ids.get('admin1')})).status,400);
  const r=await request('platform','POST','/api/events-v2/platform/pilot-organization',{name:'Disposable production pilot'});assert.equal(r.status,201);pilot=r.body.id;assert.deepEqual(await sql('SELECT user_id,role FROM event_organization_memberships WHERE organization_id=?',[pilot]),[{user_id:ids.get('platform'),role:'ADMIN'}]);
 });
 }finally{if(activity)await sql('DELETE FROM event_activities WHERE id=?',[activity]);if(stage)await sql('DELETE FROM event_stages WHERE id=?',[stage]);if(pilot){await sql('DELETE FROM event_organization_memberships WHERE organization_id=?',[pilot]);await sql('DELETE FROM event_organizations WHERE id=?',[pilot]);}}
}
module.exports={productionSuite};
