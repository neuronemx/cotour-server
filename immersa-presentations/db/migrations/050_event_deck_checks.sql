-- Approval is an immutable, scoped record for a verified prepared bundle.
-- It is not a legacy activity flag and does not itself enable live readers.
CREATE TABLE IF NOT EXISTS event_deck_checks (
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configuration_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bundle_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approval_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approval_json MEDIUMTEXT NOT NULL,
  approved_by_user_id VARCHAR(191) NOT NULL,
  approved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version_id),
  KEY ix_event_check_scope (event_id,deck_id,version_id),
  CONSTRAINT fk_event_check_scope FOREIGN KEY (event_id,deck_id,version_id)
    REFERENCES event_deck_versions(event_id,deck_id,id),
  CONSTRAINT chk_event_check_json CHECK (JSON_VALID(approval_json) AND OCTET_LENGTH(approval_json) BETWEEN 1 AND 262144)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
