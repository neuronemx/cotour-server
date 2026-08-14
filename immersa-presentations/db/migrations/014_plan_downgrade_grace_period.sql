ALTER TABLE workspaces
  ADD COLUMN pending_plan_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER pending_plan,
  ADD COLUMN pending_plan_deadline_at DATETIME(3) NULL AFTER pending_plan_requested_at;

CREATE TABLE IF NOT EXISTS plan_downgrade_notifications (
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deadline_at DATETIME(3) NOT NULL,
  available_at DATETIME(3) NOT NULL,
  claimed_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (request_id, kind),
  KEY idx_plan_downgrade_notifications_due (sent_at, available_at),
  CONSTRAINT fk_plan_downgrade_notifications_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE workspaces
SET pending_plan_request_id = UUID(),
    pending_plan_deadline_at = DATE_ADD(COALESCE(pending_plan_requested_at, CURRENT_TIMESTAMP(3)), INTERVAL 7 DAY)
WHERE pending_plan IS NOT NULL AND pending_plan_request_id IS NULL;

INSERT IGNORE INTO plan_downgrade_notifications
  (request_id, kind, workspace_id, target_plan, deadline_at, available_at)
SELECT pending_plan_request_id, 'requested', id, pending_plan, pending_plan_deadline_at, CURRENT_TIMESTAMP(3)
FROM workspaces WHERE pending_plan IS NOT NULL;

INSERT IGNORE INTO plan_downgrade_notifications
  (request_id, kind, workspace_id, target_plan, deadline_at, available_at)
SELECT pending_plan_request_id, 'reminder', id, pending_plan, pending_plan_deadline_at,
       DATE_SUB(pending_plan_deadline_at, INTERVAL 2 DAY)
FROM workspaces WHERE pending_plan IS NOT NULL;

INSERT IGNORE INTO plan_downgrade_notifications
  (request_id, kind, workspace_id, target_plan, deadline_at, available_at)
SELECT pending_plan_request_id, 'expired', id, pending_plan, pending_plan_deadline_at, pending_plan_deadline_at
FROM workspaces WHERE pending_plan IS NOT NULL;
