CREATE TABLE IF NOT EXISTS billing_event_pass_purchases (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_checkout_session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_payment_intent_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_price_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_event_pass_session (provider_checkout_session_id),
  UNIQUE KEY uq_billing_event_pass_grant (grant_id),
  KEY idx_billing_event_pass_workspace (workspace_id, ends_at),
  CONSTRAINT fk_billing_event_pass_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_billing_event_pass_grant FOREIGN KEY (grant_id) REFERENCES workspace_plan_grants (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
