CREATE TABLE IF NOT EXISTS billing_customers (
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'stripe',
  provider_customer_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id),
  UNIQUE KEY uq_billing_customers_provider_customer (provider, provider_customer_id),
  CONSTRAINT fk_billing_customers_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'stripe',
  provider_subscription_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_price_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  billing_interval VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  current_period_start DATETIME(3) NULL,
  current_period_end DATETIME(3) NULL,
  access_until DATETIME(3) NULL,
  cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
  canceled_at DATETIME(3) NULL,
  discount_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  last_event_created_at DATETIME(3) NULL,
  synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id),
  UNIQUE KEY uq_billing_subscriptions_provider_subscription (provider, provider_subscription_id),
  KEY idx_billing_subscriptions_status_period (status, current_period_end),
  CONSTRAINT fk_billing_subscriptions_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_checkout_attempts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  billing_interval VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  offer_source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'official',
  provider_price_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_checkout_session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_subscription_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'creating',
  checkout_url_expires_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_checkout_attempts_session (provider_checkout_session_id),
  UNIQUE KEY uq_billing_checkout_attempts_idempotency (idempotency_key),
  KEY idx_billing_checkout_attempts_workspace_status (workspace_id, status, created_at),
  CONSTRAINT fk_billing_checkout_attempts_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  event_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_object_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_created_at DATETIME(3) NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claimed_at DATETIME(3) NULL,
  processed_at DATETIME(3) NULL,
  last_error VARCHAR(500) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  KEY idx_billing_webhook_events_due (status, available_at, claimed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_plan_grants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  origin VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ends_at DATETIME(3) NULL,
  note VARCHAR(500) NULL,
  created_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revoked_at DATETIME(3) NULL,
  revoked_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_workspace_plan_grants_active (workspace_id, revoked_at, starts_at, ends_at),
  CONSTRAINT fk_workspace_plan_grants_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  previous_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  next_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_object_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_billing_audit_log_workspace_created (workspace_id, created_at),
  CONSTRAINT fk_billing_audit_log_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
