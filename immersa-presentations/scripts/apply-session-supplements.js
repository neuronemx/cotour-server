async function applySessionSupplements(pool, env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_ID !== "9ae7d5ba-2954-4c96-818a-ee918310e20d") return;
  const marker = "data:demo-gabriel:d627d7dc:v1";
  const [applied] = await pool.execute("SELECT id FROM schema_migrations WHERE id = ?", [marker]);
  if (applied.length) return;
  const [sessions] = await pool.execute(
    `SELECT id, deck_id, source_session_id, recording_started_at, ended_at, audience_peak_count,
       (SELECT COUNT(*) FROM presentation_session_attendance a WHERE a.presentation_session_id = presentation_sessions.id) AS participant_count
     FROM presentation_sessions
     WHERE RIGHT(id, 8) = 'd627d7dc' AND recording_started_at >= '2026-11-10 00:00:00'
       AND recording_started_at < '2026-11-11 00:00:00' AND ended_at IS NOT NULL`
  );
  if (sessions.length !== 1) throw new Error("Expected exactly one completed Demo Gabriel session ending d627d7dc.");
  const session = sessions[0];
  if (Number(session.participant_count) !== 73 || Number(session.audience_peak_count) !== 60) {
    throw new Error("Session supplement attendance does not match the selected session (73 attendees, peak 60).");
  }
  const details = {
    source: "Reconstrucción aportada por Arturo Rocha",
    durationSeconds: 1080,
    raffle: { total: 1, participantsEstimate: 60, winnerName: "Geraldin Tabullo" },
    brandCount: 3,
    note: "Duración aproximada de 18 minutos. Participantes del sorteo estimados según el pico de 60 conexiones. No se reconstruyen identidades, vistas ni clics individuales."
  };
  const [result] = await pool.execute(
    "INSERT IGNORE INTO presentation_session_supplements (presentation_session_id, details) VALUES (?, ?)",
    [session.id, JSON.stringify(details)]
  );
  await pool.execute("INSERT IGNORE INTO schema_migrations (id) VALUES (?)", [marker]);
  console.log("Demo Gabriel session supplement verified:", session.id, result.affectedRows ? "saved" : "already saved");
}
module.exports = { applySessionSupplements };
