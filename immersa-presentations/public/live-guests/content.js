(function (root) {
  function create({ document, resultsHost, reactionsHost, questionHost, slideHost }) {
    const reactions = new Map();
    let currentResults = null;
    let currentQuestion = null;
    function syncVisibility() {
      resultsHost.hidden = Boolean(currentQuestion) || !currentResults;
      if (questionHost) questionHost.hidden = !currentQuestion;
      slideHost?.classList.toggle("has-public-content", Boolean(currentQuestion || currentResults));
    }
    function setResults(results) {
      currentResults = results;
      resultsHost.replaceChildren();
      syncVisibility();
      if (!results) return;
      const prompt = document.createElement("p"); prompt.textContent = results.prompt || "";
      const total = document.createElement("small"); total.textContent = String(results.totalResponses || 0) + " respuestas";
      resultsHost.append(prompt, total);
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
    function setQuestion(question) {
      const next = question?.text ? question : null;
      const changed = next?.text !== currentQuestion?.text || next?.name !== currentQuestion?.name;
      currentQuestion = next;
      if (questionHost && changed) {
        questionHost.replaceChildren();
        if (currentQuestion) {
          const text = document.createElement("p"); text.textContent = currentQuestion.text;
          questionHost.append(text);
          if (currentQuestion.name) {
            const name = document.createElement("small"); name.textContent = currentQuestion.name;
            questionHost.append(name);
          }
        }
      }
      syncVisibility();
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
      setQuestion(null);
      setResults(null);
      for (const [node, timer] of reactions) { clearTimeout(timer); node.remove(); }
      reactions.clear();
    }
    return { setResults, setQuestion, react, clear };
  }
  root.ImmersaGuestContent = { create };
  if (typeof module === "object") module.exports = { create };
})(typeof window === "object" ? window : globalThis);
