CREATE TABLE IF NOT EXISTS qna_rounds (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  round_number INT UNSIGNED NOT NULL,
  questions_open TINYINT(1) NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_qna_round_number (presentation_session_id, round_number),
  KEY idx_qna_rounds_active (presentation_session_id, archived_at),
  CONSTRAINT fk_qna_rounds_presentation_session
    FOREIGN KEY (presentation_session_id) REFERENCES presentation_sessions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
