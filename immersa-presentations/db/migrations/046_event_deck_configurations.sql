-- Immutable authored configuration is preparation, never Deck Check approval.
CREATE TABLE IF NOT EXISTS event_deck_configurations (
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_manifest_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configuration_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configuration_json MEDIUMTEXT NOT NULL,
  created_by_user_id VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version_id),
  CONSTRAINT fk_event_deck_configuration_scope FOREIGN KEY (event_id, deck_id, version_id)
    REFERENCES event_deck_versions(event_id, deck_id, id),
  CONSTRAINT chk_event_deck_configuration_size CHECK (OCTET_LENGTH(configuration_json) BETWEEN 1 AND 1048576),
  CONSTRAINT chk_event_deck_configuration_json CHECK (JSON_VALID(configuration_json)),
  CONSTRAINT chk_event_deck_configuration_digests CHECK (
    source_manifest_digest REGEXP '^[a-f0-9]{64}$' AND configuration_digest REGEXP '^[a-f0-9]{64}$'
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
