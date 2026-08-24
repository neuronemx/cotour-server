-- Event Hub is intentionally separate from a Speaker's commercial workspace
-- and from the Deck runtime's presentation_sessions.
ALTER TABLE workspaces
  MODIFY personal_owner_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL;

CREATE TABLE IF NOT EXISTS event_hubs (
  workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(191) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  created_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id),
  UNIQUE KEY uq_event_hubs_slug (slug),
  CONSTRAINT fk_event_hubs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_stages (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(120) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_stage_name (event_workspace_id, name),
  KEY idx_event_stages_workspace (event_workspace_id, sort_order),
  CONSTRAINT fk_event_stages_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_activities (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(191) NOT NULL,
  access_level VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PAID',
  scheduled_starts_at DATETIME(3) NULL,
  scheduled_ends_at DATETIME(3) NULL,
  deck_id VARCHAR(191) NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SCHEDULED',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_event_activities_stage_schedule (event_stage_id, scheduled_starts_at),
  KEY idx_event_activities_workspace_status (event_workspace_id, status),
  CONSTRAINT fk_event_activities_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_activities_stage FOREIGN KEY (event_stage_id) REFERENCES event_stages (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_live_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id VARCHAR(191) NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'LIVE',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_event_live_sessions_stage_live (event_stage_id, status, started_at),
  KEY idx_event_live_sessions_activity (event_activity_id, started_at),
  CONSTRAINT fk_event_live_sessions_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_live_sessions_activity FOREIGN KEY (event_activity_id) REFERENCES event_activities (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_event_live_sessions_stage FOREIGN KEY (event_stage_id) REFERENCES event_stages (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_public_qrs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  public_id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_level VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_public_qrs_public_id (public_id),
  UNIQUE KEY uq_event_public_qrs_level (event_workspace_id, audience_level),
  CONSTRAINT fk_event_public_qrs_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_participants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_workspace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_level VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_participant_identity (event_workspace_id, registration_key_hash),
  CONSTRAINT fk_event_participants_hub FOREIGN KEY (event_workspace_id) REFERENCES event_hubs (workspace_id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_live_attendance (
  event_live_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_participant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_live_session_id, event_participant_id),
  CONSTRAINT fk_event_attendance_live_session FOREIGN KEY (event_live_session_id) REFERENCES event_live_sessions (id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT fk_event_attendance_participant FOREIGN KEY (event_participant_id) REFERENCES event_participants (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
