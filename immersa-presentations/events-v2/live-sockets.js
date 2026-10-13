const { isId } = require('./grant-repository');
const { executionKey } = require('./live-runtime');
const COMMANDS = Object.freeze({ 'events:slide:next': 'next', 'events:slide:prev': 'prev', 'events:slide:go': 'go',
  'events:presentation:pause': 'pause', 'events:presentation:play': 'play' });
const POLL_COMMANDS = Object.freeze({ 'events:poll:launch': 'launch', 'events:poll:submit': 'submit', 'events:poll:show': 'show', 'events:poll:hide': 'hide', 'events:poll:close': 'close' });
const QNA_COMMANDS = Object.freeze({ 'events:qna:open': 'open', 'events:qna:set_open': 'set_open', 'events:qna:submit': 'submit', 'events:qna:select': 'select', 'events:qna:project': 'project', 'events:qna:delete': 'delete', 'events:qna:new_round': 'new_round', 'events:qna:panel_close': 'panel_close' });
const NAMES = ['events:live:join', 'events:live:snapshot', ...Object.keys(COMMANDS)];
function createLiveSocketAdapter({ namespace, grants, runtime, polls = null, qna = null, credentials, enabled, disconnect }) {
  const bindings = new WeakMap();
  function valid(payload, fields) {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      && Object.keys(payload).length === fields.length && fields.every(key => Object.hasOwn(payload, key));
  }
  function ackError(ack, code) { if (typeof ack === 'function') ack({ ok: false, code }); }
  async function deliver(socket, ack, projectionKind = 'live') {
    const liveId = bindings.get(socket);
    if (!socket.connected || !enabled() || !liveId) throw new Error('LIVE_ACCESS_DENIED');
    await runtime.deliver(grants, credentials.get(socket), liveId, async (snapshot, context, db, prepared) => {
      if (!socket.connected || !enabled()) throw new Error('LIVE_ACCESS_DENIED');
      const questionState = qna ? await qna.projection(context, db, liveId, prepared) : null;
      const poll = polls ? await polls.projection(context, db, liveId, prepared) : null;
      if (!socket.connected || !enabled()) throw new Error('LIVE_ACCESS_DENIED');
      socket.emit('events:live:state', snapshot);
      if (poll) socket.emit('events:poll:state', poll);
      if (questionState) socket.emit('events:qna:state', questionState);
      if (typeof ack === 'function') ack({ ok: true, snapshot: projectionKind === 'qna' ? questionState : projectionKind === 'poll' ? poll : snapshot });
    });
  }
  async function review(socket) {
    if (bindings.has(socket)) await runtime.deliver(grants, credentials.get(socket), bindings.get(socket), async (_snapshot, context, db, prepared) => {
      if (polls) await polls.projection(context, db, bindings.get(socket), prepared);
      if (qna) await qna.projection(context, db, bindings.get(socket), prepared);
    });
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
            const code = ['CONTENT_NOT_PREPARED', 'CONTENT_VERSION_CHANGED', 'LIVE_COMMAND_DENIED', 'INVALID_COMMAND', 'POLL_CONTENT_NOT_PREPARED', 'POLL_COMMAND_DENIED', 'POLL_ALREADY_ACTIVE', 'POLL_NOT_FOUND', 'POLL_NOT_ACTIVE', 'POLL_DUPLICATE_RESPONSE', 'POLL_INVALID_OPTION', 'QNA_COMMAND_DENIED', 'QNA_SESSION_NOT_READY', 'QNA_STALE_ROUND', 'QNA_INVALID_INPUT', 'QNA_CLOSED', 'QNA_COOLDOWN', 'QNA_QUESTION_NOT_FOUND', 'QNA_ALREADY_PROJECTED'].includes(error.code) ? error.code : 'LIVE_ACCESS_DENIED';
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
    if (qna) {
      handler('events:qna:snapshot', async (payload, ack) => {
        if (!valid(payload, []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        await deliver(socket, ack, 'qna');
      });
      for (const [name, command] of Object.entries(QNA_COMMANDS)) handler(name, async (payload, ack) => {
        const fields = command === 'open' ? [] : command === 'submit' ? ['roundId', 'question', 'allowNameOnScreen']
          : command === 'set_open' ? ['roundId', 'open'] : ['select', 'project', 'delete'].includes(command) ? ['roundId', 'questionId'] : ['roundId'];
        const input = command === 'submit' && Object.hasOwn(payload || {}, 'name') ? [...fields, 'name'] : fields;
        if (!valid(payload, input) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        const key = await qna.operate(grants, credentials.get(socket), bindings.get(socket), command, payload);
        await deliver(socket, ack, 'qna');
        await fanout(key);
      });
    }
    if (polls) {
      handler('events:poll:snapshot', async (payload, ack) => {
        if (!valid(payload, []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        await deliver(socket, ack, 'poll');
      });
      for (const [name, command] of Object.entries(POLL_COMMANDS)) handler(name, async (payload, ack) => {
        const fields = command === 'launch' ? ['interactionId'] : command === 'submit' ? ['pollRunId', 'optionId'] : ['pollRunId'];
        if (!valid(payload, fields) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        const key = await polls.operate(grants, credentials.get(socket), bindings.get(socket), command, payload);
        await deliver(socket, ack, 'poll');
        await fanout(key);
      });
    }
    for (const [name, command] of Object.entries(COMMANDS)) handler(name, async (payload, ack) => {
      if (!valid(payload, command === 'go' ? ['slideIndex'] : []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
      const key = await runtime.operate(grants, credentials.get(socket), bindings.get(socket), command, payload);
      await deliver(socket, ack);
      await fanout(key);
    });
  }
  return { attach, review, names: [...NAMES, ...(polls ? ['events:poll:snapshot', ...Object.keys(POLL_COMMANDS)] : []), ...(qna ? ['events:qna:snapshot', ...Object.keys(QNA_COMMANDS)] : [])] };
}
module.exports = { createLiveSocketAdapter };
