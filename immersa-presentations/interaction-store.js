const { TimeSyncStore, createTimeSyncSocketHandlers } = require("./time-sync-store");

const FALLBACK_DEMO_INTERACTION = {
  id: "demo-poll-1",
  type: "poll",
  title: "Encuesta demo",
  prompt: "¿Qué experiencia te gustaría probar primero en Immersa?",
  options: [
    { id: "live-polls", label: "Encuestas en vivo" },
    { id: "quizzes", label: "Quizzes con puntaje" },
    { id: "decision-exercises", label: "Ejercicios de decisión" },
    { id: "attendee-results", label: "Resultados por asistente" }
  ],
  source: "fallback-demo"
};

function withFallbackInteractions(interactions) {
  return Array.isArray(interactions) && interactions.length ? interactions : [FALLBACK_DEMO_INTERACTION];
}

class InteractionStore {
  constructor() {
    this.sessions = new Map();
  }

  getSession(sessionId) {
    const key = String(sessionId || "");
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        active: null,
        responses: new Map(),
        resultsVisible: false
      });
    }
    return this.sessions.get(key);
  }

  hasActive(sessionId) {
    return Boolean(this.getSession(sessionId).active);
  }

  normalizeInteraction(interaction) {
    if (!interaction || !interaction.id || !interaction.type) return null;
    const options = Array.isArray(interaction.options)
      ? interaction.options
          .filter((option) => option && option.id && option.label)
          .map((option) => ({ id: String(option.id), label: String(option.label) }))
      : [];
    if (!options.length) return null;
    return {
      id: String(interaction.id),
      type: String(interaction.type),
      title: String(interaction.title || interaction.prompt || "Interacción"),
      prompt: String(interaction.prompt || interaction.title || "Elige una opción"),
      options,
      allowMultiple: Boolean(interaction.allowMultiple),
      source: interaction.source ? String(interaction.source) : "deck"
    };
  }

  launch({ sessionId, interaction }) {
    const normalized = this.normalizeInteraction(interaction);
    if (!normalized) return null;
    const session = this.getSession(sessionId);
    session.active = {
      ...normalized,
      launchedAt: new Date().toISOString(),
      closedAt: null
    };
    session.responses = new Map();
    session.resultsVisible = false;
    return session.active;
  }

  close(sessionId) {
    const session = this.getSession(sessionId);
    if (session.active) session.active = { ...session.active, closedAt: new Date().toISOString() };
    session.resultsVisible = false;
    const closed = session.active;
    session.active = null;
    session.responses = new Map();
    return closed;
  }

  revealResults(sessionId) {
    const session = this.getSession(sessionId);
    if (!session.active) return null;
    session.resultsVisible = true;
    return this.getResults(sessionId);
  }

  hideResults(sessionId) {
    const session = this.getSession(sessionId);
    if (!session.active) return null;
    session.resultsVisible = false;
    return this.getResults(sessionId);
  }

  responseKey(sessionId, interactionId, audienceId) {
    return [sessionId, interactionId, audienceId].map((value) => String(value || "")).join("::");
  }

  submitResponse({ sessionId, interactionId, audienceId, optionId }) {
    const session = this.getSession(sessionId);
    const active = session.active;
    if (!active || active.id !== interactionId) return { ok: false, reason: "interaction_not_active" };
    if (!audienceId) return { ok: false, reason: "missing_audience_id" };
    const option = active.options.find((item) => item.id === optionId);
    if (!option) return { ok: false, reason: "invalid_option" };

    const key = this.responseKey(sessionId, interactionId, audienceId);
    if (session.responses.has(key)) return { ok: false, reason: "duplicate_response" };

    const response = {
      sessionId,
      interactionId,
      audienceId,
      optionId,
      submittedAt: new Date().toISOString()
    };
    session.responses.set(key, response);
    return { ok: true, response };
  }

  getAudienceResponse(sessionId, audienceId) {
    const session = this.getSession(sessionId);
    if (!session.active || !audienceId) return null;
    return session.responses.get(this.responseKey(sessionId, session.active.id, audienceId)) || null;
  }

  getResults(sessionId) {
    const session = this.getSession(sessionId);
    const active = session.active;
    if (!active) return null;
    const totalResponses = session.responses.size;
    const counts = new Map(active.options.map((option) => [option.id, 0]));
    for (const response of session.responses.values()) counts.set(response.optionId, (counts.get(response.optionId) || 0) + 1);
    return {
      interactionId: active.id,
      type: active.type,
      title: active.title,
      prompt: active.prompt,
      totalResponses,
      options: active.options.map((option) => {
        const count = counts.get(option.id) || 0;
        return { id: option.id, label: option.label, count, percentage: totalResponses ? Math.round((count / totalResponses) * 100) : 0 };
      })
    };
  }

  getState(sessionId, audienceId = "") {
    const session = this.getSession(sessionId);
    const active = session.active;
    if (!active) return { active: null, response: null, resultsVisible: false };
    const response = this.getAudienceResponse(sessionId, audienceId);
    return {
      active: {
        id: active.id,
        type: active.type,
        title: active.title,
        prompt: active.prompt,
        options: active.options,
        launchedAt: active.launchedAt,
        source: active.source
      },
      response: response ? { optionId: response.optionId, submittedAt: response.submittedAt } : null,
      resultsVisible: session.resultsVisible
    };
  }
}

function createInteractionSocketHandlers({ io, store, loadInteractionsForDeck, getRoleRoomKey, coordinator = null, timeSyncStore = new TimeSyncStore() }) {
  const timeSyncSockets = createTimeSyncSocketHandlers({ io, store: timeSyncStore, getRoleRoomKey });

  function canControlInteractions(context) {
    return context?.role === "presenter" || context?.role === "stage";
  }

  function emitResults(roomKey, sessionId) {
    const results = store.getResults(sessionId);
    if (!results) return;
    io.to(getRoleRoomKey(roomKey, "presenter")).emit("interaction:results_updated", results);
    io.to(getRoleRoomKey(roomKey, "stage")).emit("interaction:results_updated", results);
    if (store.getSession(sessionId).resultsVisible) io.to(getRoleRoomKey(roomKey, "screen")).emit("interaction:show_results", results);
  }

  function emitStateToRoom(roomKey, sessionId) {
    io.to(roomKey).emit("interaction:state", store.getState(sessionId));
  }

  function emitStateToControlRoles(roomKey, sessionId) {
    const state = store.getState(sessionId);
    io.to(getRoleRoomKey(roomKey, "presenter")).emit("interaction:state", state);
    io.to(getRoleRoomKey(roomKey, "stage")).emit("interaction:state", state);
  }

  async function sendCurrentState(socket, context) {
    if (!context?.sessionId) return;
    socket.emit("interaction:state", store.getState(context.sessionId, context.audienceId));
    const results = store.getResults(context.sessionId);
    if (results && (context.role === "presenter" || context.role === "stage")) socket.emit("interaction:results_updated", results);
    if (results && context.role === "screen" && store.getSession(context.sessionId).resultsVisible) socket.emit("interaction:show_results", results);
    timeSyncSockets.sendCurrentState(socket, context);
  }

  async function launchInteraction(context, interactionId) {
    const execute = async () => {
      if (coordinator?.hasActiveRaffle(context.sessionId)) return { ok: false, reason: "active_raffle_exists" };
      const interactions = withFallbackInteractions(await loadInteractionsForDeck(context.deckId));
      const interaction = interactions.find((item) => String(item.id) === String(interactionId)) || interactions[0];
      const active = store.launch({ sessionId: context.sessionId, interaction });
      if (!active) return { ok: false, reason: "invalid_interaction" };
      return { ok: true, active };
    };
    return coordinator ? coordinator.withSessionLock(context.sessionId, execute) : execute();
  }

  function attach(socket, getContext) {
    timeSyncSockets.attach(socket, getContext);

    socket.on("interaction:launch", async ({ interactionId } = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !context?.deckId || !canControlInteractions(context)) return;
      const result = await launchInteraction(context, interactionId);
      if (!result.ok) {
        socket.emit("interaction:launch_rejected", { interactionId: interactionId || "", reason: result.reason });
        return;
      }
      io.to(context.roomKey).emit("interaction:active", store.getState(context.sessionId).active);
      emitStateToRoom(context.roomKey, context.sessionId);
      emitResults(context.roomKey, context.sessionId);
    });

    socket.on("interaction:submit_response", ({ interactionId, audienceId, optionId } = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || context.role !== "audience") return;
      const result = store.submitResponse({
        sessionId: context.sessionId,
        interactionId: String(interactionId || ""),
        audienceId: String(audienceId || ""),
        optionId: String(optionId || "")
      });
      if (!result.ok) {
        socket.emit("interaction:response_rejected", { interactionId, reason: result.reason });
        return;
      }
      socket.emit("interaction:response_accepted", { interactionId, optionId, submittedAt: result.response.submittedAt });
      socket.emit("interaction:state", store.getState(context.sessionId, audienceId));
      emitResults(context.roomKey, context.sessionId);
    });

    socket.on("interaction:close", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlInteractions(context)) return;
      const closed = store.close(context.sessionId);
      io.to(context.roomKey).emit("interaction:closed", { interactionId: closed?.id || "" });
      io.to(context.roomKey).emit("interaction:state", store.getState(context.sessionId));
      io.to(getRoleRoomKey(context.roomKey, "screen")).emit("interaction:hide_results", { interactionId: closed?.id || "" });
    });

    socket.on("interaction:reveal_results", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlInteractions(context)) return;
      const results = store.revealResults(context.sessionId);
      if (!results) return;
      io.to(getRoleRoomKey(context.roomKey, "screen")).emit("interaction:show_results", results);
      emitStateToControlRoles(context.roomKey, context.sessionId);
    });

    socket.on("interaction:hide_results", () => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !canControlInteractions(context)) return;
      const results = store.hideResults(context.sessionId);
      io.to(getRoleRoomKey(context.roomKey, "screen")).emit("interaction:hide_results", { interactionId: results?.interactionId || "" });
      emitStateToControlRoles(context.roomKey, context.sessionId);
    });
  }

  return { attach, sendCurrentState, timeSyncStore, timeSyncSockets };
}

module.exports = { InteractionStore, createInteractionSocketHandlers, FALLBACK_DEMO_INTERACTION };
