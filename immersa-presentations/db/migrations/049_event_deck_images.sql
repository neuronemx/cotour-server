-- Event images are private immutable preparation, not Deck Check approval.
CREATE TABLE IF NOT EXISTS event_deck_images (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_size INT UNSIGNED NOT NULL,
  source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  metadata_json TEXT NULL,
  metadata_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  error_code VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_by_user_id VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY ix_event_image_version (event_id,deck_id,version_id),
  CONSTRAINT fk_event_image_scope FOREIGN KEY (event_id,deck_id,version_id)
    REFERENCES event_deck_versions(event_id,deck_id,id),
  CONSTRAINT chk_event_image_size CHECK (source_size BETWEEN 1 AND 5242880),
  CONSTRAINT chk_event_image_result CHECK (
    (status='PROCESSING' AND metadata_json IS NULL AND metadata_digest IS NULL AND error_code IS NULL AND completed_at IS NULL)
    OR (status='READY' AND metadata_json IS NOT NULL AND metadata_digest IS NOT NULL AND JSON_VALID(metadata_json) AND error_code IS NULL AND completed_at IS NOT NULL)
    OR (status='FAILED' AND metadata_json IS NULL AND metadata_digest IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
