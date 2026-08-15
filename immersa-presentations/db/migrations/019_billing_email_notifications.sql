CREATE TABLE IF NOT EXISTS billing_email_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_object_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  amount_total BIGINT UNSIGNED NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  period_end DATETIME(3) NULL,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claimed_at DATETIME(3) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  sent_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_email_notifications_object_kind (provider_object_id, kind),
  KEY idx_billing_email_notifications_due (sent_at, available_at, claimed_at),
  CONSTRAINT fk_billing_email_notifications_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
