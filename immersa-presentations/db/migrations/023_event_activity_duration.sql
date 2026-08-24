ALTER TABLE event_activities
  ADD COLUMN duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 60 AFTER scheduled_starts_at;

UPDATE event_activities
  SET scheduled_ends_at = DATE_ADD(scheduled_starts_at, INTERVAL duration_minutes MINUTE)
  WHERE scheduled_starts_at IS NOT NULL AND scheduled_ends_at IS NULL;
