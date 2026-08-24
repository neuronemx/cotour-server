-- Removing a speaker from an activity also revokes its Event Hub invitation.
DELETE asa
FROM event_activity_speaker_assignments asa
LEFT JOIN event_activity_speakers eas
  ON eas.event_activity_id = asa.event_activity_id AND eas.event_speaker_id = asa.event_speaker_id
WHERE eas.event_activity_id IS NULL;
