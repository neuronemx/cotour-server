ALTER TABLE event_activities
  ADD COLUMN pending_deck_id VARCHAR(191) NULL AFTER deck_id,
  ADD COLUMN deck_check_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING' AFTER pending_deck_id,
  ADD COLUMN deck_check_updated_at DATETIME(3) NULL AFTER deck_check_status;
