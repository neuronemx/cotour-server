CREATE TABLE IF NOT EXISTS event_activity_speaker_assignments (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_speaker_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'INVITED',
  selected_deck_id VARCHAR(191) NULL,
  invited_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  accepted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_activity_speaker_assignment (event_activity_id, event_speaker_id),
  KEY idx_event_speaker_assignment_speaker (event_speaker_id, status),
  CONSTRAINT fk_event_assignment_activity FOREIGN KEY (event_activity_id) REFERENCES event_activities (id) ON DELETE CASCADE,
  CONSTRAINT fk_event_assignment_speaker FOREIGN KEY (event_speaker_id) REFERENCES event_speakers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
