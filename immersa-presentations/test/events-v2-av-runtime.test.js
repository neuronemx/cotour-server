const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const engine = require('../audiovisual-state');
const { EventLiveRuntime } = require('../events-v2/live-runtime');
const { EventAVRuntime, normalizeAV } = require('../events-v2/av-runtime');
const { byteRange } = require('../events-v2/asset-http');
function catalog() { return { resources: [{ id: 'song', assetId: 'asset-song', name: 'Song', type: 'audio', duration: 4, size: 10, sha256: 'a'.repeat(64), contentType: 'audio/mpeg' }, { id: 'song2', assetId: 'asset-song2', name: 'Song 2', type: 'audio', duration: 5, size: 11, sha256: 'b'.repeat(64), contentType: 'audio/mpeg' }], playlists: [{ id: 'music', name: 'Music', type: 'audio', resourceIds: ['song', 'song2'] }] }; }
function fixtures(definitions=catalog) {
  const eventId = crypto.randomUUID(), liveId = crypto.randomUUID(), stageId = crypto.randomUUID(), activityId = crypto.randomUUID();
  let now = 100000, fail = false, enabled = true, record = null, reads = 0;
  const context = credential => ({ eventId, kind: credential.kind, purpose: 'live', participantId: credential.participantId || crypto.randomUUID(), grantId: credential.grantId, audienceLevel: 'FREE' });
  const db = { execute: async (sql, params) => {
    if (sql.includes('FROM event_live_sessions')) return [[{ id: liveId, deck_id: 'private', event_stage_id: stageId, event_activity_id: activityId, access_level: 'FREE' }]];
    if (sql.startsWith('SELECT * FROM event_v2_reaction_counts')) return [[record].filter(Boolean)];
    if (sql.startsWith('INSERT INTO event_v2_reaction_counts')) { record = { id: params[0], stage_id: params[1], activity_id: params[2], deck_id: params[3], version_id: params[4], heart_count: 0, clap_count: 0, fire_count: 0 }; return [{}]; }
    if (sql.startsWith('UPDATE event_v2_reaction_counts')) { const field = /SET (\w+)/.exec(sql)[1]; record[field]++; return [{}]; }
    throw new Error('unexpected SQL');
  } };
  const grants = { withSession: async (credential, operation) => { const before = structuredClone(record); try { const result = await operation(context(credential), db); if (fail) throw new Error('commit failed'); return result; } catch (error) { record = before; throw error; } } };
  const live = new EventLiveRuntime({ enabled: () => enabled, readPreparation: async resolved => ({ ...resolved, versionId: 'v1', slideCount: 3 }) });
  const av = new EventAVRuntime({ liveRuntime: live, now: () => now, readAV: async prepared => { reads++; return { ...prepared, ...definitions() }; }, setTimeoutFn: () => ({}), clearTimeoutFn: () => {} });
  const credentials = kind => ({ eventId, grantId: crypto.randomUUID(), kind, participantId: crypto.randomUUID() });
  return { av, live, db, grants, context, credentials, liveId, clock: value => { now = value; }, fail: value => { fail = value; }, enabled: value => { enabled = value; }, reads: () => reads, record: () => record };
}
test('private audiovisual catalogs reject raw URLs, unbound assets, duplicate IDs and bad playlist types', () => {
  assert.equal(normalizeAV(catalog()).resources.length, 2);
  for (const resource of [{ ...catalog().resources[0], media_url: 'https://public' }, { ...catalog().resources[0], assetId: '../secret' }, { ...catalog().resources[0], size: NaN }, { ...catalog().resources[0], contentType: 'text/html' }]) assert.throws(() => normalizeAV({ resources: [resource], playlists: [] }), { code: 'AV_CONTENT_NOT_PREPARED' });
  assert.throws(() => normalizeAV({ ...catalog(), playlists: [{ ...catalog().playlists[0], type: 'video' }] }), { code: 'AV_CONTENT_NOT_PREPARED' });
});
test('shared audiovisual reducer preserves independent channels, one-second fades, pause/seek/loop/playlist behavior', () => {
  const media = catalog().resources, state = engine.channels(1000); state.audio = engine.select(state.audio, media[0], true, .3, 1000);
  assert.equal(state.video.resource, null); const paused = engine.control(state.audio, { action: 'pause' }, 2000); assert.equal(paused.position, 1);
  const selected = engine.select(state.audio, media[1], false, .3, 2200); assert.equal(selected.status, 'fading'); assert.equal(engine.completeFade(selected, 3200).resource.id, 'song2');
  const sought = engine.control(paused, { action: 'seek', position: 3 }, 2300); assert.equal(sought.position, 3);
  assert.equal(engine.advancePlaylist(state.audio, media, true, 4000).resource.id, 'song2'); assert.equal(engine.advancePlaylist({ ...state.audio, resource: media[1], loop: false }, media, true, 4000).status, 'stopped');
});
test('byte ranges support prefix/open/suffix and reject overflow, multiple and unsatisfiable ranges', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5, partial: true }); assert.deepEqual(byteRange('bytes=8-', 10), { start: 8, end: 9, partial: true }); assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, partial: true });
  for (const range of ['bytes=20-', 'bytes=5-2', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=9007199254740992-', 'bytes=-']) assert.throws(() => byteRange(range, 10), { code: 'AV_INVALID_RANGE' });
});
test('idle reads/denied roles never initialize; failed commit cannot publish media, echoes, counters or drawing', async () => {
  const f = fixtures(), stage = f.credentials('STAGE'), publicActor = f.credentials('PARTICIPANT'); await f.live.operate(f.grants, stage, f.liveId);
  assert.equal((await f.av.projection(f.context(stage), f.db, f.liveId)).channels.audio.resource, null); assert.equal(f.av.states.size, 0); assert.equal(f.record(), null);
  const reads = f.reads(); await assert.rejects(f.av.operate(f.grants, publicActor, f.liveId, 'control', { action: 'select', resourceId: 'song', loop: false }), { code: 'AV_COMMAND_DENIED' }); assert.equal(f.reads(), reads);
  f.fail(true);
  for (const [actor, command, payload] of [[stage, 'control', { action: 'select', resourceId: 'song', loop: false }], [publicActor, 'react', { emoji: '❤️' }], [stage, 'draw', { slideIndex: 0, points: [{ x: .1, y: .1 }, { x: .9, y: .9 }], width: .01, ttl: 4200 }]]) {
    await assert.rejects(f.av.operate(f.grants, actor, f.liveId, command, payload), /commit failed/); assert.equal(f.av.states.size, 0); assert.equal(f.record(), null);
  }
});
test('100 authorized reactions persist beyond visual cap; Público only gets its own echo, limiter survives windows and rollback', async () => {
  const f = fixtures(), stage = f.credentials('STAGE'); await f.live.operate(f.grants, stage, f.liveId);
  for (let i = 0; i < 100; i++) { const reply = await f.av.operate(f.grants, f.credentials('PARTICIPANT'), f.liveId, 'react', { emoji: '❤️' }); assert.equal(reply.own.target, 'audience'); }
  assert.equal(f.record().heart_count, 100); const key = [...f.av.states.keys()][0]; assert.equal(f.av.states.get(key).state.visibleReactions.length, 50);
  assert.equal((await f.av.projection(f.context(f.credentials('PLAYER')), f.db, f.liveId)).reactions.length, 50);
  const publicActor = f.credentials('PARTICIPANT'), publicView = await f.av.projection(f.context(publicActor), f.db, f.liveId); assert.equal(publicView.reactions, undefined); assert.equal(publicView.reactionCounts, undefined); assert.equal(publicView.channels, undefined);
  for (let i = 0; i < 4; i++) await f.av.operate(f.grants, publicActor, f.liveId, 'react', { emoji: '👏' });
  await assert.rejects(f.av.operate(f.grants, { ...publicActor, grantId: crypto.randomUUID() }, f.liveId, 'react', { emoji: '👏' }), { code: 'AV_REACTION_RATE_LIMITED' }); assert.equal(f.record().clap_count, 4);
  f.clock(103200); assert.equal((await f.av.projection(f.context(f.credentials('PLAYER')), f.db, f.liveId)).reactions.length, 0);
  const before = f.av.states.get(key); f.fail(true); await assert.rejects(f.av.operate(f.grants, publicActor, f.liveId, 'react', { emoji: '🔥' }), /commit failed/); assert.equal(f.record().fire_count, 0); assert.equal(f.av.states.get(key), before);
});
test('expired fades reauthorize witnesses, preserve a single pending selection and fail closed after access loss', async () => {
  const f = fixtures(), stage = f.credentials('STAGE'), callbacks = []; f.av.setTimeoutFn = callback => { callbacks.push(callback); return {}; };
  await f.live.operate(f.grants, stage, f.liveId); await f.av.operate(f.grants, stage, f.liveId, 'control', { action: 'select', resourceId: 'song', loop: false });
  const key = (await f.av.operate(f.grants, stage, f.liveId, 'control', { action: 'select', resourceId: 'song2', loop: false })).key;
  await f.av.operate(f.grants, stage, f.liveId, 'control', { action: 'volume', volume: .2 });
  const before = f.av.states.get(key); f.enabled(false); let notices = 0; f.av.notify = async () => { notices++; }; f.clock(101001); await callbacks.at(-1)(); assert.equal(f.av.states.get(key), before); assert.equal(notices, 0);
  f.enabled(true); await f.av.operate(f.grants, stage, f.liveId, 'tick'); assert.equal(f.av.states.get(key).state.channels.audio.resource.id, 'song2'); assert.equal(f.av.states.get(key).state.channels.audio.volume, .2);
});

const fxCatalog=()=>({...catalog(),resources:[...catalog().resources,{id:'fx',assetId:'asset-fx',name:'FX',type:'video',duration:2,size:20,sha256:'c'.repeat(64),contentType:'video/webm',category:'fx',fx:{timecode:'00:01',fps:10,seconds:.1}}]});
test('FX catalog requires canonical cue bound to a WebM duration and excludes FX from ordinary playlists',()=>{assert.equal(normalizeAV(fxCatalog()).resources.at(-1).fx.seconds,.1);for(const patch of [{contentType:'video/mp4'},{fx:{timecode:'00:01',fps:10,seconds:1}},{duration:.01},{category:'video'}]){const c=fxCatalog();Object.assign(c.resources.at(-1),patch);assert.throws(()=>normalizeAV(c),{code:'AV_CONTENT_NOT_PREPARED'});}const c=fxCatalog();c.playlists=[{id:'fx-list',name:'FX',type:'video',resourceIds:['fx']}];assert.throws(()=>normalizeAV(c));});
test('FX advances all roles once, rejects early/stale/foreign-role callbacks, and a failed commit cannot consume or navigate',async()=>{const f=fixtures(fxCatalog),stage=f.credentials('STAGE'),player=f.credentials('PLAYER');await f.live.operate(f.grants,stage,f.liveId);const key=(await f.av.operate(f.grants,stage,f.liveId,'control',{action:'select',resourceId:'fx',loop:false})).key;let channel=f.av.states.get(key).state.channels.video;const cue={resourceId:'fx',playbackId:channel.playbackId,mediaTime:.1};await assert.rejects(f.av.operate(f.grants,stage,f.liveId,'fx_advance',cue),{code:'AV_COMMAND_DENIED'});await assert.rejects(f.av.operate(f.grants,player,f.liveId,'fx_advance',{...cue,mediaTime:.09}),{code:'AV_FX_CUE_NOT_REACHED'});await assert.rejects(f.av.operate(f.grants,player,f.liveId,'fx_advance',{...cue,playbackId:crypto.randomUUID()}),{code:'AV_STALE_PLAYBACK'});const before=f.live.states.get(key);f.fail(true);await assert.rejects(f.av.operate(f.grants,player,f.liveId,'fx_advance',cue),/commit failed/);assert.equal(f.live.states.get(key),before);assert.equal(f.av.states.get(key).state.channels.video.fxPlayback.consumed,false);f.fail(false);await Promise.all([f.av.operate(f.grants,player,f.liveId,'fx_advance',cue),f.av.operate(f.grants,f.credentials('PLAYER'),f.liveId,'fx_advance',cue)]);assert.equal(f.live.states.get(key).liveSlideIndex,1);assert.equal(f.live.states.get(key).revision,1);assert.equal(f.av.states.get(key).state.channels.video.fxPlayback.consumed,true);});
test('Manual navigation or paused transmission suppresses an FX cue; replay anchors to the new slide and last slide clamps',async()=>{const f=fixtures(fxCatalog),stage=f.credentials('STAGE'),player=f.credentials('PLAYER');await f.live.operate(f.grants,stage,f.liveId);const select=()=>f.av.operate(f.grants,stage,f.liveId,'control',{action:'select',resourceId:'fx',loop:false});const key=(await select()).key;const cue=()=>({resourceId:'fx',playbackId:f.av.states.get(key).state.channels.video.playbackId,mediaTime:.1});const old=cue();await f.live.operate(f.grants,stage,f.liveId,'next');await f.av.operate(f.grants,player,f.liveId,'fx_advance',old);assert.equal(f.live.states.get(key).liveSlideIndex,1);await select();await f.av.operate(f.grants,player,f.liveId,'fx_advance',cue());assert.equal(f.live.states.get(key).liveSlideIndex,2);await select();const before=f.live.states.get(key);await f.av.operate(f.grants,player,f.liveId,'fx_advance',cue());assert.equal(f.live.states.get(key),before);await f.live.operate(f.grants,stage,f.liveId,'go',{slideIndex:0});await select();await f.live.operate(f.grants,stage,f.liveId,'pause');await f.av.operate(f.grants,player,f.liveId,'fx_advance',cue());assert.equal(f.live.states.get(key).liveSlideIndex,0);f.av.close();});
test('Stop all fades independent channels, cancels FX advance, preserves idle volume and cannot stop a newer replay',async()=>{const f=fixtures(fxCatalog),stage=f.credentials('STAGE'),player=f.credentials('PLAYER');await f.live.operate(f.grants,stage,f.liveId);await f.av.operate(f.grants,stage,f.liveId,'control',{action:'volume',volume:.3});await f.av.operate(f.grants,stage,f.liveId,'control',{action:'select',resourceId:'song',loop:true});const key=(await f.av.operate(f.grants,stage,f.liveId,'control',{action:'select',resourceId:'fx',loop:false})).key;const old=f.av.states.get(key).state.channels.video.playbackId;assert.equal(f.av.states.get(key).state.channels.video.volume,.3);await f.av.operate(f.grants,stage,f.liveId,'stop_all');const first=f.av.states.get(key).state;assert.equal(first.channels.audio.status,'fading');assert.equal(first.channels.video.fxPlayback.consumed,true);await assert.rejects(f.av.operate(f.grants,player,f.liveId,'fx_advance',{resourceId:'fx',playbackId:old,mediaTime:.2}),{code:'AV_STALE_PLAYBACK'});f.clock(100500);await f.av.operate(f.grants,stage,f.liveId,'control',{action:'volume',volume:.6});assert.equal(f.av.states.get(key).state.channels.video.fadeOut.id,first.channels.video.fadeOut.id);await f.av.operate(f.grants,stage,f.liveId,'control',{action:'select',resourceId:'fx',loop:false});f.clock(101001);await f.av.operate(f.grants,stage,f.liveId,'tick');assert.equal(f.av.states.get(key).state.channels.audio.status,'stopped');assert.equal(f.av.states.get(key).state.channels.video.status,'playing');assert.equal(f.av.states.get(key).state.channels.video.volume,.6);assert.notEqual(f.av.states.get(key).state.channels.video.playbackId,old);await assert.rejects(f.av.operate(f.grants,stage,f.liveId,'audio_react',{action:'next',enabled:true}),{code:'AV_REACT_DISABLED'});assert.equal((await f.av.projection(f.context(stage),f.db,f.liveId)).audioReact.enabled,false);f.av.close();});

test('Global fade preserves the current media clock instead of seeking a running clip back to its stored start',async()=>{const f=fixtures(fxCatalog),stage=f.credentials('STAGE');await f.live.operate(f.grants,stage,f.liveId);await f.av.operate(f.grants,stage,f.liveId,'control',{action:'select',resourceId:'fx',loop:false});f.clock(100800);await f.av.operate(f.grants,stage,f.liveId,'stop_all');const projection=await f.av.projection(f.context(stage),f.db,f.liveId);assert.equal(projection.channels.video.position,.8);f.clock(101001);await f.av.operate(f.grants,stage,f.liveId,'control',{action:'volume',volume:.4});assert.equal((await f.av.projection(f.context(stage),f.db,f.liveId)).channels.video.position,.8);f.av.close();});
