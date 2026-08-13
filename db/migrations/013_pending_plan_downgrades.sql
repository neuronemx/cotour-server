ALTER TABLE workspaces
  ADD COLUMN pending_plan VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER plan,
  ADD COLUMN pending_plan_requested_at DATETIME(3) NULL AFTER pending_plan,
  ADD COLUMN pending_plan_requested_by_user_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER pending_plan_requested_at,
  ADD COLUMN pending_plan_note VARCHAR(500) NULL AFTER pending_plan_requested_by_user_id;
