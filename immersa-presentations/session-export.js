const ExcelJS = require("exceljs");

function sheet(workbook, name, columns) {
  const page = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  page.columns = columns.map(([header, key, width = 24]) => ({ header, key, width, style: { font: { name: "Calibri", size: 11 }, alignment: { vertical: "top", wrapText: true } } }));
  page.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  page.getRow(1).font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
  page.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7134BC" } };
  page.getRow(1).height = 26;
  page.getRow(1).commit();
  return page;
}

async function writeSessionWorkbook(repository, summary, stream) {
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true });
  const common = [["Sesión", "sessionId", 38], ["Deck", "deckId", 28]];
  const sheets = {
    summary: sheet(book, "Resumen", [...common, ["Métrica", "metric", 36], ["Valor", "value", 22]]),
    people: sheet(book, "Asistentes", [...common, ["ID asistente", "id", 38], ["Nombre", "name"], ["Correo", "email", 32], ["Teléfono", "phone"], ["Empresa", "company"],
      ["Idioma", "locale", 12], ["Ingreso", "joinedAt"], ["Acciones", "actions", 12], ["Respuestas", "answers", 12], ["Preguntas", "questions", 12],
      ["Reacciones", "reactions", 12], ["Sorteos", "raffles", 12], ["Ganados", "wins", 12], ["Términos aceptados", "termsAcceptedAt"], ["Enlace de términos", "termsUrl", 48]]),
    answers: sheet(book, "Respuestas", [...common, ["ID asistente", "id", 38], ["Tipo", "type"], ["Actividad", "title"], ["Pregunta", "question", 50], ["Respuesta", "answer", 50], ["Correcta", "correct", 12], ["Fecha", "at"]]),
    questions: sheet(book, "Preguntas", [...common, ["ID asistente", "id", 38], ["Pregunta", "text", 60], ["Enviada", "at"], ["Proyectada", "projectedAt"]]),
    reactions: sheet(book, "Reacciones", [...common, ["ID asistente", "id", 38], ["Tipo", "emoji", 12], ["Cantidad", "count", 12]]),
    raffles: sheet(book, "Sorteos", [...common, ["ID sorteo", "raffleId", 38], ["Sorteo", "title"], ["Estado", "state"], ["ID asistente", "id", 38], ["Nombre", "name"],
      ["Boleto", "ticket", 12], ["Opción", "option"], ["Ingreso", "enteredAt"], ["Ganador", "winner", 12], ["Fecha ganador", "winnerAt", 40], ["Veces ganador", "wins", 16]]),
    brands: sheet(book, "Marcas", [...common, ["ID marca", "id", 38], ["Marca", "name"], ["Despliegues", "displays", 16], ["Vistas", "impressions", 12], ["Espectadores únicos", "viewers", 22], ["Clics", "clicks", 12], ["Personas con clic", "clickers", 20]]),
    events: sheet(book, "Actividad de marcas", [...common, ["ID asistente", "id", 38], ["ID marca", "brandId", 38], ["Marca", "name"], ["ID despliegue", "displayId", 38], ["Tipo", "kind"], ["Fecha", "at"], ["Destino", "url", 48]])
  };
  const base = { sessionId: summary.id, deckId: summary.deckId };
  const rowCounts = new Map();
  function add(page, data) {
    const count = rowCounts.get(page.name) || 1;
    if (count >= 1048576) throw new Error("La sesión supera el límite de filas de Excel.");
    const values = Object.fromEntries(Object.entries({...base, ...data}).map(([key,value]) => [key,value instanceof Date ? value.toISOString() : value]));
    page.addRow(values).commit();
    rowCounts.set(page.name, count + 1);
  }
  const pollAnswers = summary.polls.reduce((n, p) => n + p.totalResponses, 0);
  const metrics = { "Inicio": summary.startedAt, "Fin": summary.endedAt, "Duración en segundos": summary.durationSeconds,
    "Asistentes": summary.participants.connected, "Pico de conexiones": summary.participants.peak, "Asistentes ES": summary.participants.locales?.es || 0, "Asistentes EN": summary.participants.locales?.en || 0,
    "Participantes activos": summary.participation.active, "Participación (%)": summary.participation.percentage,
    "Encuestas": summary.polls.length, "Respuestas a encuestas": pollAnswers, "Preguntas recibidas": summary.qna.received,
    "Preguntas proyectadas": summary.qna.projected, "Reacciones": summary.reactions.total,
    "Sorteos": summary.raffles.total, "Participaciones en sorteos": summary.raffles.entries, "Ganadores": summary.raffles.winners,
    "Cobertura individual desde": summary.recordedSince || "", "Exportado": new Date().toISOString() };
  for (const [emoji, count] of Object.entries(summary.reactions.byEmoji || {})) metrics["Reacciones " + emoji] = count;
  for (const k of summary.knowledge) {
    metrics[k.category === "contest" ? "Trivias" : "Evaluaciones"] = k.executions;
    metrics[k.category === "contest" ? "Respuestas a trivias" : "Respuestas a evaluaciones"] = k.answers;
  }
  for (const [metric, value] of Object.entries(metrics)) add(sheets.summary, { metric, value });
  for (const poll of summary.polls) for (const option of poll.options || []) {
    add(sheets.summary, {metric: poll.prompt + " · " + option.label, value: option.count});
  }
  const raffles = await repository.raffles(summary.id);
  let offset = 0;
  for (;;) {
    const data = await repository.engagement.details(summary.deckId, summary.id, { page: offset++ });
    for (const person of data.attendees) {
      const raffleCount = raffles.filter(r => r.entries?.some(e => e.audienceId === person.id)).length;
      const wins = raffles.filter(r => r.winners?.some(e => e.audienceId === person.id)).length;
      add(sheets.people, { ...person, raffles: raffleCount, wins, actions: person.actions + raffleCount, answers: person.answers.length, questions: person.questions.length, reactions: person.reactions.total });
      for (const answer of person.answers) add(sheets.answers, { id: person.id, ...answer });
      for (const question of person.questions) add(sheets.questions, { id: person.id, ...question });
      for (const [emoji, count] of Object.entries(person.reactions.byEmoji)) add(sheets.reactions, { id: person.id, emoji, count });
    }
    if (offset * 100 >= data.total) break;
    if (stream.destroyed) throw new Error("Exportación cancelada.");
  }
  for (const raffle of raffles) {
    const entries = raffle.entries?.length ? raffle.entries : [{}];
    for (const entry of entries) add(sheets.raffles, {
      raffleId: raffle.executionId, title: raffle.title, state: raffle.state, id: entry.audienceId, name: entry.name,
      ticket: entry.ticketNumber, option: raffle.options?.find(o => o.id === entry.selectedOptionId)?.label || "",
      enteredAt: entry.enteredAt, winner: raffle.winners?.some(w => w.audienceId === entry.audienceId) || false,
      wins: (raffle.winners || []).filter(w => w.audienceId === entry.audienceId).length,
      winnerAt: (raffle.winners || []).filter(w => w.audienceId === entry.audienceId).map(w => w.selectedAt || raffle.winnerSelectedAt || "").join(" · ")
    });
  }
  for (const brand of summary.brands) add(sheets.brands, brand);
  for (let offset = 0;; offset += 1000) {
    const [events] = await repository.pool.execute(
      `SELECT * FROM (
        SELECT v.audience_id AS id, v.brand_id AS brandId, v.brand_name AS name, v.display_id AS displayId, 'vista' AS kind,
          v.viewed_at AS at, v.target_url AS url, v.display_id AS eventId
        FROM presentation_banner_views v WHERE v.presentation_session_id = ?
        UNION ALL
        SELECT c.audience_id, v.brand_id, v.brand_name, c.display_id, 'clic', c.clicked_at, v.target_url, c.event_id
        FROM presentation_banner_clicks c JOIN presentation_banner_views v
          ON v.presentation_session_id=c.presentation_session_id AND v.display_id=c.display_id AND v.audience_id=c.audience_id
        WHERE c.presentation_session_id = ?
      ) events ORDER BY at, kind, eventId, id LIMIT 1000 OFFSET ${offset}`, [summary.id, summary.id]
    );
    for (const event of events) add(sheets.events, event);
    if (events.length < 1000) break;
    if (stream.destroyed) throw new Error("Exportación cancelada.");
  }
  for (const page of Object.values(sheets)) page.commit();
  await book.commit();
}

function createSessionDataHandlers(repository) {
  return {
    async summary(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        const result = await repository.summary(req.params.deckId, req.params.sessionId);
        if (!result) return res.status(404).json({ error: "Sesión no encontrada." });
        res.json(result);
      } catch (error) {
        console.error("Unable to load session dashboard", error);
        res.status(500).json({ error: "No se pudo cargar la sesión." });
      }
    },
    async export(req, res) {
      try {
        const summary = await repository.summary(req.params.deckId, req.params.sessionId);
        if (!summary) return res.status(404).json({ error: "Sesión no encontrada." });
        res.set("Cache-Control", "no-store");
        res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.attachment("IMMERSA-sesion-" + summary.id.replace(/[^a-z0-9-]/gi, "") + ".xlsx");
        await writeSessionWorkbook(repository, summary, res);
      } catch (error) {
        console.error("Unable to export session", error);
        if (res.headersSent) return res.destroy(error);
        res.status(500).json({ error: "No se pudo exportar la sesión." });
      }
    }
  };
}

module.exports = { writeSessionWorkbook, createSessionDataHandlers };
