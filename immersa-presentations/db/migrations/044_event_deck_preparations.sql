-- Conversion is immutable preparation data, not Deck Check approval. Version
-- status remains DRAFT and no live reader consumes this table yet.
CREATE TABLE IF NOT EXISTS event_deck_preparations (
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_size INT UNSIGNED NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slide_count INT UNSIGNED NULL,
  manifest_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  manifest_json MEDIUMTEXT NULL,
  error_code VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (version_id),
  UNIQUE KEY uq_event_deck_preparation_attempt (attempt_id),
  CONSTRAINT fk_event_deck_preparation_scope FOREIGN KEY (event_id, deck_id, version_id)
    REFERENCES event_deck_versions(event_id, deck_id, id),
  CONSTRAINT chk_event_deck_preparation_status CHECK (status IN ('PROCESSING','CONVERTED','FAILED')),
  CONSTRAINT chk_event_deck_preparation_size CHECK (source_size > 0 AND source_size <= 104857600),
  CONSTRAINT chk_event_deck_preparation_result CHECK (
    (status = 'PROCESSING' AND slide_count IS NULL AND manifest_digest IS NULL AND manifest_json IS NULL AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'CONVERTED' AND slide_count IS NOT NULL AND slide_count BETWEEN 1 AND 500 AND manifest_digest IS NOT NULL AND manifest_json IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status = 'FAILED' AND slide_count IS NULL AND manifest_digest IS NULL AND manifest_json IS NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
