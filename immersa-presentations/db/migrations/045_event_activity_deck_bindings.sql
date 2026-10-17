-- The legacy activity id is globally unique. This additional scoped candidate
-- key allows a real composite FK without changing any activity data. Check
-- metadata first so a partially completed migration can safely run again.
SET @immersa_activity_scope_ddl = IF(
  EXISTS (SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='event_activities' AND INDEX_NAME='uq_event_activity_v2_scope'),
  'DO 0',
  'ALTER TABLE event_activities ADD UNIQUE KEY uq_event_activity_v2_scope (event_workspace_id,id)'
);
PREPARE immersa_activity_scope_stmt FROM @immersa_activity_scope_ddl;
EXECUTE immersa_activity_scope_stmt;
DEALLOCATE PREPARE immersa_activity_scope_stmt;

-- A cleared binding remains as a revisioned tombstone, preventing stale writes
-- and any fallback to an older legacy deck. This is not Deck Check approval.
CREATE TABLE IF NOT EXISTS event_activity_deck_bindings (
  activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  manifest_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  slide_count INT UNSIGNED NULL,
  revision INT UNSIGNED NOT NULL,
  updated_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (activity_id),
  CONSTRAINT fk_activity_deck_binding_context FOREIGN KEY (event_id) REFERENCES event_v2_contexts(event_id),
  CONSTRAINT fk_activity_deck_binding_activity FOREIGN KEY (event_id,activity_id) REFERENCES event_activities(event_workspace_id,id),
  CONSTRAINT fk_activity_deck_binding_version FOREIGN KEY (event_id,deck_id,version_id) REFERENCES event_deck_versions(event_id,deck_id,id),
  CONSTRAINT chk_activity_deck_binding_revision CHECK (revision > 0),
  CONSTRAINT chk_activity_deck_binding_source CHECK (
    (deck_id IS NULL AND version_id IS NULL AND manifest_digest IS NULL AND slide_count IS NULL)
    OR (deck_id IS NOT NULL AND version_id IS NOT NULL AND manifest_digest IS NOT NULL
      AND slide_count IS NOT NULL AND slide_count BETWEEN 1 AND 500)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
