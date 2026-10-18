(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(() => require('./av-console'));
  else root.ImmersaEventAccess = factory(() => root.ImmersaEventAVConsole);
})(typeof window === 'object' ? window : this, function (getAV) {
  'use strict';
  const kinds = Object.freeze({ stage: 'STAGE', speaker: 'SPEAKER', screen: 'PLAYER', audience: 'PARTICIPANT' });
  const id = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
  const secret = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
  const failure = (code, retryable = false) => Object.assign(new Error(code), { code, retryable });

  function consumeLink(location, history) {
    const { pathname, hash, search } = location;
    // Strip even invalid fragments before any asynchronous work. The secret is
    // never sent in a request URL, retained in history state or persisted.
    history.replaceState(null, '', pathname);
    if (location.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw failure('SECURE_ORIGIN_REQUIRED');
    const match = /^\/events-v2\/console\/(stage|speaker|screen|audience)\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/?$/i.exec(pathname);
    if (!match || search) throw failure('INVALID_ACCESS_LINK');
    const view = match[1].toLowerCase();
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    if ([...params.keys()].some(key => key !== 'token' && key !== 'activity') || params.getAll('token').length > 1
      || params.getAll('activity').length > 1 || (params.has('activity') && (view !== 'stage' || !id(params.get('activity'))))
      || (hash && !secret(params.get('token')))) throw failure('INVALID_ACCESS_LINK');
    return { binding: Object.freeze({ view, eventId: match[2].toLowerCase(), grantId: match[3].toLowerCase() }), token: params.get('token') || null,
      activityId: params.get('activity')?.toLowerCase() || null };
  }

  function createClient({ binding, fetch, io, onState = () => {}, onEvent = () => {}, now = Date.now,
    setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, requestTimeoutMs = 10000, retryDelayMs = 1000 }) {
    if (!binding || !Object.hasOwn(kinds, binding.view) || !id(binding.eventId) || !id(binding.grantId)) throw failure('INVALID_ACCESS_LINK');
    binding = Object.freeze({ view: binding.view, eventId: binding.eventId, grantId: binding.grantId });
    const accessPath = '/api/events-v2/access/' + binding.eventId + '/' + binding.grantId;
    let status = Object.freeze({ status: 'idle', context: null, eventName: null });
    let epoch = 0, stopped = false, socket = null, credential = null, identity = null, bootstrapToken = null;
    let retryTimer = null, renewTimer = null, connectTimer = null, ackTimer = null, attempts = 0, pending = null;
    const requests = new Set(), commands = new Set();
    let targets = [];
    function publish(state, context = null, eventName = null) {
      status = Object.freeze({ status: state, context: context && Object.freeze({ ...context }), eventName,
        generation: epoch, targets: Object.freeze(state === 'ready' ? targets : []) });
      onState(status);
    }
    function clearTimers() {
      for (const timer of [retryTimer, renewTimer, connectTimer, ackTimer]) if (timer !== null) clearTimeoutFn(timer);
      retryTimer = renewTimer = connectTimer = ackTimer = null;
    }
    function dropSocket() {
      const old = socket; socket = null; credential = null; targets = [];
      for (const entry of [...commands]) entry.finish(failure('COMMAND_INTERRUPTED'));
      if (old) {
        if (old.auth && typeof old.auth === 'object') for (const key of Object.keys(old.auth)) delete old.auth[key];
        old.auth = {}; old.removeAllListeners(); old.disconnect();
      }
    }
    function validContext(context) {
      if (!context || context.eventId !== binding.eventId || context.grantId !== binding.grantId
        || context.kind !== kinds[binding.view] || !id(context.actorId) || !id(context.organizationId)
        || !Number.isFinite(Date.parse(context.expiresAt)) || Date.parse(context.expiresAt) <= now()) throw failure('ACCESS_DENIED');
      const purposes = { STAGE: ['live'], SPEAKER: ['live', 'rehearsal'], PLAYER: ['player'], PARTICIPANT: ['public'] };
      if (!purposes[context.kind].includes(context.purpose)) throw failure('ACCESS_DENIED');
      const fixed = JSON.stringify(['eventId', 'organizationId', 'grantId', 'actorId', 'kind', 'purpose', 'stageId', 'activityId', 'liveSessionId', 'participantId'].map(key => context[key] || null));
      if (identity !== null && identity !== fixed) throw failure('ACCESS_DENIED');
      return fixed;
    }
    function current(version) { return !stopped && version === epoch; }
    function validateTargets(items, context) {
      if (!Array.isArray(items) || items.length > 500) throw failure('INVALID_ACCESS_RESPONSE');
      return items.map(item => {
        if (!item || item.eventId !== binding.eventId || !id(item.activityId) || !id(item.stageId)
          || (item.liveSessionId !== null && !id(item.liveSessionId)) || typeof item.title !== 'string' || item.title.length > 191
          || typeof item.stageTitle !== 'string' || item.stageTitle.length > 120 || !['FREE', 'PAID'].includes(item.accessLevel)
          || !['SCHEDULED', 'LIVE'].includes(item.status) || typeof item.canStart !== 'boolean'
          || (item.status === 'LIVE') !== Boolean(item.liveSessionId)
          || (context.stageId && context.stageId !== item.stageId) || (context.activityId && context.activityId !== item.activityId)
          || (context.liveSessionId && context.liveSessionId !== item.liveSessionId)
          || (context.kind === 'PARTICIPANT' && (!item.liveSessionId || (context.audienceLevel !== 'PAID' && item.accessLevel !== 'FREE')))
          || (item.canStart && (context.kind !== 'STAGE' || item.liveSessionId || context.purpose !== 'live'))
          || (context.kind === 'SPEAKER' && context.purpose !== 'live')) throw failure('ACCESS_DENIED');
        return Object.freeze({ eventId: item.eventId, activityId: item.activityId, stageId: item.stageId,
          liveSessionId: item.liveSessionId, title: item.title, stageTitle: item.stageTitle,
          accessLevel: item.accessLevel, status: item.status, canStart: item.canStart });
      });
    }
    function command(name, payload = {}) {
      const fields = { 'events:live:join': ['liveSessionId'], 'events:live:snapshot': [],
        'events:slide:next': [], 'events:slide:prev': [], 'events:slide:go': ['slideIndex'],
        'events:presentation:pause': [], 'events:presentation:play': [],
        'events:lifecycle:start': ['activityId'], 'events:lifecycle:finish': [],
        'events:poll:snapshot': [], 'events:poll:launch': ['interactionId'],
        'events:poll:submit': ['pollRunId', 'optionId'], 'events:poll:show': ['pollRunId'],
        'events:poll:hide': ['pollRunId'], 'events:poll:close': ['pollRunId'],
        'events:qna:snapshot': [], 'events:qna:open': [], 'events:qna:set_open': ['roundId', 'open'],
        'events:qna:submit': ['roundId', 'question', 'allowNameOnScreen'],
        'events:qna:select': ['roundId', 'questionId'], 'events:qna:project': ['roundId', 'questionId'],
        'events:qna:delete': ['roundId', 'questionId'], 'events:qna:new_round': ['roundId'], 'events:qna:panel_close': ['roundId'],
        'events:knowledge:snapshot': [], 'events:knowledge:open': ['definitionId'],
        ...Object.fromEntries(['start','finalize','cancel','show_results','close','retry_processing','force_results'].map(action => ['events:knowledge:' + action, ['executionId','expectedRevision']])),
        'events:knowledge:join': ['executionId'], 'events:knowledge:claim_tab': ['executionId'],
        'events:knowledge:answer': ['executionId','questionId','optionId','attemptId'], 'events:knowledge:submit': ['executionId'],
        'events:game:snapshot': [], 'events:game:configure': ['expectedRevision','selected'], 'events:game:start_queue': ['expectedRevision'],
        'events:game:skip': ['expectedRevision','queueRunId'], 'events:game:end': ['expectedRevision','queueRunId'],
        ...Object.fromEntries(['start','pause','resume'].map(action=>['events:game:'+action,['gameRunId']])),
        'events:game:team_names': ['gameRunId','left','right'], 'events:game:join_team': ['gameRunId','team'], 'events:game:input': ['gameRunId','direction'],
        'events:slides:snapshot': ['language'], 'events:time:snapshot': [], 'events:time:control': ['target','action','expectedRevision'],
        'events:raffle:snapshot': [], 'events:raffle:open': ['definitionId'], 'events:raffle:configure_key': ['definitionId','optionId'],
        ...Object.fromEntries(['enter','submit_poll_response','close_entries','draw','reveal','close','reset_winners'].map(action => ['events:raffle:'+action,['raffleRunId']])) };
      if (name === 'events:time:control' && payload?.target === 'screen' && payload.action === 'start') {
        fields[name] = [...fields[name], 'mode', ...(payload.mode === 'countdown' ? ['hours','minutes','seconds'] : [])];
      }
      if (['events:raffle:enter','events:raffle:submit_poll_response'].includes(name)) for (const key of ['optionId','name']) if (Object.hasOwn(payload || {}, key)) fields[name] = [...fields[name], key];
      if (name === 'events:knowledge:join' && Object.hasOwn(payload || {}, 'name')) fields[name] = [...fields[name], 'name'];
      if (name === 'events:qna:submit' && Object.hasOwn(payload || {}, 'name')) fields[name] = [...fields[name], 'name'];
      if (name.startsWith('events:av:')) {
        const action = name.slice(10);
        if (!['snapshot','control','audio_react','overlay','draw','clear_message','clear_screen','react','ended','playlist_advance'].includes(action)) return Promise.reject(failure('COMMAND_NOT_ENABLED'));
        if (!getAV().validCommand(action, payload)) return Promise.reject(failure('INVALID_COMMAND'));
        fields[name] = Object.keys(payload);
      }
      if (!Object.hasOwn(fields, name)) return Promise.reject(failure('COMMAND_NOT_ENABLED'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== fields[name].length
        || fields[name].some(key => !Object.hasOwn(payload, key))
        || (name === 'events:live:join' && !id(payload.liveSessionId))
        || (name === 'events:lifecycle:start' && !id(payload.activityId))
        || (name.startsWith('events:poll:') && fields[name].some(key =>
          key === 'pollRunId' ? !id(payload[key]) : typeof payload[key] !== 'string' || !payload[key].trim() || payload[key].length > 120))
        || (name.startsWith('events:qna:') && fields[name].some(key =>
          ['roundId', 'questionId'].includes(key) ? !id(payload[key])
            : ['open', 'allowNameOnScreen'].includes(key) ? typeof payload[key] !== 'boolean'
              : typeof payload[key] !== 'string' || payload[key].length > (key === 'name' ? 120 : 1000)
                || (key === 'question' && !payload[key].trim())))
        || (name.startsWith('events:knowledge:') && fields[name].some(key => key === 'executionId' ? !id(payload[key])
          : key === 'expectedRevision' ? !Number.isSafeInteger(payload[key]) || payload[key] < 0
            : typeof payload[key] !== 'string' || payload[key].length > (key === 'name' ? 120 : 96)
              || (key !== 'name' && (!payload[key].trim() || payload[key] !== payload[key].trim()))))
        || (name.startsWith('events:raffle:') && fields[name].some(key => key === 'raffleRunId' ? !id(payload[key])
          : typeof payload[key] !== 'string' || payload[key].length > (key === 'name' ? 120 : 96)
            || (key !== 'name' && (!payload[key].trim() || payload[key] !== payload[key].trim()))))
        || (name.startsWith('events:game:') && fields[name].some(key => key === 'expectedRevision' ? !Number.isSafeInteger(payload[key]) || payload[key] < 0
          : ['gameRunId','queueRunId'].includes(key) ? !id(payload[key])
          : key === 'selected' ? !Array.isArray(payload[key]) || payload[key].length > 2 || new Set(payload[key]).size !== payload[key].length || payload[key].some(v=>!['breakout','pong'].includes(v))
          : key === 'team' ? !['left','right'].includes(payload[key]) : key === 'direction' ? !['left','right','up','down'].includes(payload[key])
          : typeof payload[key] !== 'string' || !payload[key].trim() || Array.from(payload[key]).length > 24))
        || (name === 'events:time:control' && (!['speaker','screen'].includes(payload.target)
          || !(payload.target === 'speaker' ? ['start','stop','reset'] : ['start','stop','resume','reset','hide']).includes(payload.action)
          || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0
          || (payload.target === 'screen' && payload.action === 'start' && (!['stopwatch','countdown','clock'].includes(payload.mode)
            || (payload.mode === 'countdown' && (![['hours',99],['minutes',59],['seconds',59]].every(([k,max])=>Number.isSafeInteger(payload[k]) && payload[k]>=0 && payload[k]<=max) || payload.hours+payload.minutes+payload.seconds===0))))))
        || (name === 'events:slides:snapshot' && !['es','en'].includes(payload.language))
        || (name === 'events:slide:go' && (!Number.isSafeInteger(payload.slideIndex) || payload.slideIndex < 0))) return Promise.reject(failure('INVALID_COMMAND'));
      if (status.status !== 'ready' || !socket || stopped) return Promise.reject(failure('COMMAND_NOT_READY'));
      const s = socket, version = epoch, copy = { ...payload };
      return new Promise((resolve, reject) => {
        const entry = { timer: null, finish: (error, result) => {
          if (!commands.delete(entry)) return;
          clearTimeoutFn(entry.timer); error ? reject(error) : resolve(result);
        } };
        commands.add(entry);
        entry.timer = setTimeoutFn(() => { entry.finish(failure('COMMAND_ACK_TIMEOUT')); recover(s, version); }, requestTimeoutMs);
        s.emit(name, copy, result => {
          if (socket !== s || !current(version)) return entry.finish(failure('COMMAND_INTERRUPTED'));
          if (!result || typeof result.ok !== 'boolean') { entry.finish(failure('INVALID_COMMAND_RESPONSE')); return recover(s, version); }
          entry.finish(null, result);
        });
      });
    }
    async function request(path, method, body) {
      const abort = new AbortController(); requests.add(abort);
      const timer = setTimeoutFn(() => abort.abort(), requestTimeoutMs);
      try {
        const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
          headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal });
        if (!response.ok) throw failure('ACCESS_UNAVAILABLE', response.status === 429 || response.status >= 500);
        try { return await response.json(); } catch (_) { throw failure('INVALID_ACCESS_RESPONSE'); }
      } catch (error) {
        if (error.code) throw error;
        throw failure('ACCESS_UNAVAILABLE', true);
      } finally { clearTimeoutFn(timer); requests.delete(abort); }
    }
    function denied() {
      epoch++; bootstrapToken = null; clearTimers(); dropSocket();
      for (const request of requests) request.abort();
      publish('denied');
    }
    function retry(version) {
      if (!current(version)) return;
      clearTimers(); dropSocket(); publish('retrying');
      const delay = Math.min(30000, retryDelayMs * (2 ** Math.min(attempts++, 5)));
      retryTimer = setTimeoutFn(() => { retryTimer = null; resume(); }, delay);
    }
    function recover(s, version) {
      if (socket !== s || !current(version)) return;
      // No cached context remains usable while disconnected. Reconnect always
      // uses a freshly checked browser cookie, never the old short credential.
      retry(version);
    }
    function scheduleRenew(s, version, expiresAt) {
      if (renewTimer !== null) clearTimeoutFn(renewTimer);
      const expiry = Math.min(Date.parse(expiresAt), Date.parse(credential.context.expiresAt));
      if (!Number.isFinite(expiry) || expiry <= now()) return recover(s, version);
      const remaining = expiry - now();
      renewTimer = setTimeoutFn(() => {
        renewTimer = null;
        if (socket !== s || !current(version)) return;
        let acknowledged = false;
        ackTimer = setTimeoutFn(() => { ackTimer = null; if (!acknowledged) recover(s, version); }, requestTimeoutMs);
        s.emit('events:session:renew', {}, result => {
          acknowledged = true;
          if (socket !== s || !current(version)) return;
          if (ackTimer !== null) clearTimeoutFn(ackTimer);
          ackTimer = null;
          try {
            if (!result?.ok) throw failure('ACCESS_DENIED');
            validContext(result.context);
            targets = validateTargets(targets, result.context);
            credential.context = result.context;
            publish('ready', result.context, status.eventName);
            scheduleRenew(s, version, result.context.sessionExpiresAt);
          } catch (_) { denied(); }
        });
      }, remaining <= 1000 ? remaining + 1 : Math.max(1000, remaining - Math.min(60000, remaining / 2)));
    }
    async function begin(token) {
      const version = ++epoch;
      clearTimers(); dropSocket(); publish('connecting');
      try {
        let session;
        if (token !== null && token !== undefined) {
          if (!secret(token)) throw failure('INVALID_ACCESS_LINK');
          session = await request('/api/events-v2/access/exchange', 'POST', { eventId: binding.eventId, token });
          token = bootstrapToken = null;
        } else session = await request(accessPath + '/renew', 'POST', {});
        if (!current(version)) return;
        const fixed = validContext(session.context);
        if (!secret(session.sessionToken) || !Number.isFinite(Date.parse(session.sessionExpiresAt))
          || Date.parse(session.sessionExpiresAt) <= now() || Date.parse(session.sessionExpiresAt) > Date.parse(session.context.expiresAt)) throw failure('INVALID_ACCESS_RESPONSE');
        const metadata = await request(accessPath + '/console/' + binding.view, 'GET');
        if (!current(version)) return;
        if (metadata.view !== binding.view || metadata.event?.eventId !== binding.eventId
          || typeof metadata.event.title !== 'string' || validContext(metadata.context) !== fixed) throw failure('ACCESS_DENIED');
        identity = fixed;
        targets = validateTargets(metadata.targets || [], session.context);
        credential = { context: session.context, sessionToken: session.sessionToken };
        const s = io('/events-v2', { autoConnect: false, reconnection: false, forceNew: true, withCredentials: true,
          auth: { eventId: binding.eventId, grantId: binding.grantId, sessionToken: credential.sessionToken } });
        session.sessionToken = null;
        socket = s;
        s.on('events:context', context => {
          if (socket !== s || !current(version)) return;
          try {
            validContext(context);
            targets = validateTargets(targets, context);
            if (connectTimer !== null) clearTimeoutFn(connectTimer);
            connectTimer = null; attempts = 0;
            credential.context = context;
            publish('ready', context, metadata.event.title);
            scheduleRenew(s, version, context.sessionExpiresAt || session.sessionExpiresAt);
          } catch (_) { denied(); }
        });
        for (const name of ['connect_error', 'disconnect', 'events:access_denied']) s.on(name, () => recover(s, version));
        for (const name of ['events:live:state', 'events:lifecycle:finished', 'events:poll:state', 'events:qna:state', 'events:knowledge:state', 'events:raffle:state', 'events:game:state', 'events:time:state', 'events:av:state', 'events:av:reaction']) s.on(name, value => {
          if (socket === s && current(version) && status.status === 'ready') onEvent(name, value);
        });
        connectTimer = setTimeoutFn(() => recover(s, version), requestTimeoutMs);
        s.connect();
      } catch (error) {
        if (!current(version)) return;
        if (error.retryable) retry(version); else denied();
      } finally { token = null; }
    }
    function run(token) {
      if (stopped || status.status === 'denied') return Promise.resolve();
      if (pending) return pending;
      if (status.status === 'idle' && token !== null && token !== undefined) bootstrapToken = token;
      pending = begin(bootstrapToken).finally(() => { pending = null; });
      return pending;
    }
    function resume() { return run(null); }
    function close() {
      if (stopped) return;
      stopped = true; epoch++; bootstrapToken = null; clearTimers(); dropSocket();
      for (const request of requests) request.abort();
      publish('closed');
    }
    return Object.freeze({ start: run, resume, close, command, getState: () => status });
  }
  return Object.freeze({ consumeLink, createClient });
});
