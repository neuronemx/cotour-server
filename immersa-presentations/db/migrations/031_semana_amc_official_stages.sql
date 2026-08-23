-- Semana AMC official Event Stages. Existing activities keep their stage IDs.
UPDATE event_stages SET name = 'CCC Sala THX', sort_order = 0 WHERE name = 'CCC';
UPDATE event_stages SET name = 'CHURUBUSCO Foro 2', sort_order = 3 WHERE name = 'Foro 2';

INSERT INTO event_stages (id, event_workspace_id, name, sort_order, audience_capacity)
SELECT UUID(), h.workspace_id, 'CHURUBUSCO Foro NELA', 1, 300
FROM event_hubs h
WHERE NOT EXISTS (SELECT 1 FROM event_stages s WHERE s.event_workspace_id = h.workspace_id AND s.name = 'CHURUBUSCO Foro NELA');

INSERT INTO event_stages (id, event_workspace_id, name, sort_order, audience_capacity)
SELECT UUID(), h.workspace_id, 'CHURUBUSCO Foro A', 2, 300
FROM event_hubs h
WHERE NOT EXISTS (SELECT 1 FROM event_stages s WHERE s.event_workspace_id = h.workspace_id AND s.name = 'CHURUBUSCO Foro A');

INSERT INTO event_stages (id, event_workspace_id, name, sort_order, audience_capacity)
SELECT UUID(), h.workspace_id, 'CHURUBUSCO Lobby', 4, 300
FROM event_hubs h
WHERE NOT EXISTS (SELECT 1 FROM event_stages s WHERE s.event_workspace_id = h.workspace_id AND s.name = 'CHURUBUSCO Lobby');
