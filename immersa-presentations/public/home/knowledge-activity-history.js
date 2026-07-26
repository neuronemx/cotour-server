(() => {
  const section = document.getElementById("knowledgeActivityHistory");
  const toggle = document.getElementById("knowledgeActivityHistoryToggle");
  const body = document.getElementById("knowledgeActivityHistoryBody");
  const list = document.getElementById("knowledgeActivityHistoryList");
  const summary = document.getElementById("knowledgeActivityHistorySummary");
  if (!section || !toggle || !body || !list || !summary) return;

  let activeDeck = null;
  let loaded = false;
  let requestVersion = 0;

  function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Fecha no disponible";
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date).replace(",", " ·");
  }

  async function createSpeakerAccessToken(deck) {
    const sessionId = String(deck?.session_id || "").trim();
    if (!sessionId) throw new Error("Esta presentación aún no tiene session_id.");
    const response = await fetch("/api/access-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, role: "speaker" })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) throw new Error(data?.error || "No se pudo autorizar la descarga.");
    return data.access_token;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function downloadExecution(execution, button) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Preparando…";
    try {
      const token = await createSpeakerAccessToken(activeDeck);
      const response = await fetch("/api/knowledge-activities/" + encodeURIComponent(execution.executionId) + "/export/" + encodeURIComponent(token));
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "No se pudo descargar el CSV.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "immersa-resultados.csv";
      downloadBlob(await response.blob(), filename);
      summary.textContent = "CSV descargado.";
      summary.className = "qna-history-summary success";
    } catch (error) {
      summary.textContent = error.message;
      summary.className = "qna-history-summary error";
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function render(executions) {
    list.replaceChildren();
    if (!executions.length) {
      list.classList.add("is-empty");
      summary.textContent = "Todavía no hay Concursos o Evaluaciones ejecutados.";
      return;
    }
    list.classList.remove("is-empty");
    summary.textContent = executions.length + " ejecución" + (executions.length === 1 ? "" : "es") + " guardada" + (executions.length === 1 ? "" : "s") + ".";
    executions.forEach((execution) => {
      const row = document.createElement("article");
      row.className = "qna-history-row";
      const copy = document.createElement("div");
      copy.className = "qna-history-row-copy";
      const title = document.createElement("strong");
      title.textContent = execution.title;
      const meta = document.createElement("span");
      meta.textContent = [
        execution.category === "contest" ? "Concurso" : "Evaluación",
        formatDate(execution.startedAt || execution.openedAt),
        (execution.participantCount || 0) + " participantes"
      ].join(" · ");
      copy.append(title, meta);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "qna-history-export";
      action.textContent = execution.resultsReady ? "Descargar CSV" : "Sin resultados";
      action.disabled = !execution.resultsReady;
      action.addEventListener("click", () => downloadExecution(execution, action));
      row.append(copy, action);
      list.appendChild(row);
    });
  }

  async function loadHistory() {
    if (!activeDeck) return;
    const version = ++requestVersion;
    summary.textContent = "Cargando historial…";
    try {
      const response = await fetch("/api/decks/" + encodeURIComponent(activeDeck.deckId) + "/knowledge-activities/history");
      const data = await response.json().catch(() => null);
      if (response.status === 404) {
        section.hidden = true;
        return;
      }
      if (!response.ok) throw new Error(data?.error || "No se pudo cargar el historial.");
      if (version !== requestVersion) return;
      loaded = true;
      render(Array.isArray(data?.executions) ? data.executions : []);
    } catch (error) {
      if (version !== requestVersion) return;
      summary.textContent = error.message;
      summary.className = "qna-history-summary error";
    }
  }

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    body.hidden = expanded;
    section.classList.toggle("is-expanded", !expanded);
    if (!expanded && !loaded) loadHistory();
  });

  document.addEventListener("immersa:deck-detail-open", (event) => {
    const deck = event.detail?.deck;
    if (!deck?.deckId) return;
    requestVersion += 1;
    activeDeck = deck;
    loaded = false;
    section.hidden = false;
    toggle.setAttribute("aria-expanded", "false");
    body.hidden = true;
  });

  document.addEventListener("immersa:deck-detail-close", () => {
    requestVersion += 1;
    activeDeck = null;
    loaded = false;
    section.hidden = true;
  });
})();
