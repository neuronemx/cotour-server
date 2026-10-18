const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventLifecycle } = require('../events-v2/lifecycle');
const { EventLiveRuntime, executionKey } = require('../events-v2/live-runtime');

function fixture() {
  const eventId = crypto.randomUUID(), stageId = crypto.randomUUID(), activityId = crypto.randomUUID(), liveId = crypto.randomUUID();
  let committed = true, active = false, reads = 0, clear = 0, binding = false;
  const context = { eventId, stageId, organizationId: crypto.randomUUID(), actorId: 'stage-grant', kind: 'STAGE', purpose: 'live' };
  const credentials = { eventId, grantId: crypto.randomUUID() }, now = new Date();
  const runtime = new EventLiveRuntime(), engine = { states: new Map(), timers: new Map(), witnesses: new Map(), clearTimeoutFn: () => clear++ };
  const grants = { now: () => now, domain: { audit: async () => {} } };
  const row = { id: liveId, event_workspace_id: eventId, event_stage_id: stageId, event_activity_id: activityId, deck_id: 'private', status: 'LIVE', started_at: now, ended_at: null };
  const db = { execute: async sql => {
    reads++;
    if (sql.includes('SELECT a.*')) return [[{ id: activityId, status: 'SCHEDULED', deck_id: 'private', deck_check_status: 'DECK_CHECK', has_version_binding: binding ? 1 : 0 }]];
    if (sql.includes('SELECT l.*')) return [[row]];
    if (sql.startsWith('SELECT id')) return [active ? [{ id: liveId }] : []];
    return [{ affectedRows: 1 }];
  } };
  runtime.prepared = async (_context, _db, id) => ({ eventId, liveSessionId: id, stageId, activityId, deckId: 'private', versionId: 'v1', slideCount: 3 });
  const authorize = async operation => { const result = await operation(context, db); if (!committed) throw new Error('COMMIT_FAILED'); return result; };
  const lifecycle = new EventLifecycle({ grants, runtime, engines: [engine] });
  return { lifecycle, credentials, context, runtime, engine, row, activityId, liveId, authorize, reads: () => reads, clears: () => clear,
    bind: () => { binding = true; }, failCommit: () => { committed = false; }, active: () => { active = true; } };
}

test('Lifecycle start installs a private initial state only after commit, and never returns an uncommitted execution', async () => {
  const f = fixture(); f.failCommit();
  await assert.rejects(f.lifecycle.start(f.credentials, f.activityId, f.authorize), /COMMIT_FAILED/);
  assert.equal(f.runtime.states.size, 0);
  const g = fixture(), result = await g.lifecycle.start(g.credentials, g.activityId, g.authorize);
  assert.equal(result.status, 'LIVE'); assert.equal(result.deckId, undefined);
  assert.equal(g.runtime.states.get(executionKey(result.eventId, result.liveSessionId)).versionId, 'v1');
});

test('Finish failure preserves engines/timers; committed finish discards only its execution and retains other runs', async () => {
  const f = fixture(), key = executionKey(f.credentials.eventId, f.liveId), other = 'other-live';
  for (const map of [f.runtime.states, f.engine.states, f.engine.timers, f.engine.witnesses]) { map.set(key, {}); map.set(other, {}); }
  f.failCommit(); await assert.rejects(f.lifecycle.finish(f.credentials, f.liveId, f.authorize), /COMMIT_FAILED/);
  assert.equal(f.runtime.states.has(key), true); assert.equal(f.clears(), 0);
  const g = fixture(), target = executionKey(g.credentials.eventId, g.liveId);
  for (const map of [g.runtime.states, g.engine.states, g.engine.timers, g.engine.witnesses]) { map.set(target, {}); map.set(other, {}); }
  const result = await g.lifecycle.finish(g.credentials, g.liveId, g.authorize); assert.equal(result.status, 'FINISHED');
  for (const map of [g.runtime.states, g.engine.states, g.engine.timers, g.engine.witnesses]) { assert.equal(map.has(target), false); assert.equal(map.has(other), true); }
  assert.equal(g.clears(), 1);
});

test('Only Stage live purpose controls lifecycle; denied roles/disabled flag read no activity or preparation', async () => {
  for (const kind of ['SPEAKER', 'PLAYER', 'PARTICIPANT', 'VENUE', 'MODERATOR', 'ADMIN']) {
    const f = fixture(); f.context.kind = kind;
    await assert.rejects(f.lifecycle.start(f.credentials, f.activityId, f.authorize), { code: 'LIFECYCLE_COMMAND_DENIED' }); assert.equal(f.reads(), 0);
  }
  const f = fixture(); f.context.purpose = 'rehearsal';
  await assert.rejects(f.lifecycle.current(f.credentials, f.authorize), { code: 'LIFECYCLE_COMMAND_DENIED' }); assert.equal(f.reads(), 0);
  f.runtime.enabled = () => false;
  await assert.rejects(f.lifecycle.finish(f.credentials, f.liveId, f.authorize), { code: 'EVENTS_V2_DISABLED' }); assert.equal(f.reads(), 0);
});

test('An occupied Stage conflicts without preparing a second run; repeated finish preserves the original terminal timestamps', async () => {
  const f = fixture(); f.active(); let preparations = 0; f.runtime.prepared = async () => { preparations++; };
  await assert.rejects(f.lifecycle.start(f.credentials, f.activityId, f.authorize), { code: 'STAGE_ALREADY_LIVE' }); assert.equal(preparations, 0);
  f.row.status = 'FINISHED'; f.row.ended_at = new Date(f.row.started_at.getTime() + 1000);
  const result = await f.lifecycle.finish(f.credentials, f.liveId, f.authorize);
  assert.equal(result.endedAt, f.row.ended_at.toISOString()); assert.equal(result.startedAt, f.row.started_at.toISOString());
});


test('A versioned binding or unlink tombstone cannot inherit legacy Deck Check or an injected ready reader', async () => {
  const f = fixture(); f.bind(); let prepared = 0;
  f.runtime.prepared = async () => { prepared++; return {}; };
  await assert.rejects(f.lifecycle.start(f.credentials, f.activityId, f.authorize), { code: 'CONTENT_NOT_PREPARED' });
  assert.equal(prepared, 0); assert.equal(f.runtime.states.size, 0);
});

test('approved start verifies outside authorization, reauthorizes and releases its slot on every failure',async()=>{
 for(const mode of ['success','verify','pin','commit','revoke']){
  const f=fixture();f.bind();let inTransaction=false,released=0,verifications=0,pins=0,authorizations=0;
  const ticket={scope:{deckId:'approved'}};
  f.lifecycle.content={checks:{acquire:()=>()=>released++},candidate:async()=>ticket,verify:async()=>{assert.equal(inTransaction,false);verifications++;if(mode==='verify')throw new Error('VERIFY');},pin:async()=>{pins++;if(mode==='pin')throw new Error('PIN');}};
  const authorize=async op=>{authorizations++;if(mode==='revoke'&&authorizations===2)throw new Error('REVOKED');inTransaction=true;try{const v=await f.authorize(op);if(mode==='commit'&&authorizations===2)throw new Error('COMMIT');return v;}finally{inTransaction=false;}};
  if(mode==='success'){assert.equal((await f.lifecycle.start(f.credentials,f.activityId,authorize)).status,'LIVE');assert.equal(f.runtime.states.size,1);assert.equal(pins,1);}
  else{await assert.rejects(f.lifecycle.start(f.credentials,f.activityId,authorize));assert.equal(f.runtime.states.size,0);}
  assert.equal(verifications,1);assert.equal(released,1);
 }
});
