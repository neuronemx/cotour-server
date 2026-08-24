-- Event Hub v1 keeps the public capacity simple: every Event Stage starts at 300.
-- Capacity still belongs to the Stage so it never inherits a Speaker plan.
UPDATE event_stages
SET audience_capacity = 300
WHERE audience_capacity IS NULL;
