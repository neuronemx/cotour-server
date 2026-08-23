-- LiveSession completion is recorded independently from the programmed Activity.
-- Repair Activities completed before that separation was enforced so Stage can reopen them.
UPDATE event_activities
SET status = 'SCHEDULED'
WHERE status = 'FINISHED';
