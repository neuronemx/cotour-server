-- Separate aggregate counters; no nominal rows or legacy presentation metrics.
CREATE TABLE IF NOT EXISTS event_v2_reaction_counts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(191) NOT NULL,
  heart_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  clap_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  fire_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_v2_reactions_live FOREIGN KEY (id) REFERENCES event_live_sessions(id),
  CONSTRAINT fk_v2_reactions_stage FOREIGN KEY (stage_id) REFERENCES event_stages(id),
  CONSTRAINT fk_v2_reactions_activity FOREIGN KEY (activity_id) REFERENCES event_activities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
