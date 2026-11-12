ALTER TABLE presentation_sessions ADD COLUMN engagement_started_at DATETIME(3) NULL;

ALTER TABLE presentation_session_attendance
  ADD COLUMN display_name VARCHAR(120) NOT NULL DEFAULT '',
  ADD COLUMN email VARCHAR(254) NOT NULL DEFAULT '',
  ADD COLUMN phone VARCHAR(40) NOT NULL DEFAULT '',
  ADD COLUMN company VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN terms_url VARCHAR(1000) NULL,
  ADD COLUMN terms_accepted_at DATETIME(3) NULL;

CREATE TABLE IF NOT EXISTS deck_audience_registration (
  deck_id VARCHAR(191) NOT NULL PRIMARY KEY,
  mode ENUM('name', 'optional', 'required') NOT NULL DEFAULT 'name',
  terms_url VARCHAR(1000) NOT NULL DEFAULT '',
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  CONSTRAINT fk_audience_registration_deck FOREIGN KEY (deck_id) REFERENCES decks (deck_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deck_audience_profiles (
  deck_id VARCHAR(191) NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(40) NOT NULL,
  company VARCHAR(160) NOT NULL,
  terms_url VARCHAR(1000) NOT NULL,
  terms_accepted_at DATETIME(3) NOT NULL,
  config_revision INT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (deck_id, audience_id),
  CONSTRAINT fk_audience_profile_registration FOREIGN KEY (deck_id) REFERENCES deck_audience_registration (deck_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presentation_audience_reactions (
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  collector_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  emoji VARCHAR(8) NOT NULL,
  reaction_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (presentation_session_id, collector_id, audience_id, emoji),
  CONSTRAINT fk_audience_reactions_session FOREIGN KEY (presentation_session_id)
    REFERENCES presentation_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS presentation_banner_views (
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  brand_id VARCHAR(191) NOT NULL,
  brand_name VARCHAR(160) NOT NULL,
  target_url VARCHAR(2000) NOT NULL,
  viewed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (presentation_session_id, display_id, audience_id),
  CONSTRAINT fk_banner_view_session FOREIGN KEY (presentation_session_id)
    REFERENCES presentation_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS presentation_banner_clicks (
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clicked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (presentation_session_id, event_id),
  KEY idx_banner_click_view (presentation_session_id, display_id, audience_id),
  CONSTRAINT fk_banner_click_view FOREIGN KEY (presentation_session_id, display_id, audience_id)
    REFERENCES presentation_banner_views (presentation_session_id, display_id, audience_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
