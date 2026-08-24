CREATE TABLE IF NOT EXISTS event_stage_operator_access (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  access_secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_stage_operator_access_secret (access_secret_hash),
  KEY idx_event_stage_operator_access_stage_active (event_stage_id, revoked_at, expires_at),
  CONSTRAINT fk_event_stage_operator_access_stage FOREIGN KEY (event_stage_id) REFERENCES event_stages (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
