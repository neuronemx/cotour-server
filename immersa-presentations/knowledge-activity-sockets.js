const { createHash } = require("node:crypto");

const CONTROL_ROLES = new Set(["presenter", "stage"]);
const COMMAND_EVENTS = new Map([
  ["interaction:execution:start", "start"],
  ["interaction:execution:finalize", "finalize"],
  ["interaction:execution:cancel", "cancel"],
  ["interaction:execution:show_results", "show_results"],
  ["interaction:execution:close", "close"],
  ["interaction:execution:retry_processing", "retry_processing"],
  ["interaction:execution:force_results", "force_results"]
]);

function participantIdFor(executionId, audienceId) {
  if (!executionId || !audienceId) return "";
  return createHash("sha256")
    .update(`${String(executionId)}::${String(audienceId)}`)
    .digest("hex")
    .slice(0, 36);
}

function recoveryTokenHashFor(executionId, audienceId) {
  if (!executionId || !audienceId) return "";
  return createHash("sha256")
    .update(`recovery::${String(executionId)}::${String(audienceId)}`)
    .digest("hex");
}

function createKnowledgeActivitySocketHandlers({
  io,
  service,
  getRoleRoomKey,
  getRoomKey,
  getConnectedAudience = () => []
}) {
  if (!io?.to || !service?.getActive) throw new Error("io and knowledge activity service are required");

  function reject(socket, eventName, error) {
    socket.emit("interaction:knowledge:rejected", {
      event: eventName,
      reason: error?.code || "KNOWLEDGE_ACTIVITY_UNAVAILABLE",
      message: error?.message || "Knowledge activity unavailable"
    });
  }

  function roleState(execution, role, extras = {}) {
    return service.state(execution, { role, ...extras });
  }

  function emitAll(execution) {
    if (!execution) return;
    const roomKey = getRoomKey(execution.sourceSessionId, execution.deckId);
    const activeExecution = service.isExecutionActive(execution) ? execution : null;
    io.to(getRoleRoomKey(roomKey, "presenter")).emit(
      "interaction:execution:state",
      roleState(activeExecution, "presenter")
    );
    io.to(getRoleRoomKey(roomKey, "stage")).emit(
      "interaction:execution:state",
      roleState(activeExecution, "stage")
    );
    io.to(getRoleRoomKey(roomKey, "screen")).emit(
      "interaction:execution:state",
      roleState(activeExecution, "screen")
    );
    io.to(getRoleRoomKey(roomKey, "viewer")).emit(
      "interaction:execution:state",
      roleState(activeExecution, "viewer")
    );
    for (const audience of getConnectedAudience(roomKey)) {
      const participantId = activeExecution
        ? participantIdFor(activeExecution.id, audience.audienceId)
        : "";
      io.to(getRoleRoomKey(roomKey, `audience:${audience.audienceId}`)).emit(
        "interaction:execution:state",
        roleState(activeExecution, "audience", { participantId })
      );
    }
  }

  function emitControllers(execution) {
    if (!execution) return;
    const roomKey = getRoomKey(execution.sourceSessionId, execution.deckId);
    const activeExecution = service.isExecutionActive(execution) ? execution : null;
    for (const role of ["presenter", "stage"]) {
      io.to(getRoleRoomKey(roomKey, role)).emit(
        "interaction:execution:state",
        roleState(activeExecution, role)
      );
    }
  }

  const unsubscribe = service.subscribe(({ execution, eventName }) => {
    if (eventName === "participant_joined") emitControllers(execution);
    else emitAll(execution);
    if (eventName === "answer_accepted") {
      const roomKey = getRoomKey(execution.sourceSessionId, execution.deckId);
      io.to(getRoleRoomKey(roomKey, "presenter")).emit("interaction:execution:progress", roleState(execution, "presenter"));
      io.to(getRoleRoomKey(roomKey, "stage")).emit("interaction:execution:progress", roleState(execution, "stage"));
    }
  });

  async function activeFor(context) {
    if (!context?.sessionId || !context?.deckId) return null;
    return service.getActive({ sourceSessionId: context.sessionId, deckId: context.deckId });
  }

  function attach(socket, getContext) {
    socket.on("interaction:execution:open", async ({ definition_id, definitionId, category } = {}) => {
      const context = getContext();
      if (!context?.sessionId || !context?.deckId || !CONTROL_ROLES.has(context.role)) {
        return reject(socket, "interaction:execution:open", { code: "UNAUTHORIZED" });
      }
      try {
        const execution = await service.open({
          sourceSessionId: context.sessionId,
          deckId: context.deckId,
          definitionId: definitionId || definition_id,
          category
        });
        socket.emit("interaction:execution:opened", roleState(execution, context.role));
      } catch (error) {
        reject(socket, "interaction:execution:open", error);
      }
    });

    for (const [eventName, intent] of COMMAND_EVENTS.entries()) {
      socket.on(eventName, async (payload = {}) => {
        const context = getContext();
        if (!context?.sessionId || !context?.deckId || !CONTROL_ROLES.has(context.role)) {
          return reject(socket, eventName, { code: "UNAUTHORIZED" });
        }
        try {
          const execution = await activeFor(context);
          if (!execution || (payload.execution_id || payload.executionId) !== execution.id) {
            const error = new Error("Execution is not active");
            error.code = "INVALID_STATE";
            throw error;
          }
          const result = await service.command(execution, {
            commandId: payload.command_id || payload.commandId,
            expectedRevision: payload.expected_revision ?? payload.expectedRevision,
            actorRole: context.role,
            intent,
            payload
          });
          socket.emit("interaction:execution:command_accepted", result);
        } catch (error) {
          reject(socket, eventName, error);
        }
      });
    }

    socket.on("interaction:participant:join", async ({ name, tab_id, tabId } = {}) => {
      const context = getContext();
      if (!context?.sessionId || !context?.deckId || context.role !== "audience" || !context.audienceId) {
        return reject(socket, "interaction:participant:join", { code: "UNAUTHORIZED" });
      }
      try {
        const execution = await activeFor(context);
        if (!execution) {
          const error = new Error("Execution is not active");
          error.code = "INVALID_STATE";
          throw error;
        }
        const participantId = participantIdFor(execution.id, context.audienceId);
        const participant = await service.join(execution, {
          participantId,
          name,
          tabId: tabId || tab_id,
          recoveryTokenHash: recoveryTokenHashFor(execution.id, context.audienceId),
          isConnected: () => socket.connected !== false
        });
        socket.emit("interaction:participant:joined", {
          participantId: participant.id,
          label: participant.label,
          executionId: execution.id
        });
        socket.emit("interaction:execution:state", roleState(execution, "audience", { participantId, tabId: tabId || tab_id }));
      } catch (error) {
        reject(socket, "interaction:participant:join", error);
      }
    });

    socket.on("interaction:participant:claim_tab", async ({ tab_id, tabId } = {}) => {
      const context = getContext();
      try {
        const execution = await activeFor(context);
        if (!execution || context.role !== "audience" || !context.audienceId) {
          const error = new Error("Execution is not active");
          error.code = "UNAUTHORIZED";
          throw error;
        }
        const participantId = participantIdFor(execution.id, context.audienceId);
        await service.claimTab(execution, { participantId, tabId: tabId || tab_id });
        socket.emit("interaction:execution:state", roleState(execution, "audience", { participantId, tabId: tabId || tab_id }));
      } catch (error) {
        reject(socket, "interaction:participant:claim_tab", error);
      }
    });

    socket.on("interaction:participant:submit_answer", async (payload = {}) => {
      const context = getContext();
      try {
        const execution = await activeFor(context);
        if (!execution || context.role !== "audience" || !context.audienceId) {
          const error = new Error("Execution is not active");
          error.code = "UNAUTHORIZED";
          throw error;
        }
        const participantId = participantIdFor(execution.id, context.audienceId);
        const answer = await service.answer(execution, {
          participantId,
          questionId: payload.question_id || payload.questionId,
          optionId: payload.option_id || payload.optionId,
          tabId: payload.tab_id || payload.tabId,
          clientAttemptId: payload.client_attempt_id || payload.clientAttemptId
        });
        socket.emit("interaction:answer:accepted", {
          executionId: execution.id,
          questionId: answer.questionId,
          optionId: answer.optionId,
          receivedAt: answer.receivedAt
        });
      } catch (error) {
        reject(socket, "interaction:participant:submit_answer", error);
      }
    });

    socket.on("interaction:participant:submit_evaluation", async ({ tab_id, tabId } = {}) => {
      const context = getContext();
      try {
        const execution = await activeFor(context);
        if (!execution || context.role !== "audience" || !context.audienceId) {
          const error = new Error("Execution is not active");
          error.code = "UNAUTHORIZED";
          throw error;
        }
        const participantId = participantIdFor(execution.id, context.audienceId);
        const participant = await service.submit(execution, { participantId, tabId: tabId || tab_id });
        socket.emit("interaction:participant:submitted", {
          executionId: execution.id,
          submittedAt: participant.submittedAt
        });
      } catch (error) {
        reject(socket, "interaction:participant:submit_evaluation", error);
      }
    });
  }

  async function sendCurrentState(socket, context) {
    const execution = await activeFor(context);
    if (!execution) {
      socket.emit("interaction:execution:state", { available: true, execution: null });
      return;
    }
    const participantId = context.role === "audience"
      ? participantIdFor(execution.id, context.audienceId)
      : "";
    socket.emit("interaction:execution:state", roleState(execution, context.role, { participantId }));
  }

  function clearState(context) {
    if (!context?.roomKey) return;
    for (const role of ["presenter", "stage", "screen", "viewer", "audience"]) {
      io.to(getRoleRoomKey(context.roomKey, role)).emit(
        "interaction:execution:state",
        roleState(null, role)
      );
    }
  }

  function close() {
    unsubscribe();
  }

  return { attach, sendCurrentState, emitAll, clearState, close, participantIdFor };
}

module.exports = {
  CONTROL_ROLES,
  COMMAND_EVENTS,
  participantIdFor,
  recoveryTokenHashFor,
  createKnowledgeActivitySocketHandlers
};
