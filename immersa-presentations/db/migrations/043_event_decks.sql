-- Event-owned metadata only. Files, conversion, approval and activity bindings
-- are separate steps; a DRAFT must never satisfy the live preparation reader.
CREATE TABLE IF NOT EXISTS event_decks (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  title VARCHAR(191) NOT NULL,
  created_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_deck_scope (event_id, id),
  CONSTRAINT fk_event_deck_context FOREIGN KEY (event_id) REFERENCES event_v2_contexts(event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_deck_versions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  created_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_deck_version_scope (event_id, deck_id, id),
  UNIQUE KEY uq_event_deck_version_number (event_id, deck_id, version_number),
  CONSTRAINT fk_event_deck_version_scope FOREIGN KEY (event_id, deck_id) REFERENCES event_decks(event_id, id),
  CONSTRAINT chk_event_deck_version_number CHECK (version_number > 0),
  CONSTRAINT chk_event_deck_version_status CHECK (status = 'DRAFT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
