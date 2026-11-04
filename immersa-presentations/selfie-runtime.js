const crypto = require('node:crypto');

function createSelfieRuntime({ io, coordinator, loadCollection, getRoleRoomKey, getConnectedAudience }) {
  const rounds = new Map();
  const controllers = new Set(['presenter', 'stage']);
  const runtime = { hasActive: sessionId => rounds.has(sessionId) };
  coordinator.registerActivity('selfie', runtime);

  function state(context) {
    const round = rounds.get(context.sessionId);
    if (!round || round.roomKey !== context.roomKey) return { active: false };
    if (context.role !== 'audience') return { active: true, roundId: round.id, collectionSize: round.images.length };
    if (!context.audienceId) return { active: false };
    if (!round.assignments.has(context.audienceId)) {
      // A shuffled cycle keeps the distribution balanced without changing earlier assignments.
      if (!round.remaining.length) {
        round.remaining = round.images.slice();
        for (let i = round.remaining.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [round.remaining[i], round.remaining[j]] = [round.remaining[j], round.remaining[i]];
        }
      }
      round.assignments.set(context.audienceId, round.remaining.pop());
    }
    return { active: true, roundId: round.id, image: round.assignments.get(context.audienceId) };
  }
  function broadcast(context) {
    for (const role of controllers) io.to(getRoleRoomKey(context.roomKey, role)).emit('selfie:state', state({ ...context, role }));
    for (const member of getConnectedAudience(context.roomKey)) {
      io.to(getRoleRoomKey(context.roomKey, 'audience:' + member.audienceId)).emit('selfie:state', state({ ...context, role: 'audience', audienceId: member.audienceId }));
    }
  }
  function resetSession(context) {
    const round = rounds.get(context?.sessionId);
    if (!round || round.roomKey !== context.roomKey) return;
    rounds.delete(context.sessionId);
    broadcast(context);
    coordinator.notifyActivityChange(context.sessionId);
  }
  function attach(socket, getContext) {
    for (const event of ['selfie:start', 'selfie:close']) {
      socket.on(event, async () => {
        const context = getContext();
        const reject = reason => socket.emit('selfie:rejected', { reason });
        if (!context?.roomKey || !context.sessionId || !controllers.has(context.role)) return reject('forbidden');
        try {
          await coordinator.withSessionLock(context.sessionId, async () => {
            if (event === 'selfie:close') return resetSession(context);
            if (runtime.hasActive(context.sessionId)) return socket.emit('selfie:state', state(context));
            if (coordinator.hasAnyActive(context.sessionId)) return reject('active_interaction_exists');
            const collection = await loadCollection(context.deckId);
            // Loading may outlive a disconnect or a switch to another Deck.
            const current = getContext();
            if (current?.roomKey !== context.roomKey || !controllers.has(current.role)) return reject('forbidden');
            if (!collection.images.length) return reject('empty_collection');
            rounds.set(context.sessionId, { id: crypto.randomUUID(), roomKey: context.roomKey, images: collection.images.slice(), assignments: new Map(), remaining: [] });
            broadcast(context);
          });
        } catch (error) {
          console.error('Unable to start Selfie', error);
          reject('unavailable');
        }
      });
    }
  }
  function sendCurrentState(socket, context) {
    if (controllers.has(context?.role) || context?.role === 'audience') socket.emit('selfie:state', state(context));
  }
  return { ...runtime, attach, sendCurrentState, resetSession };
}
module.exports = { createSelfieRuntime };
