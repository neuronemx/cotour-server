-- Separate Events raffle state. Every statement can recover after partial DDL.
-- Snapshot is private operational state, never a public DTO or history API.
CREATE TABLE IF NOT EXISTS event_v2_raffle_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(191) NOT NULL,
  catalog_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  snapshot_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT fk_v2_raffle_live FOREIGN KEY (id) REFERENCES event_live_sessions(id),
  CONSTRAINT fk_v2_raffle_stage FOREIGN KEY (stage_id) REFERENCES event_stages(id),
  CONSTRAINT fk_v2_raffle_activity FOREIGN KEY (activity_id) REFERENCES event_activities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
