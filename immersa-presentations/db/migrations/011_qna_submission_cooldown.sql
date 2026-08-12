ALTER TABLE qna_questions
  DROP INDEX uq_qna_question_per_audience,
  ADD KEY idx_qna_questions_audience_cooldown (qna_round_id, audience_id, created_at);
