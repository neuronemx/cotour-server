const { isId } = require('./grant-repository');
const { executionKey } = require('./live-runtime');
const COMMANDS = Object.freeze({ 'events:slide:next': 'next', 'events:slide:prev': 'prev', 'events:slide:go': 'go',
  'events:presentation:pause': 'pause', 'events:presentation:play': 'play' });
const NAMES = ['events:live:join', 'events:live:snapshot', ...Object.keys(COMMANDS)];
function createLiveSocketAdapter({ namespace, grants, runtime, credentials, enabled, disconnect }) {
  const bindings = new WeakMap();
  function valid(payload, fields) {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      && Object.keys(payload).length === fields.length && fields.every(key => Object.hasOwn(payload, key));
  }
  function ackError(ack, code) { if (typeof ack === 'function') ack({ ok: false, code }); }
  async function deliver(socket, ack) {
    const liveId = bindings.get(socket);
    if (!socket.connected || !enabled() || !liveId) throw new Error('LIVE_ACCESS_DENIED');
    await runtime.deliver(grants, credentials.get(socket), liveId, snapshot => {
      if (!socket.connected || !enabled()) throw new Error('LIVE_ACCESS_DENIED');
      socket.emit('events:live:state', snapshot);
      if (typeof ack === 'function') ack({ ok: true, snapshot });
    });
  }
  async function review(socket) {
    if (bindings.has(socket)) await runtime.deliver(grants, credentials.get(socket), bindings.get(socket), () => {});
  }
  async function fanout(key) {
    await Promise.all([...namespace.sockets.values()].filter(socket => bindings.has(socket)
      && executionKey(socket.data.eventContext.eventId, bindings.get(socket)) === key).map(async socket => {
      try { await deliver(socket); } catch (_) { if (socket.connected) disconnect(socket); }
    }));
  }
  function attach(socket) {
    let queue = Promise.resolve();
    socket.on('disconnect', () => bindings.delete(socket));
    // Join and commands are ordered even when the client pipelines packets.
    function handler(name, operation) {
      socket.on(name, (payload = {}, ack) => {
        queue = queue.catch(() => {}).then(async () => {
          try {
            if (!socket.connected || !enabled()) throw new Error('LIVE_ACCESS_DENIED');
            await operation(payload, ack);
          } catch (error) {
            const code = ['CONTENT_NOT_PREPARED', 'CONTENT_VERSION_CHANGED', 'LIVE_COMMAND_DENIED', 'INVALID_COMMAND'].includes(error.code) ? error.code : 'LIVE_ACCESS_DENIED';
            ackError(ack, code);
            if (code === 'LIVE_ACCESS_DENIED' && socket.connected) disconnect(socket);
          }
        });
      });
    }
    handler('events:live:join', async (payload, ack) => {
      if (!valid(payload, ['liveSessionId']) || !isId(payload.liveSessionId)
        || (bindings.has(socket) && bindings.get(socket) !== payload.liveSessionId)) throw new Error('LIVE_ACCESS_DENIED');
      await runtime.operate(grants, credentials.get(socket), payload.liveSessionId);
      bindings.set(socket, payload.liveSessionId);
      await deliver(socket, ack);
    });
    handler('events:live:snapshot', async (payload, ack) => {
      if (!valid(payload, []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
      await deliver(socket, ack);
    });
    for (const [name, command] of Object.entries(COMMANDS)) handler(name, async (payload, ack) => {
      if (!valid(payload, command === 'go' ? ['slideIndex'] : []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
      const key = await runtime.operate(grants, credentials.get(socket), bindings.get(socket), command, payload);
      await deliver(socket, ack);
      await fanout(key);
    });
  }
  return { attach, review, names: NAMES };
}
module.exports = { createLiveSocketAdapter };
