(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventLiveConsole = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const error = code => Object.assign(new Error(code), { code });
  const targetKey = item => item.activityId + ':' + (item.liveSessionId || 'scheduled');
  function createController({ access, onState = () => {} }) {
    let grant = null, generation = -1, selectedActivity = null, selectedLive = null;
    let bound = null, attempted = null, snapshot = null, pending = false, sequence = 0, finished = null;
    let state = Object.freeze({ status: 'waiting', targets: [], target: null, snapshot: null, pending: false, code: null });
    function selected() {
      return grant?.targets.find(item => item.activityId === selectedActivity && item.liveSessionId === selectedLive)
        || grant?.targets.find(item => item.activityId === selectedActivity) || null;
    }
    function publish(status, code = null) {
      state = Object.freeze({ status, targets: grant?.targets || [], target: selected(), snapshot,
        pending, code, kind: grant?.context.kind || null, purpose: grant?.context.purpose || null });
      onState(state);
    }
    function validSnapshot(value) {
      if (!grant || !bound || !value || value.eventId !== grant.context.eventId || value.liveSessionId !== bound
        || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.slideIndex) || value.slideIndex < 0
        || typeof value.transmissionPaused !== 'boolean' || (snapshot && value.revision < snapshot.revision)) return null;
      const out = { eventId: value.eventId, liveSessionId: bound, revision: value.revision, slideIndex: value.slideIndex,
        transmissionPaused: value.transmissionPaused };
      if (['STAGE', 'SPEAKER'].includes(grant.context.kind)) {
        if (!Number.isSafeInteger(value.slideCount) || value.slideCount < 1 || value.slideCount > 100000
          || !Number.isSafeInteger(value.presenterSlideIndex) || value.presenterSlideIndex < 0 || value.presenterSlideIndex >= value.slideCount
          || !Number.isSafeInteger(value.liveSlideIndex) || value.liveSlideIndex < 0 || value.liveSlideIndex >= value.slideCount
          || value.slideIndex >= value.slideCount || ![null, 'STAGE', 'SPEAKER'].includes(value.transmissionPausedBy)) return null;
        Object.assign(out, { slideCount: value.slideCount, presenterSlideIndex: value.presenterSlideIndex,
          liveSlideIndex: value.liveSlideIndex, transmissionPausedBy: value.transmissionPausedBy });
      }
      return Object.freeze(out);
    }
    async function join() {
      const target = selected();
      if (!grant || !target?.liveSessionId || pending) return false;
      const version = generation, ticket = ++sequence; pending = true; snapshot = null; bound = attempted = target.liveSessionId; publish('joining');
      try {
        const result = await access.command('events:live:join', { liveSessionId: bound });
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw error(result.code || 'LIVE_ACCESS_DENIED');
        const view = validSnapshot(result.snapshot);
        if (!view) throw error('INVALID_LIVE_RESPONSE');
        snapshot = view; pending = false; publish('live'); return true;
      } catch (failure) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        pending = false; bound = null; snapshot = null; publish('unavailable', failure.code || 'LIVE_ACCESS_DENIED'); return false;
      }
    }
    function updateAccess(value) {
      if (value.status !== 'ready') {
        sequence++; grant = null; generation = -1; bound = attempted = snapshot = null; pending = false; publish('waiting'); return;
      }
      const changed = generation !== value.generation;
      grant = value; generation = value.generation;
      if (!changed) { publish(state.status, state.code); return; }
      sequence++; bound = attempted = snapshot = null; pending = false;
      // A lost ack never replays a mutation. New metadata can reveal the result
      // of a prior start; only a read/join is recovered on the fresh socket.
      const target = selected();
      if (target) { selectedActivity = target.activityId; selectedLive = target.liveSessionId; }
      else if (['SPEAKER', 'PLAYER'].includes(value.context.kind) && value.targets.length === 1) {
        selectedActivity = value.targets[0].activityId; selectedLive = value.targets[0].liveSessionId;
      } else { selectedActivity = selectedLive = null; }
      if (selected()?.liveSessionId && selected().liveSessionId !== finished) join();
      else publish(finished ? 'finished' : 'waiting');
    }
    async function select(key) {
      if (!grant || pending) return false;
      const target = grant.targets.find(item => targetKey(item) === key);
      if (!target) return false;
      if (attempted && attempted !== target.liveSessionId) {
        selectedActivity = target.activityId; selectedLive = target.liveSessionId; finished = null;
        await access.resume(); return true;
      }
      selectedActivity = target.activityId; selectedLive = target.liveSessionId; finished = null;
      if (target.liveSessionId) return join();
      bound = snapshot = null; publish('waiting'); return true;
    }
    async function operate(action, input = {}) {
      const context = grant?.context, target = selected();
      const controls = context && ['STAGE', 'SPEAKER'].includes(context.kind) && context.purpose === 'live';
      const navigation = { next: 'events:slide:next', prev: 'events:slide:prev', go: 'events:slide:go',
        pause: 'events:presentation:pause', play: 'events:presentation:play' };
      if (!context || pending) return false;
      let name, payload = {};
      if (action === 'start') {
        if (context.kind !== 'STAGE' || context.purpose !== 'live' || !target?.canStart || bound) return false;
        name = 'events:lifecycle:start'; payload = { activityId: target.activityId };
      } else if (action === 'finish') {
        if (context.kind !== 'STAGE' || !bound || state.status !== 'live') return false;
        name = 'events:lifecycle:finish';
      } else {
        if (!Object.hasOwn(navigation, action) || state.status !== 'live' || !bound
          || !(controls || (context.kind === 'PLAYER' && ['next', 'prev'].includes(action)))) return false;
        if (action === 'go') {
          if (!Number.isSafeInteger(input.slideIndex) || input.slideIndex < 0 || input.slideIndex >= snapshot.slideCount) return false;
          payload = { slideIndex: input.slideIndex };
        }
        name = navigation[action];
      }
      const version = generation, ticket = ++sequence; pending = true; publish(state.status);
      try {
        const result = await access.command(name, payload);
        if (!grant || generation !== version || sequence !== ticket) return false;
        if (!result.ok) throw error(result.code || 'LIVE_ACCESS_DENIED');
        pending = false;
        if (action === 'start') {
          const live = result.liveSession;
          if (!live || live.eventId !== context.eventId || live.activityId !== target.activityId || live.stageId !== context.stageId
            || typeof live.liveSessionId !== 'string' || live.status !== 'LIVE') throw error('INVALID_LIVE_RESPONSE');
          selectedLive = live.liveSessionId; finished = null;
          // Fetch the new authoritative catalog. Never add a client-invented
          // target or reuse an already bound socket for another execution.
          await access.resume(); return true;
        }
        if (action === 'finish') {
          if (result.liveSession?.eventId !== context.eventId || result.liveSession?.liveSessionId !== bound
            || result.liveSession?.status !== 'FINISHED') throw error('INVALID_LIVE_RESPONSE');
          finished = bound; bound = snapshot = null; publish('finished'); return true;
        }
        const view = validSnapshot(result.snapshot); if (!view) throw error('INVALID_LIVE_RESPONSE');
        snapshot = view; publish('live'); return true;
      } catch (failure) {
        if (!grant || generation !== version || sequence !== ticket) return false;
        pending = false;
        // A valid live projection is retained after a denied command, not used
        // to infer success. Transport loss has already cleared it via access.
        publish(snapshot ? 'live' : 'unavailable', failure.code || 'LIVE_ACCESS_DENIED'); return false;
      }
    }
    function receive(name, value) {
      if (!grant || !bound || !value || value.eventId !== grant.context.eventId || value.liveSessionId !== bound) return;
      if (name === 'events:lifecycle:finished' && value.status === 'FINISHED') {
        finished = bound; bound = snapshot = null; pending = false; sequence++; publish('finished'); return;
      }
      if (name === 'events:live:state' && state.status === 'live') {
        const view = validSnapshot(value); if (view) { snapshot = view; publish('live', state.code); }
      }
    }
    function refresh() { return access.resume(); }
    return Object.freeze({ updateAccess, receive, select, operate, refresh, getState: () => state });
  }
  return Object.freeze({ createController, targetKey });
});
