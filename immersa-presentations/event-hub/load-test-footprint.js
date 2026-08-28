const EVENT_HUB_TABLES = [
  "event_participants",
  "event_live_attendance",
  "event_live_sessions",
  "event_hub_poll_responses",
  "event_hub_poll_executions",
  "presentation_sessions",
  "qna_rounds",
  "qna_questions"
];

class EventHubLoadTestFootprint {
  constructor(pool) {
    this.pool = pool;
  }

  async snapshot(eventWorkspaceId) {
    const tablePlaceholders = EVENT_HUB_TABLES.map(() => "?").join(", ");
    const [tables] = await this.pool.execute(
      `SELECT
         table_name AS tableName,
         table_rows AS estimatedRows,
         data_length AS dataBytes,
         index_length AS indexBytes,
         data_length + index_length AS allocatedBytes
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN (${tablePlaceholders})
       ORDER BY table_name`,
      EVENT_HUB_TABLES
    );
    const [scopeRows] = await this.pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM event_participants WHERE event_workspace_id = ?) AS participants,
         (SELECT COUNT(*)
          FROM event_live_attendance attendance
          INNER JOIN event_live_sessions live ON live.id = attendance.event_live_session_id
          WHERE live.event_workspace_id = ?) AS liveAttendances,
         (SELECT COUNT(*)
          FROM event_hub_poll_responses response
          INNER JOIN event_hub_poll_executions execution ON execution.id = response.event_hub_poll_execution_id
          WHERE execution.event_workspace_id = ?) AS pollResponses,
         (SELECT COUNT(*)
          FROM presentation_sessions presentation
          INNER JOIN event_live_sessions live ON live.deck_id = presentation.deck_id
          WHERE live.event_workspace_id = ?) AS qnaPresentationSessions,
         (SELECT COUNT(*)
          FROM qna_rounds round
          INNER JOIN presentation_sessions presentation ON presentation.id = round.presentation_session_id
          INNER JOIN event_live_sessions live ON live.deck_id = presentation.deck_id
          WHERE live.event_workspace_id = ?) AS qnaRounds,
         (SELECT COUNT(*)
          FROM qna_questions question
          INNER JOIN qna_rounds round ON round.id = question.qna_round_id
          INNER JOIN presentation_sessions presentation ON presentation.id = round.presentation_session_id
          INNER JOIN event_live_sessions live ON live.deck_id = presentation.deck_id
          WHERE live.event_workspace_id = ?) AS qnaQuestions`,
      [
        eventWorkspaceId,
        eventWorkspaceId,
        eventWorkspaceId,
        eventWorkspaceId,
        eventWorkspaceId,
        eventWorkspaceId
      ]
    );
    const normalizedTables = (tables || []).map((table) => ({
      tableName: table.tableName,
      estimatedRows: Number(table.estimatedRows || 0),
      dataBytes: Number(table.dataBytes || 0),
      indexBytes: Number(table.indexBytes || 0),
      allocatedBytes: Number(table.allocatedBytes || 0)
    }));
    return {
      capturedAt: new Date().toISOString(),
      eventWorkspaceId: String(eventWorkspaceId),
      eventScope: {
        participants: Number(scopeRows?.[0]?.participants || 0),
        liveAttendances: Number(scopeRows?.[0]?.liveAttendances || 0),
        pollResponses: Number(scopeRows?.[0]?.pollResponses || 0),
        qnaPresentationSessions: Number(scopeRows?.[0]?.qnaPresentationSessions || 0),
        qnaRounds: Number(scopeRows?.[0]?.qnaRounds || 0),
        qnaQuestions: Number(scopeRows?.[0]?.qnaQuestions || 0)
      },
      tables: normalizedTables,
      allocatedBytes: normalizedTables.reduce((total, table) => total + table.allocatedBytes, 0)
    };
  }
}

module.exports = { EventHubLoadTestFootprint, EVENT_HUB_TABLES };
