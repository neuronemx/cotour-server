-- An invitation links a speaker account to Event Hub. Deck selection occurs later in Deck Check.
UPDATE event_activity_speaker_assignments
SET status = 'LINKED', selected_deck_id = NULL
WHERE status = 'DECK_SELECTED';
