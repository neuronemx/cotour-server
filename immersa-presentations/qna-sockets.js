const { QnaError } = require("./db/qna-repository");

const CONTROL_ROLES = new Set(["presenter", "stage"]);

function createQnaSocketHandlers({
  io,
  repository,
  getRoleRoomKey,
  getRoomKey = (sessionId, deckId) => `${sessionId}::${deckId}`,
  resolvePresentationSessionId,
  getConnectedAudience = () => []
}) {
  if (!io?.to || !repository || !getRoleRoomKey || !resolvePresentationSessionId) {
    throw new Error("Q&A socket dependencies are required");
  }

  const screenState = new Map();

  function reject(socket, event, reason) {
    socket.emit("qna:rejected", { event, reason });
  }

  function publicReason(error) {
    if (error instanceof QnaError) return error.code;
    console.error("Q&A socket operation failed", error);
    return "QNA_UNAVAILABLE";
  }

  function canControl(context) {
    return CONTROL_ROLES.has(context?.role);
  }

  async function resolvedContext(getContext) {
    const context = getContext();
    if (!context?.roomKey || !context?.sessionId || !context?.role) return null;
    const presentationSessionId = await resolvePresentationSessionId(context);
    if (!presentationSessionId) return null;
    return { ...context, presentationSessionId };
  }

  function screenRecord(presentationSessionId) {
    const key = String(presentationSessionId);
    if (!screenState.has(key)) screenState.set(key, { questionId: null, visible: false });
    return screenState.get(key);
  }

  function controllerPayload(state, presentationSessionId) {
    const screen = screenRecord(presentationSessionId);
    return {
      ...state,
      screen: { visible: screen.visible, questionId: screen.questionId }
    };
  }

  function screenPayload(state, presentationSessionId) {
    const screen = screenRecord(presentationSessionId);
    const question = screen.questionId
      ? state.questions.find((item) => item.id === screen.questionId)
      : null;
    if (!screen.visible || !question) return { visible: false, question: null };
    return {
      visible: true,
      question: {
        id: question.id,
        text: question.text,
        name: question.allowNameOnScreen ? question.name : ""
      }
    };
  }

  function emitControllerState(context, state) {
    const payload = controllerPayload(state, context.presentationSessionId);
    io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("qna:state", payload);
    io.to(getRoleRoomKey(context.roomKey, "stage")).emit("qna:state", payload);
  }

  function emitScreenState(context, state) {
    const payload = screenPayload(state, context.presentationSessionId);
    io.to(getRoleRoomKey(context.roomKey, "screen")).emit("qna:screen", payload);
    io.to(getRoleRoomKey(context.roomKey, "viewer")).emit("qna:screen", payload);
  }

  async function audiencePayload(context, audienceId) {
    const state = await repository.getAudienceState({
      presentationSessionId: context.presentationSessionId,
      audienceId
    });
    return {
      roundNumber: state.roundNumber,
      questionsOpen: state.questionsOpen,
      hasSubmitted: state.hasSubmitted
    };
  }

  async function emitAudienceStates(context) {
    const audience = getConnectedAudience(context.roomKey);
    await Promise.all(audience.map(async (member) => {
      const audienceId = String(member?.audienceId || member?.id || "");
      if (!audienceId) return;
      const payload = await audiencePayload(context, audienceId);
      io.to(getRoleRoomKey(context.roomKey, `audience:${audienceId}`)).emit("qna:state", payload);
    }));
  }

  async function emitAllStates(context) {
    const state = await repository.getActiveState(context.presentationSessionId);
    emitControllerState(context, state);
    emitScreenState(context, state);
    await emitAudienceStates(context);
    return state;
  }

  function attach(socket, getContext) {
    function action(event, permission, operation) {
      socket.on(event, async (payload = {}) => {
        let context;
        try {
          context = await resolvedContext(getContext);
          if (!context) return reject(socket, event, "QNA_SESSION_NOT_READY");
          if (!permission(context)) return reject(socket, event, "QNA_FORBIDDEN");
          await operation(context, payload);
        } catch (error) {
          reject(socket, event, publicReason(error));
        }
      });
    }

    action("qna:set_open", canControl, async (context, payload) => {
      await repository.setQuestionsOpen({
        presentationSessionId: context.presentationSessionId,
        open: Boolean(payload.open)
      });
      await emitAllStates(context);
    });

    action("qna:submit", (context) => context.role === "audience", async (context, payload) => {
      await repository.submitQuestion({
        presentationSessionId: context.presentationSessionId,
        audienceId: context.audienceId,
        questionText: payload.question,
        name: payload.name,
        allowNameOnScreen: Boolean(payload.allowNameOnScreen)
      });
      socket.emit("qna:submitted", { message: "Tu pregunta ha sido enviada" });
      socket.emit("qna:state", await audiencePayload(context, context.audienceId));
      const state = await repository.getActiveState(context.presentationSessionId);
      emitControllerState(context, state);
    });

    action("qna:select", canControl, async (context, payload) => {
      await repository.selectQuestion({
        presentationSessionId: context.presentationSessionId,
        questionId: payload.questionId
      });
      await emitAllStates(context);
    });

    action("qna:project", canControl, async (context, payload) => {
      await repository.projectQuestion({
        presentationSessionId: context.presentationSessionId,
        questionId: payload.questionId
      });
      screenState.set(String(context.presentationSessionId), {
        questionId: String(payload.questionId || ""),
        visible: true
      });
      await emitAllStates(context);
    });

    action("qna:delete", canControl, async (context, payload) => {
      await repository.deleteQuestion({
        presentationSessionId: context.presentationSessionId,
        questionId: payload.questionId
      });
      await emitAllStates(context);
    });

    action("qna:new_round", canControl, async (context) => {
      await repository.newRound({ presentationSessionId: context.presentationSessionId });
      screenState.set(String(context.presentationSessionId), { questionId: null, visible: false });
      await emitAllStates(context);
    });

    action("qna:panel_close", canControl, async (context) => {
      const screen = screenRecord(context.presentationSessionId);
      screen.visible = false;
      const state = await repository.getActiveState(context.presentationSessionId);
      emitControllerState(context, state);
      emitScreenState(context, state);
    });

    action("qna:panel_open", canControl, async (context) => {
      const state = await repository.getActiveState(context.presentationSessionId);
      const screen = screenRecord(context.presentationSessionId);
      if (!screen.questionId) {
        const selected = state.questions.find((question) => question.id === state.selectedQuestionId);
        if (selected?.answered) screen.questionId = selected.id;
      }
      screen.visible = Boolean(screen.questionId);
      emitControllerState(context, state);
      emitScreenState(context, state);
    });
  }

  async function sendCurrentState(socket, rawContext) {
    if (!rawContext?.roomKey || !rawContext?.sessionId || !rawContext?.role) return;
    const presentationSessionId = await resolvePresentationSessionId(rawContext);
    if (!presentationSessionId) return;
    const context = { ...rawContext, presentationSessionId };
    if (canControl(context)) {
      const state = await repository.getActiveState(presentationSessionId);
      socket.emit("qna:state", controllerPayload(state, presentationSessionId));
      return;
    }
    if (context.role === "screen" || context.role === "viewer") {
      const state = await repository.getActiveState(presentationSessionId);
      socket.emit("qna:screen", screenPayload(state, presentationSessionId));
      return;
    }
    if (context.role === "audience" && context.audienceId) {
      socket.emit("qna:state", await audiencePayload(context, context.audienceId));
    }
  }

  async function resetAfterHistoryDelete({ deckId, sourceSessionId, presentationSessionId }) {
    if (!deckId || !sourceSessionId || !presentationSessionId) return;
    const roomKey = getRoomKey(sourceSessionId, deckId);
    const context = { roomKey, sessionId: sourceSessionId, deckId, presentationSessionId };
    screenState.set(String(presentationSessionId), { questionId: null, visible: false });
    await emitAllStates(context);
  }

  return { attach, sendCurrentState, resetAfterHistoryDelete };
}

module.exports = { CONTROL_ROLES, createQnaSocketHandlers };
