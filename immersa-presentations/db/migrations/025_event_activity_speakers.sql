CREATE TABLE IF NOT EXISTS event_speakers (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  manual_name VARCHAR(120) NOT NULL DEFAULT '',
  manual_role_title VARCHAR(120) NOT NULL DEFAULT '',
  manual_bio VARCHAR(600) NOT NULL DEFAULT '',
  manual_photo_url VARCHAR(500) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_speaker_account (event_workspace_id, account_user_id),
  KEY idx_event_speakers_workspace (event_workspace_id),
  CONSTRAINT fk_event_speakers_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_activity_speakers (
  event_activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_speaker_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (event_activity_id, event_speaker_id),
  KEY idx_event_activity_speakers_sort (event_activity_id, sort_order),
  CONSTRAINT fk_event_activity_speakers_activity FOREIGN KEY (event_activity_id) REFERENCES event_activities (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_activity_speakers_speaker FOREIGN KEY (event_speaker_id) REFERENCES event_speakers (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
