CREATE TABLE IF NOT EXISTS workspace_plan_changes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  next_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'manual',
  changed_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_workspace_plan_changes_workspace_created (workspace_id, created_at),
  CONSTRAINT fk_workspace_plan_changes_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
