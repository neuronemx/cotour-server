SET @immersa_live_scope_ddl = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='event_live_sessions' AND INDEX_NAME='uq_event_live_v2_scope'),
  'DO 0',
  'ALTER TABLE event_live_sessions ADD UNIQUE KEY uq_event_live_v2_scope (event_workspace_id,id)'
);
PREPARE immersa_live_scope_stmt FROM @immersa_live_scope_ddl;
EXECUTE immersa_live_scope_stmt;
DEALLOCATE PREPARE immersa_live_scope_stmt;
CREATE TABLE IF NOT EXISTS event_live_content (
  live_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  binding_revision INT UNSIGNED NOT NULL,
  manifest_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  configuration_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  bundle_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  approval_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pinned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (live_session_id),
  CONSTRAINT fk_live_content_live FOREIGN KEY (event_id,live_session_id) REFERENCES event_live_sessions(event_workspace_id,id),
  CONSTRAINT fk_live_content_version FOREIGN KEY (event_id,deck_id,version_id) REFERENCES event_deck_versions(event_id,deck_id,id),
  CONSTRAINT fk_live_content_check FOREIGN KEY (version_id) REFERENCES event_deck_checks(version_id),
  CONSTRAINT chk_live_content_revision CHECK (binding_revision>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
