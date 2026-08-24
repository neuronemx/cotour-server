CREATE TABLE IF NOT EXISTS event_hub_poll_executions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_hub_poll_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  launched_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_event_poll_executions_workspace (event_workspace_id, launched_at),
  CONSTRAINT fk_event_poll_executions_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_poll_executions_poll FOREIGN KEY (event_hub_poll_id) REFERENCES event_hub_polls (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_hub_poll_responses (
  event_hub_poll_execution_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_participant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_hub_poll_option_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_hub_poll_execution_id, event_participant_id),
  KEY idx_event_poll_responses_option (event_hub_poll_execution_id, event_hub_poll_option_id),
  CONSTRAINT fk_event_poll_responses_execution FOREIGN KEY (event_hub_poll_execution_id) REFERENCES event_hub_poll_executions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_poll_responses_participant FOREIGN KEY (event_participant_id) REFERENCES event_participants (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_poll_responses_option FOREIGN KEY (event_hub_poll_option_id) REFERENCES event_hub_poll_options (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
