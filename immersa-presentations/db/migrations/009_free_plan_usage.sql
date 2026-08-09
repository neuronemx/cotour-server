ALTER TABLE decks
  ADD COLUMN source_size_bytes BIGINT UNSIGNED NULL DEFAULT NULL
  AFTER created_by_user_id;
