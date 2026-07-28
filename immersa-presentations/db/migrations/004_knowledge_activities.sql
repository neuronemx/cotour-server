CREATE TABLE IF NOT EXISTS knowledge_activity_executions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_definition_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category ENUM('contest', 'assessment') NOT NULL,
  contract_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(240) NOT NULL,
  state ENUM(
    'LOBBY',
    'COUNTDOWN',
    'ACTIVE',
    'PROCESSING',
    'RESULTS_READY',
    'RESULTS_VISIBLE',
    'PROCESSING_ERROR',
    'CANCELLED',
    'CLOSED'
  ) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  active_session_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  snapshot_json JSON NOT NULL,
  opened_at DATETIME(3) NOT NULL,
  started_at DATETIME(3) NULL,
  deadline_at DATETIME(3) NULL,
  processing_started_at DATETIME(3) NULL,
  results_ready_at DATETIME(3) NULL,
  results_visible_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_knowledge_activity_active_session (active_session_key),
  KEY idx_knowledge_activity_history (presentation_session_id, opened_at),
  KEY idx_knowledge_activity_state (state, updated_at),
  CONSTRAINT fk_knowledge_activity_presentation_session
    FOREIGN KEY (presentation_session_id) REFERENCES presentation_sessions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_activity_participants (
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recovery_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_number INT UNSIGNED NOT NULL,
  display_name VARCHAR(120) NULL,
  public_label VARCHAR(140) NOT NULL,
  active_tab_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
  state ENUM('PENDING', 'ACTIVE', 'COMPLETED', 'INCOMPLETE') NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  submitted_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_id, participant_id),
  UNIQUE KEY uq_knowledge_activity_user_number (execution_id, user_number),
  UNIQUE KEY uq_knowledge_activity_recovery_token (execution_id, recovery_token_hash),
  CONSTRAINT fk_knowledge_activity_participant_execution
    FOREIGN KEY (execution_id) REFERENCES knowledge_activity_executions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_activity_participant_orders (
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  question_order_json JSON NOT NULL,
  option_orders_json JSON NOT NULL,
  current_question_index INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_id, participant_id),
  CONSTRAINT fk_knowledge_activity_order_participant
    FOREIGN KEY (execution_id, participant_id)
    REFERENCES knowledge_activity_participants (execution_id, participant_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_activity_answers (
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  participant_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  question_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  option_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_attempt_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NULL,
  correct TINYINT(1) NOT NULL,
  elapsed_ms INT UNSIGNED NULL,
  received_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_id, participant_id, question_id),
  UNIQUE KEY uq_knowledge_activity_attempt (execution_id, participant_id, client_attempt_id),
  KEY idx_knowledge_activity_answer_question (execution_id, question_id),
  CONSTRAINT fk_knowledge_activity_answer_participant
    FOREIGN KEY (execution_id, participant_id)
    REFERENCES knowledge_activity_participants (execution_id, participant_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_activity_results (
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mode ENUM('normal', 'forced') NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  excluded_response_count INT UNSIGNED NOT NULL DEFAULT 0,
  result_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (execution_id),
  CONSTRAINT fk_knowledge_activity_result_execution
    FOREIGN KEY (execution_id) REFERENCES knowledge_activity_executions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS knowledge_activity_commands (
  execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  command_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_role ENUM('presenter', 'stage') NOT NULL,
  intent VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_revision BIGINT UNSIGNED NOT NULL,
  result_json JSON NOT NULL,
  applied_at DATETIME(3) NOT NULL,
  PRIMARY KEY (execution_id, command_id),
  CONSTRAINT fk_knowledge_activity_command_execution
    FOREIGN KEY (execution_id) REFERENCES knowledge_activity_executions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
