-- Expand-only, re-runnable after a partial DDL failure. Event Hub keeps the
-- canonical event id; this extension marks v2 without altering legacy rows.
CREATE TABLE IF NOT EXISTS event_organizations (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(191) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  create_events_enabled TINYINT(1) NOT NULL DEFAULT 0,
  authz_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_event_org_status CHECK (status IN ('ACTIVE', 'SUSPENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_organization_memberships (
  organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  authz_version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, user_id),
  KEY idx_event_org_member_user (user_id, active),
  CONSTRAINT fk_event_org_member_org FOREIGN KEY (organization_id) REFERENCES event_organizations(id),
  CONSTRAINT chk_event_org_member_role CHECK (role IN ('ADMIN', 'MEMBER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_v2_contexts (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  authz_version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_event_v2_organization (event_id, organization_id),
  KEY idx_event_v2_org (organization_id),
  CONSTRAINT fk_event_v2_hub FOREIGN KEY (event_id) REFERENCES event_hubs(workspace_id),
  CONSTRAINT fk_event_v2_org FOREIGN KEY (organization_id) REFERENCES event_organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_memberships (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  authz_version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (event_id, user_id),
  CONSTRAINT fk_event_member_context FOREIGN KEY (event_id, organization_id)
    REFERENCES event_v2_contexts(event_id, organization_id),
  CONSTRAINT fk_event_member_org_user FOREIGN KEY (organization_id, user_id)
    REFERENCES event_organization_memberships(organization_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_member_roles (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (event_id, user_id, role),
  CONSTRAINT fk_event_role_member FOREIGN KEY (event_id, user_id) REFERENCES event_memberships(event_id, user_id),
  CONSTRAINT chk_event_member_role CHECK (role IN ('ADMIN', 'PRODUCER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_security_audit (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_event_security_audit_context (event_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
