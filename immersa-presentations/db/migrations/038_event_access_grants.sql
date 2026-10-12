-- Additive and recoverable after partial DDL. Never migrate v1 credentials.
CREATE TABLE IF NOT EXISTS event_operational_windows (
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  CONSTRAINT fk_event_window_context FOREIGN KEY (event_id) REFERENCES event_v2_contexts(event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_access_grants (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issuer_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  issuer_org_version INT UNSIGNED NULL,
  issuer_event_version INT UNSIGNED NULL,
  stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  live_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  participant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  public_qr_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  not_before DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  authz_version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_grant_hash (token_hash),
  KEY idx_event_grant_event (event_id, revoked_at),
  CONSTRAINT fk_event_grant_context FOREIGN KEY (event_id) REFERENCES event_v2_contexts(event_id),
  CONSTRAINT fk_event_grant_stage FOREIGN KEY (stage_id) REFERENCES event_stages(id),
  CONSTRAINT fk_event_grant_activity FOREIGN KEY (activity_id) REFERENCES event_activities(id),
  CONSTRAINT fk_event_grant_live FOREIGN KEY (live_session_id) REFERENCES event_live_sessions(id),
  CONSTRAINT fk_event_grant_participant FOREIGN KEY (participant_id) REFERENCES event_participants(id),
  CONSTRAINT fk_event_grant_qr FOREIGN KEY (public_qr_id) REFERENCES event_public_qrs(id),
  CONSTRAINT chk_event_grant_scope CHECK (
    (kind IN ('VENUE','MODERATOR') AND purpose = 'live' AND stage_id IS NULL AND activity_id IS NULL AND live_session_id IS NULL AND participant_id IS NULL AND public_qr_id IS NULL)
    OR (kind = 'STAGE' AND purpose = 'live' AND stage_id IS NOT NULL AND activity_id IS NULL AND live_session_id IS NULL AND participant_id IS NULL AND public_qr_id IS NULL)
    OR (kind = 'SPEAKER' AND purpose IN ('live','rehearsal') AND stage_id IS NOT NULL AND activity_id IS NOT NULL AND live_session_id IS NULL AND participant_id IS NULL AND public_qr_id IS NULL)
    OR (kind = 'PLAYER' AND purpose = 'player' AND stage_id IS NOT NULL AND activity_id IS NOT NULL AND live_session_id IS NOT NULL AND participant_id IS NULL AND public_qr_id IS NULL)
    OR (kind = 'PARTICIPANT' AND purpose = 'public' AND stage_id IS NULL AND activity_id IS NULL AND live_session_id IS NULL AND participant_id IS NOT NULL AND public_qr_id IS NOT NULL)
  ),
  CONSTRAINT chk_event_grant_issuer CHECK (
    (kind = 'PARTICIPANT' AND issuer_user_id IS NULL AND issuer_org_version IS NULL AND issuer_event_version IS NULL)
    OR (kind <> 'PARTICIPANT' AND issuer_user_id IS NOT NULL AND issuer_org_version IS NOT NULL AND issuer_event_version IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_grant_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_hash),
  KEY idx_event_grant_session (grant_id, expires_at),
  CONSTRAINT fk_event_grant_session FOREIGN KEY (grant_id) REFERENCES event_access_grants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_participant_identities (
  participant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(120) NULL,
  PRIMARY KEY (participant_id),
  CONSTRAINT fk_event_participant_identity FOREIGN KEY (participant_id) REFERENCES event_participants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
