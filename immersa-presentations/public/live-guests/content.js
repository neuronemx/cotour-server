(function (root) {
  function create({ document, resultsHost, reactionsHost }) {
    const reactions = new Map();
    function setResults(results) {
      resultsHost.replaceChildren();
      resultsHost.hidden = !results;
      if (!results) return;
      const title = document.createElement("h2"); title.textContent = results.title || "Resultados";
      const prompt = document.createElement("p"); prompt.textContent = results.prompt || "";
      const total = document.createElement("small"); total.textContent = String(results.totalResponses || 0) + " respuestas";
      resultsHost.append(title, prompt, total);
      for (const option of (results.options || []).slice(0, 50)) {
        const row = document.createElement("div"); row.className = "guest-poll-row";
        const heading = document.createElement("div"); heading.className = "guest-poll-label";
        const label = document.createElement("span"); label.textContent = option.label;
        const percentage = Math.max(0, Math.min(100, Number(option.percentage) || 0));
        const count = document.createElement("strong"); count.textContent = percentage + "%";
        heading.append(label, count);
        const bar = document.createElement("div"); bar.className = "guest-poll-bar";
        const fill = document.createElement("span"); fill.style.width = percentage + "%"; bar.append(fill);
        row.append(heading, bar); resultsHost.append(row);
      }
    }
    function react(payload) {
      if (!["❤️", "👏", "🔥"].includes(payload?.emoji) || reactions.size >= 12) return;
      const node = document.createElement("span"); node.className = "guest-reaction"; node.textContent = payload.emoji;
      node.style.left = (15 + Math.random() * 70) + "%";
      node.style.setProperty("--drift", (Math.random() * 80 - 40) + "px");
      reactionsHost.append(node);
      reactions.set(node, setTimeout(() => { node.remove(); reactions.delete(node); }, 3100));
    }
    function clear() {
      setResults(null);
      for (const [node, timer] of reactions) { clearTimeout(timer); node.remove(); }
      reactions.clear();
    }
    return { setResults, react, clear };
  }
  root.ImmersaGuestContent = { create };
  if (typeof module === "object") module.exports = { create };
})(typeof window === "object" ? window : globalThis);
