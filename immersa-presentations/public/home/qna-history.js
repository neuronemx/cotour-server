(() => {
  const section = document.getElementById("qnaHistory");
  const toggle = document.getElementById("qnaHistoryToggle");
  const body = document.getElementById("qnaHistoryBody");
  const list = document.getElementById("qnaHistoryList");
  const summary = document.getElementById("qnaHistorySummary");
  const exportButton = document.getElementById("qnaHistoryExport");
  const deleteButton = document.getElementById("qnaHistoryDelete");
  const confirmation = document.getElementById("qnaHistoryConfirm");
  const cancelDelete = document.getElementById("qnaHistoryCancelDelete");
  const confirmDelete = document.getElementById("qnaHistoryConfirmDelete");
  if (!section || !toggle || !body || !list || !summary || !exportButton || !deleteButton || !confirmation || !cancelDelete || !confirmDelete) return;

  let activeDeck = null;
  let historyLoaded = false;
  let requestVersion = 0;

  function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Fecha no disponible";
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
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

  function setExpanded(expanded) {
    toggle.setAttribute("aria-expanded", String(expanded));
    body.hidden = !expanded;
    section.classList.toggle("is-expanded", expanded);
    if (!expanded) confirmation.hidden = true;
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
    list.replaceChildren();
    list.classList.add("is-loading");
    exportButton.hidden = true;
    exportButton.disabled = true;
    setSummary("Cargando historial…");
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(deck.deckId)}/qna/history`, { headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No se pudo cargar el historial.");
      if (version !== requestVersion) return;
      historyLoaded = true;
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
    if (!response.ok || !data?.access_token) throw new Error(data?.error || "No se pudo autorizar la operación.");
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

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    setExpanded(!expanded);
    if (!expanded && activeDeck && !historyLoaded) loadHistory(activeDeck);
  });

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
      deleteButton.hidden = false;
      setSummary("CSV descargado. Ya puedes borrar permanentemente el historial.", "success");
    } catch (error) {
      setSummary(error.message || "No se pudo descargar el CSV.", "error");
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = originalLabel;
    }
  });

  deleteButton.addEventListener("click", () => {
    confirmation.hidden = false;
    confirmDelete.focus();
  });
  cancelDelete.addEventListener("click", () => {
    confirmation.hidden = true;
    deleteButton.focus();
  });

  confirmDelete.addEventListener("click", async () => {
    if (!activeDeck || confirmDelete.disabled) return;
    confirmDelete.disabled = true;
    cancelDelete.disabled = true;
    confirmDelete.textContent = "Borrando…";
    try {
      const accessToken = await createSpeakerAccessToken(activeDeck);
      const response = await fetch(`/api/qna/history/${encodeURIComponent(accessToken)}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No se pudo borrar el historial.");
      confirmation.hidden = true;
      deleteButton.hidden = true;
      historyLoaded = false;
      await loadHistory(activeDeck);
      setSummary("Historial borrado permanentemente.", "success");
    } catch (error) {
      confirmation.hidden = true;
      setSummary(error.message || "No se pudo borrar el historial.", "error");
    } finally {
      confirmDelete.disabled = false;
      cancelDelete.disabled = false;
      confirmDelete.textContent = "Borrar definitivamente";
    }
  });

  document.addEventListener("immersa:deck-detail-open", (event) => {
    const deck = event.detail?.deck;
    const hasDetailedHistory = event.detail?.capabilities?.["metrics.export"] === true;
    if (!deck?.deckId || !hasDetailedHistory) {
      activeDeck = null;
      section.hidden = true;
      return;
    }
    requestVersion += 1;
    activeDeck = deck;
    historyLoaded = false;
    section.hidden = false;
    deleteButton.hidden = true;
    confirmation.hidden = true;
    setExpanded(false);
  });

  document.addEventListener("immersa:deck-detail-close", () => {
    requestVersion += 1;
    activeDeck = null;
    historyLoaded = false;
    section.hidden = true;
  });
})();
