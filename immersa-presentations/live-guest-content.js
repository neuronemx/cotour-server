// Public, aggregated poll data only. Never include individual responses or role tokens.
function guestPollResults(results, locale = "es") {
  if (!results || results.type !== "poll" || !Array.isArray(results.options)) return null;
  const labels = results.en?.options || {};
  const english = locale === "en" && results.en?.prompt?.trim()
    && results.options.every(option => String(labels[option.id] || "").trim());
  const text = (value, limit) => String(value || "").slice(0, limit);
  return {
    title: english ? "Poll" : text(results.title || "Resultados", 200),
    prompt: text(english ? results.en.prompt : results.prompt, 2000),
    totalResponses: Math.max(0, Number(results.totalResponses) || 0),
    options: results.options.slice(0, 50).map(option => ({
      label: text(english ? labels[option.id] : option.label, 500),
      count: Math.max(0, Number(option.count) || 0),
      percentage: Math.max(0, Math.min(100, Number(option.percentage) || 0))
    }))
  };
}

module.exports = { guestPollResults };
