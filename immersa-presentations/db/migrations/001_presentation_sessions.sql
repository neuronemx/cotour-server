CREATE TABLE IF NOT EXISTS presentation_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id VARCHAR(191) NOT NULL,
  source_session_id VARCHAR(191) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_presentation_sessions_deck_started (deck_id, started_at),
  KEY idx_presentation_sessions_source (source_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
