CREATE TABLE IF NOT EXISTS workspace_demo_sessions (
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reset_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id),
  UNIQUE KEY uq_workspace_demo_deck (deck_id),
  UNIQUE KEY uq_workspace_demo_session (session_id),
  CONSTRAINT fk_workspace_demo_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
