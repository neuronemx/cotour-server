CREATE TABLE IF NOT EXISTS presentation_raffles (
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raffle_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_json JSON NOT NULL,
  PRIMARY KEY (presentation_session_id, raffle_id),
  CONSTRAINT fk_session_raffle FOREIGN KEY (presentation_session_id) REFERENCES presentation_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
