CREATE TABLE IF NOT EXISTS qna_questions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  qna_round_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  audience_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  question_text VARCHAR(1000) NOT NULL,
  name VARCHAR(120) NULL,
  allow_name_on_screen TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('new', 'selected') NOT NULL DEFAULT 'new',
  selected_round_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  projected_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_qna_question_per_audience (qna_round_id, audience_id),
  UNIQUE KEY uq_qna_selected_per_round (selected_round_id),
  KEY idx_qna_questions_round_created (qna_round_id, created_at),
  KEY idx_qna_questions_projected (qna_round_id, projected_at),
  CONSTRAINT ck_qna_question_selection
    CHECK (
      (status = 'new' AND selected_round_id IS NULL)
      OR (status = 'selected' AND selected_round_id = qna_round_id)
    ),
  CONSTRAINT fk_qna_questions_round
    FOREIGN KEY (qna_round_id) REFERENCES qna_rounds (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
