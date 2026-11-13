const DEFAULT_TIME_ZONE = "America/Mexico_City";

function dataTimeZone(value = DEFAULT_TIME_ZONE) {
  try {
    return new Intl.DateTimeFormat("es-MX", { timeZone: value }).resolvedOptions().timeZone;
  } catch (_) {
    throw Object.assign(new Error("Zona horaria inválida."), { statusCode: 400 });
  }
}

function dataDate(value) {
  if (value === null || value === undefined || value === "") return null;
  let input = value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
    input = value.replace(" ", "T") + "Z";
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDataDate(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = dataDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(date);
}

module.exports = { DEFAULT_TIME_ZONE, dataTimeZone, dataDate, formatDataDate };
