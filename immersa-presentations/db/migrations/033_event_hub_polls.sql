-- Polls owned by the Event Hub are independent of any Speaker Deck.
CREATE TABLE IF NOT EXISTS event_hub_polls (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(191) NOT NULL,
  prompt VARCHAR(500) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_event_hub_polls_workspace (event_workspace_id, active, created_at),
  CONSTRAINT fk_event_hub_polls_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_hub_poll_options (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_hub_poll_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(300) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_event_hub_poll_options_poll (event_hub_poll_id, sort_order),
  CONSTRAINT fk_event_hub_poll_options_poll FOREIGN KEY (event_hub_poll_id) REFERENCES event_hub_polls (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
