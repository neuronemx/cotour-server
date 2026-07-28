ALTER TABLE presentation_sessions
  ADD COLUMN recording_started_at DATETIME(3) NULL AFTER started_at;

UPDATE presentation_sessions
SET recording_started_at = started_at
WHERE recording_started_at IS NULL;

ALTER TABLE presentation_sessions
  ADD KEY idx_presentation_sessions_recording (deck_id, recording_started_at);
