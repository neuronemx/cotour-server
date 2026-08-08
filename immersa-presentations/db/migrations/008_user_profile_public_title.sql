ALTER TABLE user_profiles
  ADD COLUMN public_title VARCHAR(32) NOT NULL DEFAULT 'Speaker' AFTER display_name;
