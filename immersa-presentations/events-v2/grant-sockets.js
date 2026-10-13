const { sameOrigin } = require('./grant-http');
const { createLiveSocketAdapter } = require('./live-sockets');

function createEventGrantSockets({ io, grants, enabled = () => false, reviewIntervalMs = 5000, runtime = null, polls = null, qna = null, knowledge = null, raffles = null, games = null, time = null, av = null }) {
  const namespace = io.of('/events-v2');
  const credentials = new WeakMap();
  let reviewPromise = null;
  const accessError = () => Object.assign(new Error('EVENT_ACCESS_DENIED'), { data: { code: 'EVENT_ACCESS_DENIED' } });
  const disconnect = socket => { socket.emit('events:access_denied', { code: 'EVENT_ACCESS_DENIED' }); socket.disconnect(true); };
  const live = runtime && createLiveSocketAdapter({ namespace, grants, runtime, polls, qna, knowledge, raffles, games, time, av, credentials, enabled, disconnect });
  async function reviewSocket(socket) {
    try {
      if (!enabled() || !grants) throw accessError();
      const context = await grants.withSession(credentials.get(socket));
      if (socket.connected) socket.data.eventContext = context;
      if (live) await live.review(socket);
    } catch (_) { if (socket.connected) disconnect(socket); }
  }
  function reviewAll() {
    // A membership mutation needs a fresh review even when a periodic review
    // was already in flight before its commit.
    if (reviewPromise) return reviewPromise.then(reviewAll);
    reviewPromise = Promise.all([...namespace.sockets.values()].map(reviewSocket)).finally(() => { reviewPromise = null; });
    return reviewPromise;
  }
  namespace.use(async (socket, next) => {
    try {
      if (!enabled() || !grants || !sameOrigin(socket.handshake.headers.origin, socket.handshake.headers.host)) throw accessError();
      // Explicit allowlist: client roles, participant IDs and room names cannot
      // influence identity. A raw long-link secret is not a socket credential.
      const { eventId, grantId, sessionToken } = socket.handshake.auth || {};
      const credential = Object.freeze({ eventId, grantId, sessionToken });
      const context = await grants.withSession(credential);
      credentials.set(socket, credential);
      socket.data.eventContext = context;
      next();
    } catch (_) { next(accessError()); }
  });
  namespace.on('connection', socket => {
    let closed = false;
    socket.on('disconnect', () => { closed = true; credentials.delete(socket); });
    // Revalidate and emit while holding the same transaction lock as revoke.
    grants.withSession(credentials.get(socket), async context => {
      if (closed || !enabled()) return;
      socket.data.eventContext = context;
      await socket.join(`evt:${context.eventId}:actor:${context.actorId}`);
      if (context.liveSessionId) await socket.join(`evt:${context.eventId}:live:${context.liveSessionId}`);
      // Metadata only; no presentation state, deck, answers, scripts or engines.
      socket.emit('events:context', context);
    }).catch(() => { if (socket.connected) disconnect(socket); });
    socket.on('events:context:get', async (payload, ack) => {
      if (typeof payload === 'function') { ack = payload; payload = {}; }
      try {
        if (!enabled() || closed) throw accessError();
        await grants.withSession(credentials.get(socket), context => {
          if (closed) return;
          // Context is fixed at handshake even when a user has multiple events.
          if (payload && Object.keys(payload).length) throw accessError();
          if (typeof ack === 'function') ack({ ok: true, context });
        });
      } catch (_) {
        if (typeof ack === 'function') ack({ ok: false, code: 'EVENT_ACCESS_DENIED' });
        if (socket.connected) disconnect(socket);
      }
    });
    socket.on('events:session:renew', async (_payload, ack) => {
      try {
        if (!enabled() || closed || (_payload && Object.keys(_payload).length)) throw accessError();
        const context = await grants.renew(credentials.get(socket));
        socket.data.eventContext = context;
        if (!closed && typeof ack === 'function') ack({ ok: true, context });
      } catch (_) { if (socket.connected) disconnect(socket); }
    });
    if (live) live.attach(socket);
    socket.onAny(name => {
      if (!['events:context:get', 'events:session:renew', ...(live?.names || [])].includes(name)) {
        socket.emit('events:command_denied', { code: 'COMMAND_NOT_ENABLED' });
      }
    });
  });
  const timer = setInterval(() => { if (!reviewPromise) reviewAll(); }, reviewIntervalMs);
  timer.unref?.();
  // Namespace rooms are never restored by connection-state recovery. Server
  // currently has recovery disabled; refuse it explicitly for this perimeter.
  if (io.opts.connectionStateRecovery) throw new Error('Events v2 requires fresh authorization on reconnect');
  return {
    namespace,
    reviewAll,
    disconnectGrant(grantId) { for (const socket of namespace.sockets.values()) if (socket.data.eventContext?.grantId === grantId) disconnect(socket); },
    close() { av?.close(); games?.close(); raffles?.close(); knowledge?.close(); clearInterval(timer); for (const socket of namespace.sockets.values()) disconnect(socket); }
  };
}
module.exports = { createEventGrantSockets };
