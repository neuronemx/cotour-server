const { createPresentationLifecycleRuntime, PresentationLifecycleError } = require('./presentation-lifecycle');

// State belongs to the existing live room and is never written to a repository.
function createNonRecordingLifecycle({ io, getRoleRoomKey, getSession, onFinish = () => {}, logger = console }) {
  function room(payload) {
    const session = getSession(payload);
    if (!session) throw new PresentationLifecycleError('ROOM_UNAVAILABLE', 'Presentation room is unavailable');
    return session;
  }
  function snapshot(session) {
    return { available: true, mode: session.nonRecordingLifecycle?.mode || 'test', startedAt: session.nonRecordingLifecycle?.startedAt || null, presentationSessionId: null, recorded: false };
  }
  return createPresentationLifecycleRuntime({
    io, getRoleRoomKey, logger,
    repository: {
      async state(payload) { return snapshot(room(payload)); },
      async start(payload) {
        const session = room(payload);
        session.nonRecordingLifecycle = { mode: 'live', startedAt: new Date().toISOString() };
        if (session.reactions) session.reactions.accepting = true;
        return snapshot(session);
      },
      async finish(payload) {
        const session = room(payload);
        if (session.nonRecordingLifecycle?.mode !== 'live') throw new PresentationLifecycleError('NOT_LIVE', 'Presentation is not live');
        delete session.nonRecordingLifecycle;
        session.reactions?.resetCounts(null);
        if (session.reactions) session.reactions.accepting = false;
        return snapshot(session);
      }
    },
    afterFinish: async context => {
      await onFinish(context);
      return { reason: context.finishReason || 'FINISHED', deckId: context.deckId, presentationSessionId: null, recorded: false };
    }
  });
}

module.exports = { createNonRecordingLifecycle };
