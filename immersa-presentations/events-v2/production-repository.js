const crypto = require('node:crypto');
const {EventAccessError,textField,requireCapability}=require('./authorization');
const {isId}=require('./grant-repository');
const fail=(code,status=400)=>{throw new EventAccessError(code,status);};
class EventProductionRepository {
 constructor(domain){this.domain=domain;}
 async authorized(db,actor,org,event){const c=await this.domain.event(db,org,event,actor,'event.configure');requireCapability(c,'content.prepare');return c;}
 async snapshot(actor,org,event){return this.domain.transaction(actor,'production.read',async db=>{
  const context=await this.authorized(db,actor,org,event),rows=(q,v=[event])=>this.domain.rows(db,q,v);
  const stages=await rows('SELECT id,name FROM event_stages WHERE event_workspace_id=? AND active=1 ORDER BY sort_order,name LIMIT 501');
  const activities=await rows(`SELECT a.id,a.title,a.event_stage_id AS stageId,a.access_level AS accessLevel,a.status,
   b.deck_id AS deckId,b.version_id AS versionId,b.revision AS bindingRevision,l.id AS liveSessionId
   FROM event_activities a JOIN event_stages s ON s.id=a.event_stage_id AND s.event_workspace_id=a.event_workspace_id AND s.active=1
   LEFT JOIN event_activity_deck_bindings b ON b.activity_id=a.id AND b.event_id=a.event_workspace_id
   LEFT JOIN event_live_sessions l ON l.event_activity_id=a.id AND l.event_workspace_id=a.event_workspace_id AND l.event_stage_id=a.event_stage_id AND l.status='LIVE' AND l.ended_at IS NULL
   WHERE a.event_workspace_id=? ORDER BY a.created_at,a.id LIMIT 501`);
  const versions=await rows(`SELECT d.id AS deckId,d.title,v.id AS versionId,v.version_number AS number,
   p.status AS preparationStatus,p.slide_count AS slideCount,c.configuration_digest AS configurationDigest,
   k.approval_digest AS approvalDigest FROM event_decks d JOIN event_deck_versions v ON v.deck_id=d.id AND v.event_id=d.event_id
   LEFT JOIN event_deck_preparations p ON p.version_id=v.id AND p.deck_id=d.id AND p.event_id=d.event_id
   LEFT JOIN event_deck_configurations c ON c.version_id=v.id AND c.deck_id=d.id AND c.event_id=d.event_id
   LEFT JOIN event_deck_checks k ON k.version_id=v.id AND k.deck_id=d.id AND k.event_id=d.event_id
   WHERE d.event_id=? ORDER BY d.created_at,v.version_number DESC LIMIT 501`);
  if([stages,activities,versions].some(a=>a.length>500))fail('PRODUCTION_LIMIT',409);
  const windows=await rows('SELECT ends_at AS endsAt FROM event_operational_windows WHERE event_id=?');
  const publicAccess=await rows("SELECT public_id AS publicId,audience_level AS audienceLevel,active FROM event_public_qrs WHERE event_workspace_id=?");
  return{event:{eventId:event,organizationId:org,title:context.title,slug:context.slug,timezone:context.timezone},stages,activities,versions,endsAt:windows[0]?.endsAt||null,publicAccess:publicAccess.filter(x=>x.active).map(({publicId,audienceLevel})=>({publicId,audienceLevel}))};
 });}
 async stage(actor,org,event,name){name=textField(name,120);return this.domain.transaction(actor,'stage.create',async db=>{
  await this.authorized(db,actor,org,event);const id=crypto.randomUUID();await db.execute('INSERT INTO event_stages (id,event_workspace_id,name) VALUES (?,?,?)',[id,event,name]);await this.domain.audit(db,actor,'stage.create',org,event,id);return{id,name};
 });}
 async activity(actor,org,event,{title,stageId,accessLevel}){title=textField(title);if(!isId(stageId)||!['FREE','PAID'].includes(accessLevel))fail('INVALID_INPUT');return this.domain.transaction(actor,'activity.create',async db=>{
  await this.authorized(db,actor,org,event);const rows=await this.domain.rows(db,'SELECT id FROM event_stages WHERE id=? AND event_workspace_id=? AND active=1 FOR UPDATE',[stageId,event]);if(!rows[0])fail('RESOURCE_NOT_FOUND',404);
  const id=crypto.randomUUID();await db.execute('INSERT INTO event_activities (id,event_workspace_id,event_stage_id,title,access_level) VALUES (?,?,?,?,?)',[id,event,stageId,title,accessLevel]);await this.domain.audit(db,actor,'activity.create',org,event,id);return{id,title,stageId,accessLevel};
 });}
 async publicAccess(actor,org,event,level){if(!['FREE','PAID'].includes(level))fail('INVALID_INPUT');return this.domain.transaction(actor,'public.access.create',async db=>{
  await this.authorized(db,actor,org,event);const rows=await this.domain.rows(db,'SELECT public_id AS publicId,active FROM event_public_qrs WHERE event_workspace_id=? AND audience_level=? FOR UPDATE',[event,level]);
  if(rows[0]){if(!rows[0].active)fail('PUBLIC_ACCESS_DISABLED',409);return{publicId:rows[0].publicId,audienceLevel:level};}
  const id=crypto.randomUUID(),publicId='p_evt_'+crypto.randomUUID().replaceAll('-','');await db.execute('INSERT INTO event_public_qrs (id,event_workspace_id,public_id,audience_level) VALUES (?,?,?,?)',[id,event,publicId,level]);await this.domain.audit(db,actor,'public.access.create',org,event,id);return{publicId,audienceLevel:level};
 });}
}
module.exports={EventProductionRepository};
