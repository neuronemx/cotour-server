const crypto = require('node:crypto');
const { BreakoutStore } = require('../breakout-store');
const { PongStore } = require('../pong-store');
const { GameQueueStore, DEFAULT_GAME_CATALOG } = require('../game-queue-store');
const { executionKey } = require('./live-runtime');
const { CONTROL_KINDS, controls, scope, error } = require('./time-runtime');
function normalizeGames(games) {
  if (!Array.isArray(games) || games.some(game => !['breakout', 'pong'].includes(game?.id)) || games.length > 2 || new Set(games.map(game => game?.id)).size !== games.length) throw error('GAME_CONTENT_NOT_PREPARED');
  return DEFAULT_GAME_CATALOG.filter(item => games.some(game => game?.id === item.id)).map(item => {
    const game = games.find(game => game?.id === item.id);
    if (!Number.isSafeInteger(game.durationMs) || game.durationMs < 1000 || game.durationMs > 3600000) throw error('GAME_CONTENT_NOT_PREPARED');
    return { ...item, durationMs: game.durationMs };
  }).map((item, index, all) => { if (all.length !== games.length) throw error('GAME_CONTENT_NOT_PREPARED'); return item; });
}
class EventGameRuntime {
  constructor({ liveRuntime, polls = null, knowledge = null, raffles = null, readGames = async () => null, now = Date.now,
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, frameIntervalMs = 50 }) {
    this.live = liveRuntime; this.polls = polls; this.knowledge = knowledge; this.raffles = raffles; this.readGames = readGames; this.now = now;
    this.setTimeoutFn = setTimeoutFn; this.clearTimeoutFn = clearTimeoutFn; this.frameIntervalMs = Math.max(50, frameIntervalMs);
    this.states = new Map(); this.timers = new Map(); this.witnesses = new Map(); this.notify = async () => {};
    this.connected = async () => []; // Installed by the fixed-binding socket adapter.
  }
  async prepared(context, db, liveId, preparedLive) {
    const scoped = await scope(this.live, context, db, liveId, preparedLive);
    const catalog = await this.readGames(scoped.prepared, db);
    if (!catalog || ['eventId', 'liveSessionId', 'deckId', 'versionId'].some(field => catalog[field] !== scoped.prepared[field])) throw error('GAME_CONTENT_NOT_PREPARED');
    const definitions = normalizeGames(catalog.games), digest = crypto.createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
    const previous = this.states.get(scoped.key);
    if (previous && (previous.digest !== digest || ['stageId', 'activityId', 'deckId', 'versionId'].some(field => previous.prepared[field] !== scoped.prepared[field]))) throw error('CONTENT_VERSION_CHANGED');
    return { ...scoped, definitions, digest };
  }
  fork(scoped) {
    const previous = this.states.get(scoped.key), queue = new GameQueueStore({ catalog: scoped.definitions, controlRoles: CONTROL_KINDS });
    const breakout = new BreakoutStore({ now: this.now, controlRoles: CONTROL_KINDS, durationMs: scoped.definitions.find(item => item.id === 'breakout')?.durationMs });
    const pong = new PongStore({ now: this.now, controlRoles: CONTROL_KINDS, durationMs: scoped.definitions.find(item => item.id === 'pong')?.durationMs });
    for (const [target, source] of [[queue, previous?.queue], [breakout, previous?.breakout], [pong, previous?.pong]]) if (source) target.sessions = structuredClone(source.sessions);
    return { ...scoped, queue, breakout, pong, queueRunId: previous?.queueRunId || null, revision: previous?.revision || 0,
      pendingInputs: structuredClone(previous?.pendingInputs || []), lastStep: previous?.lastStep ?? this.now() };
  }
  async hasActive(context, db, liveId, preparedLive) {
    const { key } = await this.prepared(context, db, liveId, preparedLive), state = this.states.get(key);
    return state?.queue.sessions.get(key)?.status === 'running';
  }
  engine(state) { const type = state.queue.getSession(state.key).current_game_type; return type ? state[type] : null; }
  prepareGame(state, type, kind) {
    const result = state[type].prepare(state.key, kind, this.now());
    if (!result.ok) throw error('GAME_' + result.reason.toUpperCase());
    result.game.id = crypto.randomUUID(); state.pendingInputs = []; state.lastStep = this.now();
  }
  advance(state, kind) {
    const queue = state.queue.getSession(state.key), previous = queue.current_game_type, next = state.queue.nextGameType(state.key);
    this.engine(state)?.close(state.key, kind, this.now());
    if (next) { this.prepareGame(state, next, kind); state.queue.advance(state.key, previous, next); }
    else { state.queue.end(state.key, kind); state.queueRunId = null; state.pendingInputs = []; }
  }
  async operate(grants, credentials, liveId, command, payload = {}) {
    const key = executionKey(credentials.eventId, liveId);
    return this.live.serial(key, async () => {
      const result = await grants.withSession(credentials, async (context, db) => {
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        const publicCommand = ['input', 'join_team'].includes(command);
        if (command !== 'tick' && (publicCommand ? context.kind !== 'PARTICIPANT' || !context.participantId : !controls(context))) throw error('GAME_COMMAND_DENIED');
        if (!['configure', 'start_queue', 'skip', 'end', 'start', 'pause', 'resume', 'team_names', 'join_team', 'input', 'tick'].includes(command)) throw error('GAME_INVALID_COMMAND');
        const scoped = await this.prepared(context, db, liveId), previous = this.states.get(key);
        if (command === 'tick' && !previous) return { state: null, kind: context.kind };
        const state = this.fork(scoped), queue = state.queue.getSession(key), available = scoped.definitions.map(item => item.id);
        let operation;
        if (['configure', 'start_queue', 'skip', 'end'].includes(command)) {
          if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision !== state.revision) throw error('GAME_STALE_REVISION');
          if (command === 'configure') {
            if (!Array.isArray(payload.selected) || payload.selected.length > 2 || payload.selected.some(item => !available.includes(item)) || new Set(payload.selected).size !== payload.selected.length) throw error('GAME_INVALID_COMMAND');
            operation = state.queue.configure(key, context.kind, payload.selected, available);
          } else if (command === 'start_queue') {
            if (this.polls?.states.get(key)?.store.hasActive(key) || (this.knowledge && await this.knowledge.hasActive(context, db, liveId, scoped.prepared))
              || (this.raffles && await this.raffles.hasActive(context, db, liveId, scoped.prepared))) throw error('INTERACTION_BUSY');
            const valid = state.queue.validateStart(key, context.kind, available);
            if (!valid.ok) throw error('GAME_' + valid.reason.toUpperCase());
            this.prepareGame(state, valid.gameType, context.kind); operation = state.queue.start(key, valid.gameType); state.queueRunId = crypto.randomUUID();
          } else {
            if (!state.queueRunId || payload.queueRunId !== state.queueRunId) throw error('GAME_STALE_RUN');
            if (command === 'skip') {
              if (queue.status !== 'running') throw error('GAME_INVALID_STATE');
              this.advance(state, context.kind);
            } else { this.engine(state)?.close(key, context.kind, this.now()); state.queue.end(key, context.kind); state.queueRunId = null; state.pendingInputs = []; }
          }
        } else if (command === 'tick') {
          if (queue.status !== 'running') return { state: previous, kind: context.kind };
          const engine = this.engine(state), game = engine.getSession(key), now = this.now();
          if (Number.isFinite(queue.transition_at_ms) && now >= queue.transition_at_ms) {
            // Progress only with a currently authorized typed controller witness.
            if (!controls(context)) return { state: previous, kind: context.kind };
            this.advance(state, context.kind);
          } else if (['ready', 'countdown', 'running'].includes(game.status)) {
            const allowed = new Set(await this.connected(db, context, liveId));
            if (game.type === 'breakout') {
              state.pendingInputs = state.pendingInputs.filter(input => allowed.has(input.participantId));
              game.input.left = state.pendingInputs.filter(input => input.direction === 'left').length;
              game.input.right = state.pendingInputs.filter(input => input.direction === 'right').length;
            } else for (const team of ['left', 'right']) for (const id of game.input[team].keys()) if (!allowed.has(id)) game.input[team].delete(id);
            const window = game.input.window_started_at_ms;
            engine.step(key, Math.max(0, Math.min(50, now - state.lastStep)), now); state.lastStep = now;
            if (game.type === 'breakout' && game.input.window_started_at_ms !== window) state.pendingInputs = [];
            if (game.status === 'finished') {
              if (state.queue.nextGameType(key)) state.queue.scheduleTransition(key, game.type, now + 5000);
              else state.queue.finish(key, game.type);
            }
          } else return { state: previous, kind: context.kind };
        } else {
          const engine = this.engine(state), game = engine?.getSession(key);
          if (queue.status !== 'running' || !game || game.id !== payload.gameRunId) throw error('GAME_STALE_RUN');
          if (command === 'join_team') {
            if (game.type !== 'pong' || !['left', 'right'].includes(payload.team)) throw error('GAME_INVALID_COMMAND');
            operation = engine.joinTeam(key, context.participantId, payload.team, this.now());
          } else if (command === 'input') {
            operation = engine.input(key, context.participantId, payload.direction, this.now());
            if (operation.ok && game.type === 'breakout') state.pendingInputs.push({ participantId: context.participantId, direction: payload.direction });
          } else if (command === 'team_names') {
            if (game.type !== 'pong' || typeof payload.left !== 'string' || typeof payload.right !== 'string' || !payload.left.trim() || !payload.right.trim()
              || Array.from(payload.left).length > 24 || Array.from(payload.right).length > 24) throw error('GAME_INVALID_COMMAND');
            operation = engine.setTeamNames(key, context.kind, { left: payload.left, right: payload.right }, this.now());
          } else if (command === 'start') {
            if (game.status !== 'ready') throw error('GAME_INVALID_STATE');
            if (game.type === 'pong') {
              const allowed = new Set(await this.connected(db, context, liveId));
              for (const id of game.roster.keys()) if (!allowed.has(id)) game.roster.delete(id);
            }
            operation = game.type === 'breakout' ? engine.beginCountdown(key, context.kind, this.now()) : engine.start(key, context.kind, this.now());
          } else operation = engine[command](key, context.kind, this.now());
        }
        if (operation && !operation.ok) throw error('GAME_' + operation.reason.toUpperCase());
        state.revision++;
        if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
        return { state, kind: context.kind };
      });
      if (!this.live.enabled()) throw error('LIVE_ACCESS_DENIED');
      if (result.state) this.states.set(key, result.state);
      this.schedule(key, grants, credentials, liveId, result.kind); return key;
    });
  }
  schedule(key, grants, credentials, liveId, kind) {
    const previous = this.timers.get(key);
    const state = this.states.get(key), queue = state?.queue.sessions.get(key), game = state && this.engine(state)?.sessions.get(key);
    if (queue?.status !== 'running' || (!queue.transition_at_ms && !['ready', 'countdown', 'running'].includes(game?.status))) { if (previous) this.clearTimeoutFn(previous); this.timers.delete(key); this.witnesses.delete(key); return; }
    const witnesses = this.witnesses.get(key) || new Map();
    if (controls({ kind })) { witnesses.delete(credentials.grantId); witnesses.set(credentials.grantId, { grants, credentials, kind }); }
    this.witnesses.set(key, new Map([...witnesses].slice(-12)));
    if (previous) return; // Inputs cannot indefinitely postpone a physics tick.
    const handle = this.setTimeoutFn(async () => {
      this.timers.delete(key);
      for (const [id, witness] of [...(this.witnesses.get(key) || [])].reverse()) {
        try { await this.operate(witness.grants, witness.credentials, liveId, 'tick'); await this.notify(key); return; }
        catch (_) { this.witnesses.get(key)?.delete(id); }
      }
      this.witnesses.delete(key);
    }, this.frameIntervalMs);
    handle?.unref?.(); this.timers.set(key, handle);
  }
  async projection(context, db, liveId, preparedLive) {
    const scoped = await this.prepared(context, db, liveId, preparedLive), state = this.states.get(scoped.key), engine = state && this.engine(state);
    const result = { eventId: context.eventId, liveSessionId: liveId, revision: state?.revision || 0, queueRunId: state?.queueRunId || null, game: null };
    if (controls(context)) result.queue = state ? state.queue.snapshot(scoped.key, scoped.definitions.map(item => item.id)) : new GameQueueStore({ catalog: scoped.definitions }).snapshot(scoped.key, scoped.definitions.map(item => item.id));
    if (engine) {
      const raw = engine.snapshot(scoped.key, this.now());
      // Engine snapshots already omit roster/input identities. Público gets
      // controls/status and its membership only; physics belongs to Screen.
      if (context.kind === 'PARTICIPANT') result.game = { id: raw.id, type: raw.type, status: raw.status, remaining_ms: raw.remaining_ms,
        ...(raw.type === 'pong' ? { teams: raw.teams, membership: state.pong.membership(scoped.key, context.participantId) } : {}) };
      else { result.game = raw; if (context.kind === 'PLAYER') delete result.game.roster_counts; }
    }
    return result;
  }
  close() { for (const timer of this.timers.values()) this.clearTimeoutFn(timer); this.timers.clear(); this.witnesses.clear(); }
}
module.exports = { EventGameRuntime, normalizeGames };
