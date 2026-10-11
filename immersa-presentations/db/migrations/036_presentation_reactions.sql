CREATE TABLE IF NOT EXISTS presentation_reaction_counts (
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  collector_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  emoji VARCHAR(8) NOT NULL,
  reaction_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (presentation_session_id, collector_id, emoji),
  CONSTRAINT fk_presentation_reactions_session
    FOREIGN KEY (presentation_session_id) REFERENCES presentation_sessions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
