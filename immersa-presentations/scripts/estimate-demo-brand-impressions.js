async function estimateDemoBrandImpressions(pool, env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_ID !== "9ae7d5ba-2954-4c96-818a-ee918310e20d") return;
  const marker = "data:demo-gabriel:impressions:v1";
  const [applied] = await pool.execute("SELECT id FROM schema_migrations WHERE id = ?", [marker]);
  if (applied.length) return;
  const sessionId = "0b4f70d1-c09e-42bd-a70d-9f95d627d7dc";
  const [rows] = await pool.execute(
    `SELECT s.details, p.audience_peak_count,
       (SELECT COUNT(*) FROM presentation_session_attendance a WHERE a.presentation_session_id = p.id) AS attendees
     FROM presentation_session_supplements s JOIN presentation_sessions p ON p.id = s.presentation_session_id
     WHERE p.id = ? AND p.ended_at IS NOT NULL`, [sessionId]
  );
  if (rows.length !== 1 || Number(rows[0].attendees) !== 73 || Number(rows[0].audience_peak_count) !== 60) {
    throw new Error("The Demo Gabriel impressions supplement does not match the selected session.");
  }
  const details = typeof rows[0].details === "string" ? JSON.parse(rows[0].details) : rows[0].details;
  const averageMinutes = 9;
  const intervalMinutes = 2;
  const calculated = Number(rows[0].attendees) * averageMinutes / intervalMinutes;
  details.brandEstimate = {
    averageConnectedMinutes: averageMinutes,
    intervalMinutes,
    calculatedImpressions: calculated,
    globalImpressions: Math.round(calculated / 10) * 10,
    explanation: "Estimación global de 73 asistentes × 9 minutos de permanencia media ÷ 2 minutos entre banners. Las 3 marcas rotan dentro de este total."
  };
  await pool.execute("UPDATE presentation_session_supplements SET details = ? WHERE presentation_session_id = ?",
    [JSON.stringify(details), sessionId]);
  await pool.execute("INSERT IGNORE INTO schema_migrations (id) VALUES (?)", [marker]);
  console.log("Demo Gabriel estimated global impressions saved:", sessionId, details.brandEstimate.globalImpressions);
}
module.exports = { estimateDemoBrandImpressions };
