const CSV_HEADERS = ["Sesión", "Deck", "Ronda", "Pregunta", "Nombre", "Respondida", "Enviada"];

function safeSpreadsheetText(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = safeSpreadsheetText(value).replace(/"/g, '""');
  return `"${text}"`;
}

function isoDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function buildQnaCsv(rows = []) {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.presentationSessionId,
      row.deckId,
      row.roundNumber,
      row.question,
      row.name,
      row.answered ? "Sí" : "No",
      isoDate(row.createdAt)
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

module.exports = { buildQnaCsv, csvCell, safeSpreadsheetText };
