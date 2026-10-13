-- Separate Events Q&A storage. LiveSession ID is canonical; no legacy sessions.
-- Every statement is re-runnable after partial DDL.
CREATE TABLE IF NOT EXISTS event_v2_qna_sessions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stage_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deck_id VARCHAR(191) NOT NULL,
  version_id VARCHAR(191) NOT NULL,
  source_session_id VARCHAR(191) NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ended_at DATETIME(3) NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT fk_v2_qna_live FOREIGN KEY (id) REFERENCES event_live_sessions(id),
  CONSTRAINT fk_v2_qna_stage FOREIGN KEY (stage_id) REFERENCES event_stages(id),
  CONSTRAINT fk_v2_qna_activity FOREIGN KEY (activity_id) REFERENCES event_activities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_v2_qna_rounds (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  presentation_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  round_number INT UNSIGNED NOT NULL,
  questions_open TINYINT(1) NOT NULL DEFAULT 0,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  archived_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_v2_qna_round_number (presentation_session_id, round_number),
  CONSTRAINT fk_v2_qna_round_live FOREIGN KEY (presentation_session_id) REFERENCES event_v2_qna_sessions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_v2_qna_questions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  qna_round_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  question_text VARCHAR(1000) NOT NULL,
  name VARCHAR(120) NULL,
  allow_name_on_screen TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('new','selected') NOT NULL DEFAULT 'new',
  selected_round_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  projected_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_v2_qna_selected (selected_round_id),
  KEY idx_v2_qna_cooldown (qna_round_id,audience_id,created_at),
  CONSTRAINT ck_v2_qna_selection CHECK ((status = 'new' AND selected_round_id IS NULL)
    OR (status = 'selected' AND selected_round_id = qna_round_id)),
  CONSTRAINT fk_v2_qna_question_round FOREIGN KEY (qna_round_id) REFERENCES event_v2_qna_rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_v2_qna_question_participant FOREIGN KEY (audience_id) REFERENCES event_participants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_v2_qna_projection (
  live_session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  question_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  visible TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (live_session_id),
  CONSTRAINT fk_v2_qna_projection_live FOREIGN KEY (live_session_id) REFERENCES event_v2_qna_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_v2_qna_projection_question FOREIGN KEY (question_id) REFERENCES event_v2_qna_questions(id),
  CONSTRAINT ck_v2_qna_projection CHECK (visible = 0 OR question_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
