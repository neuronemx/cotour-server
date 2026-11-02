ALTER TABLE presentation_session_attendance
  ADD COLUMN locale VARCHAR(2) NOT NULL DEFAULT 'es' AFTER audience_id;
