class EventHubAdminInteractions {
  constructor({ io, repository }) {
    this.io = io;
    this.repository = repository;
    this.events = new Map();
  }

  room(workspaceId) { return `event-hub:${workspaceId}:program`; }

  state(workspaceId, participantId = "") {
    const current = this.events.get(String(workspaceId));
    if (!current) return { active: null, response: null };
    const response = participantId ? current.responses.get(String(participantId)) || null : null;
    return { active: { ...current.active, options: current.active.options.map((option) => ({ ...option })) }, response };
  }

  status(workspaceId) {
    const current = this.events.get(String(workspaceId));
    if (!current) return { active: null, responsesTotal: 0, results: [] };
    const totals = new Map(current.active.options.map((option) => [String(option.id), 0]));
    for (const response of current.responses.values()) totals.set(response.optionId, (totals.get(response.optionId) || 0) + 1);
    return {
      active: { ...current.active, options: current.active.options.map((option) => ({ ...option })) },
      responsesTotal: current.responses.size,
      results: current.active.options.map((option) => ({ optionId: option.id, label: option.label, responses: totals.get(String(option.id)) || 0 }))
    };
  }

  async join(socket, { publicId, participantId }) {
    const qr = await this.repository.getPublicQr(publicId);
    const participant = await this.repository.getParticipant({ eventWorkspaceId: qr.eventWorkspaceId, participantId });
    if (await this.repository.isParticipantInLiveSession({ eventWorkspaceId: qr.eventWorkspaceId, participantId: participant.id })) {
      socket.emit("event-admin:interaction:state", { active: null, response: null });
      return { joined: false, eventWorkspaceId: qr.eventWorkspaceId };
    }
    socket.join(this.room(qr.eventWorkspaceId));
    socket.data.eventHubParticipant = { eventWorkspaceId: qr.eventWorkspaceId, participantId: participant.id };
    socket.emit("event-admin:interaction:state", this.state(qr.eventWorkspaceId, participant.id));
    return { joined: true, eventWorkspaceId: qr.eventWorkspaceId };
  }

  async launch({ eventWorkspaceId, pollId }) {
    const poll = (await this.repository.listEventPolls(eventWorkspaceId, { activeOnly: true })).find((item) => item.id === String(pollId));
    if (!poll) throw new Error("Encuesta del evento no encontrada");
    const executionId = await this.repository.startEventPollExecution({ eventWorkspaceId, pollId: poll.id });
    const active = { id: poll.id, executionId, type: "poll", source: "event_admin", title: poll.title, prompt: poll.prompt, options: poll.options.map((option) => ({ ...option })), launchedAt: new Date().toISOString() };
    this.events.set(String(eventWorkspaceId), { active, responses: new Map() });
    this.io.to(this.room(eventWorkspaceId)).emit("event-admin:interaction:state", { active, response: null });
    return { active };
  }

  async close(eventWorkspaceId) {
    const current = this.events.get(String(eventWorkspaceId));
    if (current?.active?.executionId) await this.repository.closeEventPollExecution(current.active.executionId);
    this.events.delete(String(eventWorkspaceId));
    this.io.to(this.room(eventWorkspaceId)).emit("event-admin:interaction:state", { active: null, response: null });
    return { active: null };
  }

  async submit(socket, { interactionId, optionId }) {
    const context = socket.data.eventHubParticipant;
    if (!context) return { ok: false, reason: "not_registered" };
    const current = this.events.get(context.eventWorkspaceId);
    if (!current || current.active.id !== String(interactionId)) return { ok: false, reason: "interaction_not_active" };
    if (!current.active.options.some((option) => option.id === String(optionId))) return { ok: false, reason: "invalid_option" };
    if (current.responses.has(context.participantId)) return { ok: false, reason: "duplicate_response" };
    const persisted = await this.repository.recordEventPollResponse({ executionId: current.active.executionId, participantId: context.participantId, optionId });
    if (!persisted) return { ok: false, reason: "duplicate_response" };
    const response = { optionId: String(optionId), submittedAt: new Date().toISOString() };
    current.responses.set(context.participantId, response);
    socket.emit("event-admin:interaction:state", this.state(context.eventWorkspaceId, context.participantId));
    return { ok: true, response };
  }

  attach(socket) {
    socket.on("event-admin:join", async (payload = {}) => {
      try { await this.join(socket, payload); }
      catch (_error) { socket.emit("event-admin:interaction:state", { active: null, response: null }); }
    });
    socket.on("event-admin:interaction:submit", async (payload = {}) => {
      const result = await this.submit(socket, payload);
      if (!result.ok) socket.emit("event-admin:interaction:rejected", result);
    });
  }
}

module.exports = { EventHubAdminInteractions };
