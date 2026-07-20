(() => {
  const section = document.getElementById("qnaHistory");
  const list = document.getElementById("qnaHistoryList");
  const summary = document.getElementById("qnaHistorySummary");
  const exportButton = document.getElementById("qnaHistoryExport");
  if (!section || !list || !summary || !exportButton) return;

  let activeDeck = null;
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

  function quantity(value, singular, plural) {
    const count = Number(value) || 0;
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function setSummary(message, state = "") {
    summary.textContent = message;
    summary.className = `qna-history-summary${state ? ` ${state}` : ""}`;
  }

  function renderSessions(sessions) {
    list.replaceChildren();
    const totalQuestions = sessions.reduce((total, session) => total + (Number(session.questionCount) || 0), 0);
    const totalAnswered = sessions.reduce((total, session) => total + (Number(session.answeredCount) || 0), 0);

    exportButton.hidden = totalQuestions === 0;
    exportButton.disabled = totalQuestions === 0;

    if (!sessions.length) {
      list.classList.add("is-empty");
      setSummary("Todavía no hay ejecuciones de Q&A para esta presentación.");
      return;
    }

    list.classList.remove("is-empty");
    setSummary(`${quantity(sessions.length, "ejecución", "ejecuciones")} · ${quantity(totalQuestions, "pregunta", "preguntas")} · ${totalAnswered} respondida${totalAnswered === 1 ? "" : "s"}`);

    sessions.forEach((session) => {
      const row = document.createElement("article");
      row.className = "qna-history-row";

      const copy = document.createElement("div");
      copy.className = "qna-history-row-copy";

      const date = document.createElement("strong");
      date.textContent = formatDate(session.startedAt);

      const meta = document.createElement("span");
      meta.textContent = [
        quantity(session.roundCount, "ronda", "rondas"),
        quantity(session.questionCount, "pregunta", "preguntas"),
        `${Number(session.answeredCount) || 0} respondida${Number(session.answeredCount) === 1 ? "" : "s"}`
      ].join(" · ");

      const status = document.createElement("span");
      status.className = `qna-history-status${session.endedAt ? "" : " active"}`;
      status.textContent = session.endedAt ? "Finalizada" : "En curso";

      copy.append(date, meta);
      row.append(copy, status);
      list.appendChild(row);
    });
  }

  async function loadHistory(deck) {
    const version = ++requestVersion;
    activeDeck = deck;
    section.hidden = false;
    exportButton.hidden = true;
    exportButton.disabled = true;
    list.replaceChildren();
    list.classList.add("is-loading");
    setSummary("Cargando historial…");

    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.deckId)}/qna/history`, {
        headers: { Accept: "application/json" }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No se pudo cargar el historial.");
      if (version !== requestVersion) return;
      list.classList.remove("is-loading");
      renderSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (error) {
      if (version !== requestVersion) return;
      list.classList.remove("is-loading");
      list.classList.add("is-empty");
      setSummary(error.message || "No se pudo cargar el historial.", "error");
    }
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
    if (!response.ok || !data?.access_token) {
      throw new Error(data?.error || "No se pudo autorizar la descarga.");
    }
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

  exportButton.addEventListener("click", async () => {
    if (!activeDeck || exportButton.disabled) return;
    const originalLabel = exportButton.textContent;
    exportButton.disabled = true;
    exportButton.textContent = "Preparando…";

    try {
      const accessToken = await createSpeakerAccessToken(activeDeck);
      const response = await fetch(`/api/qna/export/${encodeURIComponent(accessToken)}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "No se pudo descargar el CSV.");
      }
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || "immersa-qna.csv";
      downloadBlob(await response.blob(), filename);
      setSummary("CSV descargado con todas las preguntas no eliminadas.", "success");
    } catch (error) {
      setSummary(error.message || "No se pudo descargar el CSV.", "error");
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = originalLabel;
    }
  });

  document.addEventListener("immersa:deck-detail-open", (event) => {
    const deck = event.detail?.deck;
    if (deck?.deckId) loadHistory(deck);
  });

  document.addEventListener("immersa:deck-detail-close", () => {
    requestVersion += 1;
    activeDeck = null;
    section.hidden = true;
  });
})();
