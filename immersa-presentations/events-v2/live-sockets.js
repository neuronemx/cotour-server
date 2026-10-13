const { isId } = require('./grant-repository');
const { EventAccessError } = require('./authorization');
const { executionKey } = require('./live-runtime');
const COMMANDS = Object.freeze({ 'events:slide:next': 'next', 'events:slide:prev': 'prev', 'events:slide:go': 'go',
  'events:presentation:pause': 'pause', 'events:presentation:play': 'play' });
const POLL_COMMANDS = Object.freeze({ 'events:poll:launch': 'launch', 'events:poll:submit': 'submit', 'events:poll:show': 'show', 'events:poll:hide': 'hide', 'events:poll:close': 'close' });
const QNA_COMMANDS = Object.freeze({ 'events:qna:open': 'open', 'events:qna:set_open': 'set_open', 'events:qna:submit': 'submit', 'events:qna:select': 'select', 'events:qna:project': 'project', 'events:qna:delete': 'delete', 'events:qna:new_round': 'new_round', 'events:qna:panel_close': 'panel_close' });
const KNOWLEDGE_COMMANDS = Object.freeze(Object.fromEntries(['open', 'start', 'finalize', 'cancel', 'show_results', 'close', 'retry_processing', 'force_results', 'join', 'claim_tab', 'answer', 'submit'].map(command => [`events:knowledge:${command}`, command])));
const RAFFLE_COMMANDS = Object.freeze(Object.fromEntries(['configure_key', 'open', 'enter', 'submit_poll_response', 'close_entries', 'draw', 'reveal', 'close', 'reset_winners'].map(command => [`events:raffle:${command}`, command])));
const NAMES = ['events:live:join', 'events:live:snapshot', ...Object.keys(COMMANDS)];
function createLiveSocketAdapter({ namespace, grants, runtime, polls = null, qna = null, knowledge = null, raffles = null, credentials, enabled, disconnect }) {
  const bindings = new WeakMap();
  function valid(payload, fields) {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      && Object.keys(payload).length === fields.length && fields.every(key => Object.hasOwn(payload, key));
  }
  function ackError(ack, code) { if (typeof ack === 'function') ack({ ok: false, code }); }
  async function deliver(socket, ack, projectionKind = 'live') {
    const liveId = bindings.get(socket);
    if (!socket.connected || !enabled() || !liveId) throw new Error('LIVE_ACCESS_DENIED');
    if (knowledge) await knowledge.operate(grants, credentials.get(socket), liveId, 'tick');
    if (raffles) await raffles.operate(grants, credentials.get(socket), liveId, 'tick');
    await runtime.deliver(grants, credentials.get(socket), liveId, async (snapshot, context, db, prepared) => {
      if (!socket.connected || !enabled()) throw new Error('LIVE_ACCESS_DENIED');
      const questionState = qna ? await qna.projection(context, db, liveId, prepared) : null;
      const poll = polls ? await polls.projection(context, db, liveId, prepared) : null;
      const raffle = raffles ? await raffles.projection(context, db, liveId, prepared) : null;
      const activity = knowledge ? await knowledge.projection(context, db, liveId, prepared, socket.id) : null;
      if (!socket.connected || !enabled()) throw new Error('LIVE_ACCESS_DENIED');
      socket.emit('events:live:state', snapshot);
      if (poll) socket.emit('events:poll:state', poll);
      if (questionState) socket.emit('events:qna:state', questionState);
      if (activity) socket.emit('events:knowledge:state', activity);
      if (raffle) socket.emit('events:raffle:state', raffle);
      if (typeof ack === 'function') ack({ ok: true, snapshot: projectionKind === 'raffle' ? raffle : projectionKind === 'knowledge' ? activity : projectionKind === 'qna' ? questionState : projectionKind === 'poll' ? poll : snapshot });
    });
  }
  async function review(socket) {
    if (bindings.has(socket)) await runtime.deliver(grants, credentials.get(socket), bindings.get(socket), async (_snapshot, context, db, prepared) => {
      if (polls) await polls.projection(context, db, bindings.get(socket), prepared);
      if (qna) await qna.projection(context, db, bindings.get(socket), prepared);
      if (knowledge) await knowledge.projection(context, db, bindings.get(socket), prepared);
      if (raffles) await raffles.projection(context, db, bindings.get(socket), prepared);
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
            const code = ['CONTENT_NOT_PREPARED', 'CONTENT_VERSION_CHANGED', 'LIVE_COMMAND_DENIED', 'INVALID_COMMAND', 'POLL_CONTENT_NOT_PREPARED', 'POLL_COMMAND_DENIED', 'POLL_ALREADY_ACTIVE', 'POLL_NOT_FOUND', 'POLL_NOT_ACTIVE', 'POLL_DUPLICATE_RESPONSE', 'POLL_INVALID_OPTION', 'QNA_COMMAND_DENIED', 'QNA_SESSION_NOT_READY', 'QNA_STALE_ROUND', 'QNA_INVALID_INPUT', 'QNA_CLOSED', 'QNA_COOLDOWN', 'QNA_QUESTION_NOT_FOUND', 'QNA_ALREADY_PROJECTED', 'INTERACTION_BUSY', 'KNOWLEDGE_CONTENT_NOT_PREPARED', 'KNOWLEDGE_COMMAND_DENIED', 'KNOWLEDGE_INVALID_INPUT', 'KNOWLEDGE_STALE_EXECUTION', 'KNOWLEDGE_STALE_REVISION', 'KNOWLEDGE_DEFINITION_NOT_FOUND', 'KNOWLEDGE_NOT_ACTIVE'].includes(error.code) ? error.code : 'LIVE_ACCESS_DENIED';
            const knowledgeCode = name.startsWith('events:knowledge:') && ['INVALID_STATE', 'INVALID_NAME', 'NO_READY_PARTICIPANTS', 'PARTICIPANT_NOT_FOUND', 'TAB_NOT_ACTIVE', 'QUESTION_NOT_FOUND', 'OPTION_NOT_FOUND', 'DEADLINE_PASSED', 'DUPLICATE', 'NO_CONFIRMED_ANSWERS'].includes(error.code) ? `KNOWLEDGE_${error.code}` : code;
            const raffleCode = name.startsWith('events:raffle:') && error instanceof EventAccessError && error.code.startsWith('RAFFLE_')
              && error.code !== 'RAFFLE_STATE_INVALID' ? error.code : knowledgeCode;
            ackError(ack, raffleCode);
            if (raffleCode === 'LIVE_ACCESS_DENIED' && socket.connected) disconnect(socket);
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
    if (raffles) {
      handler('events:raffle:snapshot', async (payload, ack) => {
        if (!valid(payload, []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        await deliver(socket, ack, 'raffle');
      });
      for (const [name, command] of Object.entries(RAFFLE_COMMANDS)) handler(name, async (payload, ack) => {
        const fields = command === 'open' ? ['definitionId'] : command === 'configure_key' ? ['definitionId', 'optionId'] : ['raffleRunId'];
        const input = ['enter', 'submit_poll_response'].includes(command) ? [...fields,
          ...(Object.hasOwn(payload || {}, 'optionId') ? ['optionId'] : []), ...(Object.hasOwn(payload || {}, 'name') ? ['name'] : [])] : fields;
        if (!valid(payload, input) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        const key = await raffles.operate(grants, credentials.get(socket), bindings.get(socket), command, payload);
        await deliver(socket, ack, 'raffle'); await fanout(key);
      });
    }
    if (knowledge) {
      handler('events:knowledge:snapshot', async (payload, ack) => {
        if (!valid(payload, []) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        await deliver(socket, ack, 'knowledge');
      });
      for (const [name, command] of Object.entries(KNOWLEDGE_COMMANDS)) handler(name, async (payload, ack) => {
        const fields = command === 'open' ? ['definitionId'] : ['join', 'claim_tab'].includes(command) ? ['executionId']
          : command === 'answer' ? ['executionId', 'questionId', 'optionId', 'attemptId']
          : command === 'submit' ? ['executionId'] : ['executionId', 'expectedRevision'];
        const input = command === 'join' && Object.hasOwn(payload || {}, 'name') ? [...fields, 'name'] : fields;
        if (!valid(payload, input) || !bindings.has(socket)) throw new Error('LIVE_ACCESS_DENIED');
        const key = await knowledge.operate(grants, credentials.get(socket), bindings.get(socket), command, { ...payload, tabId: socket.id });
        await deliver(socket, ack, 'knowledge'); await fanout(key);
      });
    }
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
  if (raffles) {
    raffles.notify = fanout;
    raffles.connected = async (db, context, liveId) => {
      const participants = new Set();
      // Presence is a fresh SQL-authorized view of fixed live bindings. Reuse
      // the drawing transaction so revoke/access changes cannot race selection.
      for (const peer of namespace.sockets.values()) {
        const credential = credentials.get(peer);
        if (!peer.connected || bindings.get(peer) !== liveId || credential?.eventId !== context.eventId) continue;
        try {
          const { context: current } = await grants.sessionOn(db, credential, context.organizationId);
          if (current.kind !== 'PARTICIPANT') continue;
          await runtime.resolve(current, db, liveId);
          if (peer.connected && enabled()) participants.add(current.participantId);
        } catch (error) { if (!(error instanceof EventAccessError)) throw error; }
      }
      if (!enabled()) throw new Error('LIVE_ACCESS_DENIED');
      return [...participants];
    };
  }
  if (knowledge) knowledge.notify = fanout;
  return { attach, review, names: [...NAMES, ...(polls ? ['events:poll:snapshot', ...Object.keys(POLL_COMMANDS)] : []), ...(qna ? ['events:qna:snapshot', ...Object.keys(QNA_COMMANDS)] : []), ...(knowledge ? ['events:knowledge:snapshot', ...Object.keys(KNOWLEDGE_COMMANDS)] : []), ...(raffles ? ['events:raffle:snapshot', ...Object.keys(RAFFLE_COMMANDS)] : [])] };
}
module.exports = { createLiveSocketAdapter };
