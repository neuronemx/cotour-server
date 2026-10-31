const crypto = require('node:crypto');
const engine = require('../audiovisual-state');
const { normalizeCue } = require('../public/events-v2/av-fx');
const { applyPresenterSlide } = require('../presentation-navigation');
const { ReactionRuntime, ALLOWED_REACTIONS, SCREEN_LIFETIME_MS } = require('../reaction-runtime');
const { controls, scope, error } = require('./time-runtime');
const { executionKey } = require('./live-runtime');
const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value);
const bounded = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const fields = (payload, allowed) => payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).length === allowed.length && allowed.every(key => Object.hasOwn(payload, key));
const columns = { '❤️': 'heart_count', '👏': 'clap_count', '🔥': 'fire_count' };
const EVENT_SCREEN_LIMIT = 50;
function normalizeAV(catalog) {
  if (!Array.isArray(catalog.resources) || catalog.resources.length > 200 || !Array.isArray(catalog.playlists) || catalog.playlists.length > 100) throw error('AV_CONTENT_NOT_PREPARED');
  const seen = new Set(), assets = new Map();
  const resources = catalog.resources.map(item => {
    if (!item || !token(item.id) || seen.has(item.id) || !token(item.assetId) || !bounded(item.name, 120) || !['audio', 'video'].includes(item.type)
      || typeof item.duration !== 'number' || !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > 86400
      || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 2 ** 40 || !/^[a-f0-9]{64}$/.test(item.sha256 || '')
      || !(item.type === 'audio' ? ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'] : ['video/mp4', 'video/webm']).includes(item.contentType)
      || ['media_url', 'url', 'path', 'thumbnail_url'].some(key => Object.hasOwn(item, key)) || item.source === 'local') throw error('AV_CONTENT_NOT_PREPARED');
    seen.add(item.id);
    const normalized = { id: item.id, assetId: item.assetId, name: item.name.trim(), type: item.type, duration: item.duration, size: item.size, sha256: item.sha256, contentType: item.contentType };
    if(item.category!==undefined || item.fx!==undefined) {
      const cue=normalizeCue(item.fx);
      if(item.category!=='fx'||item.type!=='video'||item.contentType!=='video/webm'||!cue||cue.seconds!==item.fx.seconds||cue.seconds>item.duration)throw error('AV_CONTENT_NOT_PREPARED');
      Object.assign(normalized,{category:'fx',fx:cue});
    }
    const binding = JSON.stringify([item.type, item.size, item.sha256, item.contentType,normalized.fx]);
    if (assets.has(item.assetId) && assets.get(item.assetId) !== binding) throw error('AV_CONTENT_NOT_PREPARED'); assets.set(item.assetId, binding);
    return normalized;
  });
  const playlistIds = new Set();
  const playlists = catalog.playlists.map(item => {
    if (!item || !token(item.id) || playlistIds.has(item.id) || !bounded(item.name, 120) || !['audio', 'video'].includes(item.type)
      || !Array.isArray(item.resourceIds) || !item.resourceIds.length || item.resourceIds.length > 200 || new Set(item.resourceIds).size !== item.resourceIds.length
      || item.resourceIds.some(id => !resources.some(resource => resource.id === id && resource.type === item.type && resource.category!=='fx'))) throw error('AV_CONTENT_NOT_PREPARED');
    playlistIds.add(item.id); return { id: item.id, name: item.name.trim(), type: item.type, resourceIds: [...item.resourceIds] };
  });
  if (catalog.publicId !== undefined && !token(catalog.publicId)) throw error('AV_CONTENT_NOT_PREPARED');
  return { resources, playlists, publicId: catalog.publicId || null };
}
function initial(now) { return { channels: engine.channels(now), volume: 1, audioReact: { enabled: false, reaction: 0, updatedAt: now },
  overlays: { showReactions: true, reactionsOnScreen: true, qrVisible: false, messageVisible: false, messageText: '' }, strokes: [], visibleReactions: [], strokeLimits: new Map(), revision: 0 }; }
class EventAVRuntime {
  constructor({ liveRuntime, readAV = async () => null, readAsset = async () => null, now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    this.live = liveRuntime; this.readAV = readAV; this.readAsset = readAsset; this.now = now; this.setTimeoutFn = setTimeoutFn; this.clearTimeoutFn = clearTimeoutFn;
    this.states = new Map(); this.timers = new Map(); this.witnesses = new Map(); this.notify = async () => {};
  }
  async prepared(context, db, liveId, preparedLive) {
    const scoped = await scope(this.live, context, db, liveId, preparedLive), catalog = await this.readAV(scoped.prepared, db);
    if (!catalog || ['eventId', 'liveSessionId', 'deckId', 'versionId'].some(field => catalog[field] !== scoped.prepared[field])) throw error('AV_CONTENT_NOT_PREPARED');
    const definitions = normalizeAV(catalog), digest = crypto.createHash('sha256').update(JSON.stringify(definitions)).digest('hex'), previous = this.states.get(scoped.key);
    if (previous && (previous.digest !== digest || ['stageId', 'activityId', 'deckId', 'versionId'].some(field => previous.prepared[field] !== scoped.prepared[field]))) throw error('CONTENT_VERSION_CHANGED');
    const [records] = await db.execute('SELECT * FROM event_v2_reaction_counts WHERE id = ?', [liveId]);
    const record = records[0];
    if (record && (record.stage_id !== scoped.prepared.stageId || record.activity_id !== scoped.prepared.activityId || record.deck_id !== scoped.prepared.deckId || record.version_id !== scoped.prepared.versionId)) throw error('CONTENT_VERSION_CHANGED');
    return { ...scoped, definitions, digest, record };
  }
  fork(scoped) {
    const previous = this.states.get(scoped.key), state = previous ? structuredClone(previous.state) : initial(this.now());
    state.strokes = state.strokes.filter(stroke => stroke.createdAt + stroke.ttl > this.now()); state.visibleReactions = state.visibleReactions.filter(reaction => reaction.until > this.now());
    const own = [], screen = [], reactions = new ReactionRuntime({ now: this.now, screenLimit: EVENT_SCREEN_LIMIT, emitScreen: payload => screen.push(payload) });
    if (previous) for (const key of ['limiters', 'visibleUntil', 'nextPruneAt', 'bucket', 'accepting']) reactions[key] = structuredClone(previous.reactions[key]);
    reactions.bucket.counts = { '❤️': Number(scoped.record?.heart_count || 0), '👏': Number(scoped.record?.clap_count || 0), '🔥': Number(scoped.record?.fire_count || 0) };
    return { ...scoped, state, reactions, own, screen };
  }
  async operate(grants, credentials, liveId, command, payload = {}) {
    const key = executionKey(credentials.eventId, liveId);
    return this.live.serial(key, async () => {
      const result = await grants.withSession(credentials, async (context, db) => {
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        if (command !== 'tick' && (command === 'react' ? context.kind !== 'PARTICIPANT' || !context.participantId : ['ended', 'playlist_advance', 'fx_advance'].includes(command) ? context.kind !== 'PLAYER' : !controls(context))) throw error('AV_COMMAND_DENIED');
        if (!['tick', 'control', 'stop_all', 'fx_advance', 'audio_react', 'overlay', 'draw', 'clear_message', 'clear_screen', 'react', 'ended', 'playlist_advance'].includes(command)) throw error('AV_INVALID_COMMAND');
        if(command==='audio_react')throw error('AV_REACT_DISABLED');
        const scoped = await this.prepared(context, db, liveId);
        if (command === 'tick' && !this.states.has(key)) return { candidate: null, kind: context.kind, changed: false };
        const candidate = this.fork(scoped), { state } = candidate; let changed = command !== 'tick';
        const now = this.now();
        if (command === 'tick') {
          for (const type of ['audio', 'video']) {
            const current = state.channels[type];
            if (current.status === 'fading' && current.fadeAt <= now) {
              state.channels[type] = engine.completeFade(current, now); delete state.channels[type].fadeAt;delete state.channels[type].fadeOut;
              changed = true;
            }
          }
        } else if(command==='stop_all') {
          if(!fields(payload,[]))throw error('AV_INVALID_COMMAND');changed=false;
          for(const type of ['audio','video']) {const current=state.channels[type];if(!current.resource||current.status==='stopped'||current.fadeOut)continue;
            state.channels[type]={...current,status:'fading',pendingResource:null,fadeOut:{id:crypto.randomUUID(),startedAt:now,durationMs:1000,wasPaused:current.status==='paused'},fadeAt:now+1000,updatedAt:now,lastAction:'fade-stop-all',...(current.fxPlayback?{fxPlayback:{...current.fxPlayback,consumed:true}}:{})};changed=true;}
        } else if(command==='fx_advance') {
          if(!fields(payload,['resourceId','playbackId','mediaTime'])||typeof payload.mediaTime!=='number'||!Number.isFinite(payload.mediaTime))throw error('AV_INVALID_COMMAND');
          const current=state.channels.video,fx=current.fxPlayback;
          if(current.status!=='playing'||current.resource?.category!=='fx'||!fx||fx.id!==payload.playbackId||current.resource.id!==payload.resourceId)throw error('AV_STALE_PLAYBACK');
          if(payload.mediaTime<current.resource.fx.seconds||payload.mediaTime>current.resource.duration+.1)throw error('AV_FX_CUE_NOT_REACHED');
          if(fx.consumed)changed=false;
          else {fx.consumed=true;const live=this.live.states.get(key);
            if(!live.transmissionPaused&&live.presenterSlideIndex===fx.slideIndex&&live.revision===fx.revision&&live.presenterSlideIndex+1<live.slideCount){const next={...live};applyPresenterSlide(next,live.presenterSlideIndex+1);next.revision++;candidate.liveCandidate=Object.freeze(next);}}
        } else if (command === 'control') {
          const action = payload.action;
          const required = action === 'select' ? ['action', 'resourceId', 'loop'] : action === 'select_playlist' ? ['action', 'playlistId', 'loop']
            : action === 'volume' ? ['action', 'volume'] : ['action', 'type', 'playbackId', ...(['seek', 'loop'].includes(action) ? [action === 'seek' ? 'position' : 'loop'] : [])];
          if (!fields(payload, required) || !['select', 'select_playlist', 'stop', 'fade-stop', 'play', 'pause', 'seek', 'loop', 'volume'].includes(action)) throw error('AV_INVALID_COMMAND');
          if (action === 'select' || action === 'select_playlist') {
            if (typeof payload.loop !== 'boolean') throw error('AV_INVALID_COMMAND');
            const playlist = action === 'select_playlist' ? scoped.definitions.playlists.find(item => item.id === payload.playlistId) : null;
            const resource = scoped.definitions.resources.find(item => item.id === (playlist ? playlist.resourceIds[0] : payload.resourceId));
            if (!resource || (action === 'select_playlist' && !playlist)) throw error('AV_RESOURCE_NOT_FOUND');
            if(resource.category==='fx'&&payload.loop)throw error('AV_INVALID_COMMAND');
            const next = engine.select(state.channels[resource.type], resource, payload.loop, state.volume, now), playbackId = crypto.randomUUID();
            if (next.pendingResource) { next.pendingResource.playbackId = playbackId; next.pendingResource.playlistId = playlist?.id || null; next.fadeAt = now + 1000; }
            else { next.playbackId = playbackId; next.playlistId = playlist?.id || null;
              if(resource.category==='fx'){const live=this.live.states.get(key);next.fxPlayback={id:playbackId,slideIndex:live.presenterSlideIndex,revision:live.revision,consumed:false};}}
            state.channels[resource.type] = next;
          } else if (action === 'volume') {
            if (typeof payload.volume !== 'number' || !Number.isFinite(payload.volume) || payload.volume < 0 || payload.volume > 1) throw error('AV_INVALID_COMMAND');
            state.volume = payload.volume;
            for (const type of ['audio', 'video']) {
              state.channels[type] = { ...state.channels[type], volume: payload.volume, updatedAt: now, lastAction: state.channels[type].status === 'fading' ? state.channels[type].lastAction : action };
              if (state.channels[type].pendingResource) state.channels[type].pendingResource.volume = payload.volume;
            }
          } else {
            const current = state.channels[payload.type];
            if (!current?.resource || !payload.playbackId || current.playbackId !== payload.playbackId) throw error('AV_STALE_PLAYBACK');
            if (action === 'seek' && (typeof payload.position !== 'number' || !Number.isFinite(payload.position) || payload.position < 0 || payload.position > current.resource.duration)) throw error('AV_INVALID_COMMAND');
            if(current.resource.category==='fx'&&['seek','loop','pause','play'].includes(action))throw error('AV_INVALID_COMMAND');
            if (action === 'loop' && typeof payload.loop !== 'boolean') throw error('AV_INVALID_COMMAND');
            if (current.status === 'fading' && action !== 'stop') throw error('AV_INVALID_STATE');
            if (action === 'fade-stop' && (payload.type !== 'audio' || current.status !== 'playing')) throw error('AV_INVALID_STATE');
            state.channels[payload.type] = engine.control(current, payload, now); delete state.channels[payload.type].pendingResource;
            if (action === 'fade-stop') state.channels[payload.type].fadeAt = now + 1000;
            else {delete state.channels[payload.type].fadeAt;delete state.channels[payload.type].fadeOut;}
            if(action==='stop'&&current.fxPlayback)state.channels[payload.type].fxPlayback={...current.fxPlayback,consumed:true};
          }
        } else if (['ended', 'playlist_advance'].includes(command)) {
          if (!fields(payload, ['type', 'playbackId']) || !['audio', 'video'].includes(payload.type) || (command === 'playlist_advance' && payload.type !== 'video')) throw error('AV_INVALID_COMMAND');
          const channel = state.channels[payload.type];
          if (!channel.resource || channel.playbackId !== payload.playbackId || channel.status !== 'playing') throw error('AV_STALE_PLAYBACK');
          const playlist = scoped.definitions.playlists.find(item => item.id === channel.playlistId), resources = playlist?.resourceIds.map(id => scoped.definitions.resources.find(item => item.id === id));
          if (command === 'playlist_advance' && !playlist) throw error('AV_INVALID_STATE');
          const next = resources ? engine.advancePlaylist(channel, resources, command === 'ended', now) : channel.loop ? channel : engine.control(channel, { action: 'stop' }, now);
          if (!next) throw error('AV_INVALID_STATE');
          if (next.resource?.id !== channel.resource?.id || next.lastAction === 'playlist-next') next.playbackId = crypto.randomUUID();
          state.channels[payload.type] = next;
        } else if (command === 'audio_react') {
          if (!fields(payload, payload.action === 'next' ? ['action', 'enabled'] : ['action', 'reaction', 'enabled']) || !['next', 'set'].includes(payload.action)
            || typeof payload.enabled !== 'boolean' || (payload.action === 'set' && (!Number.isSafeInteger(payload.reaction) || payload.reaction < 0 || payload.reaction > 11))) throw error('AV_INVALID_COMMAND');
          state.audioReact = engine.audioReact(state.audioReact, payload, now);
        } else if (command === 'overlay') {
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.keys(payload).length || Object.keys(payload).some(key => !['showReactions', 'qrVisible', 'messageVisible', 'messageText'].includes(key))
            || ['showReactions', 'qrVisible', 'messageVisible'].some(key => Object.hasOwn(payload, key) && typeof payload[key] !== 'boolean')
            || (Object.hasOwn(payload, 'messageText') && (typeof payload.messageText !== 'string' || payload.messageText.length > 2000))) throw error('AV_INVALID_COMMAND');
          if (payload.qrVisible && !scoped.definitions.publicId) throw error('AV_QR_NOT_PREPARED');
          if (payload.qrVisible) {
            const [rows] = await db.execute('SELECT public_id FROM event_public_qrs WHERE public_id = ? AND event_workspace_id = ? AND active = 1', [scoped.definitions.publicId, context.eventId]);
            if (!rows.length) throw error('AV_QR_NOT_PREPARED');
          }
          state.overlays = { ...state.overlays, ...engine.overlayPatch(payload) };
        } else if (command === 'draw') {
          if (!fields(payload, ['slideIndex', 'points', 'width', 'ttl']) || !Number.isSafeInteger(payload.slideIndex) || payload.slideIndex !== this.live.states.get(key).liveSlideIndex
            || !Array.isArray(payload.points) || payload.points.length < 2 || payload.points.length > 240
            || payload.points.some(point => !fields(point, ['x', 'y']) || ![point.x, point.y].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1))
            || typeof payload.width !== 'number' || !Number.isFinite(payload.width) || payload.width < .003 || payload.width > .02
            || !Number.isSafeInteger(payload.ttl) || payload.ttl < 3000 || payload.ttl > 5000) throw error('AV_INVALID_COMMAND');
          if (state.strokeLimits.has(context.grantId) && now - state.strokeLimits.get(context.grantId) < 100) throw error('AV_DRAW_RATE_LIMITED');
          state.strokeLimits.set(context.grantId, now);
          state.strokes.push({ ...engine.drawing(payload, payload.slideIndex, now), id: crypto.randomUUID() }); state.strokes = state.strokes.slice(-128);
        } else if (command === 'react') {
          if (!fields(payload, ['emoji']) || !ALLOWED_REACTIONS.has(payload.emoji)) throw error('AV_INVALID_COMMAND');
          if (!candidate.reactions.react({ socket: { emit: (_event, data) => candidate.own.push(data) }, audienceId: context.participantId, emoji: payload.emoji, showOnScreen: state.overlays.showReactions })) throw error('AV_REACTION_RATE_LIMITED');
          if (!scoped.record) await db.execute('INSERT INTO event_v2_reaction_counts (id,stage_id,activity_id,deck_id,version_id) VALUES (?,?,?,?,?)', [liveId, scoped.prepared.stageId, scoped.prepared.activityId, scoped.prepared.deckId, scoped.prepared.versionId]);
          await db.execute(`UPDATE event_v2_reaction_counts SET ${columns[payload.emoji]} = ${columns[payload.emoji]} + 1 WHERE id = ?`, [liveId]);
          for (const data of candidate.screen) state.visibleReactions.push({ id: crypto.randomUUID(), emoji: data.emoji, at: data.at, until: data.at + SCREEN_LIFETIME_MS });
        } else {
          if (!fields(payload, [])) throw error('AV_INVALID_COMMAND');
          state.overlays = { ...state.overlays, messageVisible: false, messageText: '' };
          if (command === 'clear_screen') { state.overlays.qrVisible = false; state.strokes = []; state.visibleReactions = []; candidate.reactions.visibleUntil = []; }
        }
        if (changed) state.revision++;
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        return { candidate, changed, kind: context.kind, own: candidate.own[0] || null };
      });
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      if (result.candidate && result.changed) {this.states.set(key, result.candidate);if(result.candidate.liveCandidate)this.live.states.set(key,result.candidate.liveCandidate);}
      this.schedule(key, grants, credentials, liveId, result.kind);
      return { key, own: result.own || null };
    });
  }
  schedule(key, grants, credentials, liveId, kind) {
    const old = this.timers.get(key); if (old) this.clearTimeoutFn(old); this.timers.delete(key);
    const state = this.states.get(key)?.state, deadlines = state ? Object.values(state.channels).filter(channel => channel.status === 'fading').map(channel => channel.fadeAt) : [];
    if (!deadlines.length) { this.witnesses.delete(key); return; }
    const witnesses = this.witnesses.get(key) || new Map(); if (controls({ kind })) { witnesses.delete(credentials.grantId); witnesses.set(credentials.grantId, { grants, credentials }); }
    this.witnesses.set(key, new Map([...witnesses].slice(-12)));
    const handle = this.setTimeoutFn(async () => {
      this.timers.delete(key);
      for (const [id, witness] of [...(this.witnesses.get(key) || [])].reverse()) {
        try { await this.operate(witness.grants, witness.credentials, liveId, 'tick'); await this.notify(key); return; }
        catch (_) { this.witnesses.get(key)?.delete(id); }
      }
      this.witnesses.delete(key);
    }, Math.max(5, Math.min(...deadlines) - this.now() + 5)); handle?.unref?.(); this.timers.set(key, handle);
  }
  assetUrl(context, liveId, id) { return `/api/events-v2/live/${context.eventId}/${liveId}/${context.grantId}/assets/${id}`; }
  async projection(context, db, liveId, preparedLive) {
    const scoped = await this.prepared(context, db, liveId, preparedLive), current = this.states.get(scoped.key), state = current?.state || initial(this.now()), now = this.now();
    const snapshot = { eventId: context.eventId, liveSessionId: liveId, revision: state.revision,
      overlays: { messageVisible: state.overlays.messageVisible, messageText: state.overlays.messageVisible ? state.overlays.messageText : '' },
      strokes: state.strokes.filter(stroke => stroke.createdAt + stroke.ttl > now && stroke.slideIndex === this.live.states.get(scoped.key).liveSlideIndex).map(stroke => structuredClone(stroke)) };
    if (context.kind === 'PARTICIPANT') return snapshot;
    let qrVisible = state.overlays.qrVisible;
    if (qrVisible) {
      const [rows] = await db.execute('SELECT public_id FROM event_public_qrs WHERE public_id = ? AND event_workspace_id = ? AND active = 1', [scoped.definitions.publicId, context.eventId]);
      qrVisible = rows.length > 0;
    }
    snapshot.overlays = { ...state.overlays, qrVisible, publicId: qrVisible ? scoped.definitions.publicId : null };
    snapshot.audioReact = { ...state.audioReact,enabled:false }; snapshot.channels = {};
    const resourceDTO = resource => resource ? { id: resource.id, name: resource.name, type: resource.type, duration: resource.duration,...(resource.category==='fx'?{category:'fx',source:'event',fx:{...resource.fx}}:{}), assetUrl: this.assetUrl(context, liveId, resource.assetId) } : null;
    for (const type of ['audio', 'video']) {
      const channel = state.channels[type]; snapshot.channels[type] = { resource: resourceDTO(channel.resource), status: channel.status, loop: channel.loop, volume: channel.volume,
        position: channel.status === 'playing' && channel.startedAt ? Math.min(channel.resource.duration, Math.max(0, channel.position + (now - channel.startedAt) / 1000)) : channel.position,
        startedAt: channel.startedAt ?? null, updatedAt: channel.updatedAt, playbackId: channel.playbackId || null, fadeAt: channel.fadeAt || null,...(channel.fadeOut?{fadeOut:{...channel.fadeOut}}:{}),...(channel.fxPlayback?{fxPlayback:{...channel.fxPlayback}}:{}) };
    }
    snapshot.available = scoped.definitions.resources.map(resourceDTO);
    snapshot.playlists = scoped.definitions.playlists.map(item => ({ ...item }));
    if (context.kind === 'PLAYER' && state.overlays.showReactions) snapshot.reactions = state.visibleReactions.filter(reaction => reaction.until > now).map(reaction => ({ ...reaction }));
    if (['STAGE', 'SPEAKER'].includes(context.kind)) snapshot.reactionCounts = { '❤️': Number(scoped.record?.heart_count || 0), '👏': Number(scoped.record?.clap_count || 0), '🔥': Number(scoped.record?.fire_count || 0) };
    return snapshot;
  }
  close() { for (const timer of this.timers.values()) this.clearTimeoutFn(timer); this.timers.clear(); this.witnesses.clear(); }
}
module.exports = { EventAVRuntime, normalizeAV, fields, EVENT_SCREEN_LIMIT };
