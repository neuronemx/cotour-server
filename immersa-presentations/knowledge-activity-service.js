const {
  TERMINAL_STATES,
  createExecution,
  joinParticipant,
  claimParticipantTab,
  submitAnswer,
  submitAssessment,
  tickExecution,
  controllerCommand,
  stateForRole
} = require("./knowledge-activity-engine");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class KnowledgeActivityService {
  constructor({
    repository,
    coordinator = null,
    loadDefinitionsForDeck,
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    random = Math.random
  }) {
    if (!repository?.createExecution || !repository?.saveExecution) {
      throw new Error("A knowledge activity repository is required");
    }
    if (typeof loadDefinitionsForDeck !== "function") {
      throw new Error("loadDefinitionsForDeck is required");
    }
    this.repository = repository;
    this.coordinator = coordinator;
    this.loadDefinitionsForDeck = loadDefinitionsForDeck;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.random = random;
    this.executions = new Map();
    this.timers = new Map();
    this.answerBatches = new Map();
    this.answerBatchTimers = new Map();
    this.persistedRevisions = new Map();
    this.listeners = new Set();
    coordinator?.registerActivity?.("knowledge", this);
  }

  key(sessionId) {
    return String(sessionId || "");
  }

  isExecutionActive(execution) {
    return Boolean(execution && !TERMINAL_STATES.has(execution.state));
  }

  hasActive(sessionId) {
    return this.isExecutionActive(this.executions.get(this.key(sessionId)));
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new Error("listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(execution, eventName = "state") {
    for (const listener of this.listeners) listener({ execution, eventName });
  }

  async start() {
    const active = await this.repository.listActiveExecutions();
    for (const execution of active) {
      this.executions.set(this.key(execution.sourceSessionId), execution);
      this.persistedRevisions.set(execution.id, execution.revision);
      await this.reconcile(execution);
    }
    return active.length;
  }

  async getActive({ sourceSessionId, deckId }) {
    const key = this.key(sourceSessionId);
    let execution = this.executions.get(key) || null;
    let loaded = false;
    if (!execution) {
      execution = await this.repository.loadActiveExecution({ deckId, sourceSessionId });
      if (execution) {
        this.executions.set(key, execution);
        loaded = true;
      }
    }
    // The deadline timer reconciles executions already resident in memory. Doing
    // it on every audience socket event flushes an in-flight answer batch before
    // the other attendees can join it.
    if (execution && loaded) await this.reconcile(execution);
    return this.isExecutionActive(execution) ? execution : null;
  }

  async open({ sourceSessionId, deckId, definitionId, category }) {
    const execute = async () => {
      if (this.coordinator?.hasAnyActive?.(sourceSessionId)) {
        const error = new Error("Another interaction is active");
        error.code = "INTERACTION_BUSY";
        throw error;
      }
      const config = await this.loadDefinitionsForDeck(deckId);
      const list = category === "contest" ? config.contests : category === "assessment" ? config.assessments : [];
      const definition = (Array.isArray(list) ? list : []).find((item) => String(item.id) === String(definitionId));
      if (!definition) {
        const error = new Error("Activity definition was not found");
        error.code = "DEFINITION_NOT_FOUND";
        throw error;
      }
      const presentationSessionId = await this.repository.ensurePresentationSession({ deckId, sourceSessionId });
      const execution = createExecution({
        presentationSessionId,
        sourceSessionId,
        deckId,
        definition,
        nowMs: this.now(),
        random: this.random
      });
      await this.repository.createExecution(execution);
      this.executions.set(this.key(sourceSessionId), execution);
      this.persistedRevisions.set(execution.id, execution.revision);
      this.schedule(execution);
      this.notify(execution, "opened");
      return execution;
    };
    return this.coordinator?.withSessionLock
      ? this.coordinator.withSessionLock(sourceSessionId, execute)
      : execute();
  }

  async mutate(execution, operation, eventName, persistence = {}) {
    const execute = async () => {
      const original = clone(execution);
      const expectedRevision = execution.revision;
      try {
        const result = await operation(execution);
        await this.repository.saveExecution(execution, {
          expectedRevision,
          ...(typeof persistence.forResult === "function" ? persistence.forResult(result) : {})
        });
        this.persistedRevisions.set(execution.id, execution.revision);
        this.executions.set(this.key(execution.sourceSessionId), execution);
        this.schedule(execution);
        this.notify(execution, eventName);
        return result;
      } catch (error) {
        this.executions.set(this.key(original.sourceSessionId), original);
        this.schedule(original);
        throw error;
      }
    };
    return this.coordinator?.withSessionLock
      ? this.coordinator.withSessionLock(execution.sourceSessionId, execute)
      : execute();
  }

  async command(execution, command) {
    await this.flushAnswers(execution);
    return this.mutate(
      execution,
      (current) => controllerCommand(current, { ...command, nowMs: this.now() }),
      command.intent
    );
  }

  async join(execution, { isConnected, ...payload }) {
    return this.mutate(
      execution,
      (current) => {
        if (typeof isConnected === "function" && !isConnected()) {
          const error = new Error("Participant disconnected before admission");
          error.code = "PARTICIPANT_DISCONNECTED";
          throw error;
        }
        return joinParticipant(current, { ...payload, nowMs: this.now(), random: this.random });
      },
      "participant_joined",
      { forResult: (participant) => ({ participants: [participant] }) }
    );
  }

  async claimTab(execution, payload) {
    return this.mutate(
      execution,
      (current) => claimParticipantTab(current, { ...payload, nowMs: this.now() }),
      "tab_claimed"
    );
  }

  async answer(execution, payload) {
    const execute = async () => {
      const answer = submitAnswer(execution, { ...payload, nowMs: Number.isFinite(payload.receivedAtMs) ? payload.receivedAtMs : this.now() });
      const participant = execution.participants.find((item) => item.id === answer.participantId);
      const key = execution.id;
      const batch = this.answerBatches.get(key) || [];
      batch.push({ answer, participant });
      this.answerBatches.set(key, batch);
      this.scheduleAnswerFlush(execution);
      this.executions.set(this.key(execution.sourceSessionId), execution);
      this.schedule(execution);
      this.notify(execution, "answer_accepted");
      return answer;
    };
    return this.coordinator?.withSessionLock ? this.coordinator.withSessionLock(execution.sourceSessionId, execute) : execute();
  }

  scheduleAnswerFlush(execution) {
    const key = execution.id;
    if (this.answerBatchTimers.has(key)) return;
    const handle = this.setTimeoutFn(() => {
      this.answerBatchTimers.delete(key);
      this.flushAnswers(execution).catch((error) => this.notify(execution, error.code || "answer_persist_failed"));
    }, 25);
    handle?.unref?.();
    this.answerBatchTimers.set(key, handle);
  }

  async flushAnswers(execution, { skipLock = false } = {}) {
    const key = execution?.id;
    if (!key || !(this.answerBatches.get(key) || []).length) return execution;
    const execute = async () => {
      const batch = this.answerBatches.get(key) || [];
      if (!batch.length) return execution;
      const handle = this.answerBatchTimers.get(key);
      if (handle) this.clearTimeoutFn(handle);
      this.answerBatchTimers.delete(key);
      const expectedRevision = this.persistedRevisions.get(key);
      const persistence = {
        expectedRevision: Number.isFinite(expectedRevision) ? expectedRevision : Math.max(0, execution.revision - batch.length),
        participants: batch.map((item) => item.participant),
        answers: batch.map((item) => item.answer)
      };
      if (typeof this.repository.saveAnswerBatch === "function") await this.repository.saveAnswerBatch(execution, persistence);
      else await this.repository.saveExecution(execution, persistence);
      this.answerBatches.delete(key);
      this.persistedRevisions.set(key, execution.revision);
      return execution;
    };
    if (skipLock || !this.coordinator?.withSessionLock) return execute();
    return this.coordinator.withSessionLock(execution.sourceSessionId, execute);
  }

  async submit(execution, payload) {
    return this.mutate(
      execution,
      (current) => submitAssessment(current, { ...payload, nowMs: this.now() }),
      "assessment_submitted"
    );
  }

  nextDeadline(execution) {
    const values = [
      execution.countdownDeadlineAt,
      execution.questionDeadlineAt,
      execution.revealDeadlineAt,
      execution.deadlineAt,
      execution.processingReadyAt,
      execution.processingDeadlineAt
    ]
      .map((value) => Date.parse(value || ""))
      .filter(Number.isFinite);
    return values.length ? Math.min(...values) : null;
  }

  schedule(execution) {
    const key = this.key(execution.sourceSessionId);
    const current = this.timers.get(key);
    if (current) this.clearTimeoutFn(current);
    this.timers.delete(key);
    if (!this.isExecutionActive(execution)) return;
    const deadline = this.nextDeadline(execution);
    if (!Number.isFinite(deadline)) return;
    const handle = this.setTimeoutFn(() => {
      this.reconcile(execution).catch((error) => this.notify(execution, error.code || "processing_error"));
    }, Math.max(0, deadline - this.now() + 5));
    handle?.unref?.();
    this.timers.set(key, handle);
  }

  async reconcile(execution) {
    await this.flushAnswers(execution);
    const preview = clone(execution);
    const ticked = tickExecution(preview, this.now());
    if (!ticked.changed) {
      this.schedule(execution);
      return execution;
    }
    return this.mutate(
      execution,
      (current) => {
        const result = tickExecution(current, this.now());
        return result.execution;
      },
      "timer"
    );
  }

  state(execution, options) {
    return execution ? stateForRole(execution, { ...options, nowMs: this.now() }) : { available: true, execution: null };
  }

  discard(sourceSessionId) {
    const key = this.key(sourceSessionId);
    const handle = this.timers.get(key);
    if (handle) this.clearTimeoutFn(handle);
    this.timers.delete(key);
    const execution = this.executions.get(key);
    if (execution?.id) {
      const answerTimer = this.answerBatchTimers.get(execution.id);
      if (answerTimer) this.clearTimeoutFn(answerTimer);
      this.answerBatchTimers.delete(execution.id);
      this.answerBatches.delete(execution.id);
      this.persistedRevisions.delete(execution.id);
    }
    return this.executions.delete(key);
  }

  async close() {
    for (const handle of this.timers.values()) this.clearTimeoutFn(handle);
    this.timers.clear();
    for (const handle of this.answerBatchTimers.values()) this.clearTimeoutFn(handle);
    this.answerBatchTimers.clear();
    this.answerBatches.clear();
    this.persistedRevisions.clear();
  }
}

module.exports = { KnowledgeActivityService };
