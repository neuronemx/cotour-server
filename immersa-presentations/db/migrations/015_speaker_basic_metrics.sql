ALTER TABLE presentation_sessions
  ADD COLUMN audience_peak_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER recording_started_at;

CREATE TABLE IF NOT EXISTS presentation_session_attendance (
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (presentation_session_id, audience_id),
  CONSTRAINT fk_presentation_attendance_session
    FOREIGN KEY (presentation_session_id) REFERENCES presentation_sessions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presentation_poll_executions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  interaction_id VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL,
  prompt VARCHAR(500) NOT NULL,
  launched_at DATETIME(3) NOT NULL,
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_presentation_poll_launch (presentation_session_id, interaction_id, launched_at),
  KEY idx_presentation_poll_session (presentation_session_id, launched_at),
  CONSTRAINT fk_presentation_poll_session
    FOREIGN KEY (presentation_session_id) REFERENCES presentation_sessions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presentation_poll_options (
  poll_execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  option_id VARCHAR(191) NOT NULL,
  label VARCHAR(255) NOT NULL,
  sort_order INT UNSIGNED NOT NULL,
  PRIMARY KEY (poll_execution_id, option_id),
  CONSTRAINT fk_presentation_poll_option_execution
    FOREIGN KEY (poll_execution_id) REFERENCES presentation_poll_executions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presentation_poll_responses (
  poll_execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  option_id VARCHAR(191) NOT NULL,
  submitted_at DATETIME(3) NOT NULL,
  PRIMARY KEY (poll_execution_id, audience_id),
  KEY idx_presentation_poll_response_option (poll_execution_id, option_id),
  CONSTRAINT fk_presentation_poll_response_execution
    FOREIGN KEY (poll_execution_id) REFERENCES presentation_poll_executions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_presentation_poll_response_option
    FOREIGN KEY (poll_execution_id, option_id) REFERENCES presentation_poll_options (poll_execution_id, option_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
