(() => {
  const section = document.getElementById("basicMetrics");
  const status = document.getElementById("basicMetricsStatus");
  const sessionsHost = document.getElementById("basicMetricsSessions");
  const refreshButton = document.getElementById("basicMetricsRefresh");
  const metricsTab = document.getElementById("deckTabSessions");
  if (!section || !status || !sessionsHost || !refreshButton || !metricsTab) return;

  const choice = document.getElementById("basicMetricsSessionChoice");
  const select = document.getElementById("basicMetricsSessionSelect");
  let sessions = [];
  const exportButton = document.getElementById("sessionExport");
  let detailVersion = 0;
  let canExport = false;

  let activeDeck = null;
  let loaded = false;
  let loading = false;
  let requestVersion = 0;

  function quantity(value, singular, plural) {
    const count = Math.max(0, Number(value) || 0);
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Fecha no disponible";
    return new Intl.DateTimeFormat("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date).replace(",", " ·");
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Number(value) || 0);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${String(remainder).padStart(2, "0")} min` : `${hours} h`;
  }

  function sessionLabel(session) {
    const source = String(session.sourceSessionId || session.id || "").trim();
    return source ? `Sesión ${source.slice(-8)}` : "Sesión";
  }

  function metric(label, value, hint) {
    const item = document.createElement("div");
    item.className = "basic-metrics-stat";
    const name = document.createElement("span");
    name.textContent = label;
    const result = document.createElement("strong");
    result.textContent = value;
    item.append(name, result);
    if (hint) {
      const detail = document.createElement("small");
      detail.textContent = hint;
      item.appendChild(detail);
    }
    return item;
  }

  function renderPoll(poll) {
    const article = document.createElement("article");
    article.className = "basic-metrics-poll";
    const header = document.createElement("div");
    header.className = "basic-metrics-poll-head";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = poll.prompt || poll.title || "Encuesta";
    const launched = document.createElement("span");
    launched.textContent = formatDate(poll.launchedAt);
    copy.append(title, launched);
    const total = document.createElement("b");
    total.textContent = quantity(poll.totalResponses, "respuesta", "respuestas");
    header.append(copy, total);
    article.appendChild(header);

    const options = document.createElement("div");
    options.className = "basic-metrics-options";
    (poll.options || []).forEach((option) => {
      const row = document.createElement("div");
      row.className = "basic-metrics-option";
      const legend = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = option.label || "Opción";
      const value = document.createElement("strong");
      value.textContent = `${Number(option.count) || 0} · ${Number(option.percentage) || 0}%`;
      legend.append(label, value);
      const track = document.createElement("i");
      const bar = document.createElement("b");
      bar.style.width = `${Math.min(100, Math.max(0, Number(option.percentage) || 0))}%`;
      track.appendChild(bar);
      row.append(legend, track);
      options.appendChild(row);
    });
    article.appendChild(options);
    return article;
  }

  function renderSession(session) {
    const pollResponses = (session.polls || []).reduce((sum, poll) => sum + (Number(poll.totalResponses) || 0), 0);
    const activity = pollResponses + (Number(session.qna?.received) || 0);
    const article = document.createElement("article");
    article.className = "basic-metrics-session";
    const heading = document.createElement("div");
    heading.className = "basic-metrics-session-toggle";

    const identity = document.createElement("span");
    identity.className = "basic-metrics-session-identity";
    const label = document.createElement("strong");
    label.textContent = formatDate(session.startedAt);
    const meta = document.createElement("small");
    meta.textContent = `${sessionLabel(session)} · ${session.endedAt ? "Finalizada" : "En curso"}`;
    identity.append(label, meta);
    if (session.supplement) {
      const provenance = document.createElement("small");
      provenance.textContent = "Incluye datos reconstruidos";
      provenance.title = session.supplement.note;
      identity.append(provenance);
    }
    const overview = document.createElement("span");
    overview.className = "basic-metrics-session-overview";
    overview.append(
      metric("Tiempo", (session.supplement?.durationSeconds ? "≈ " : "") + formatDuration(session.durationSeconds)),
      metric("Asistencia", Number(session.participants?.connected) || 0),
      metric("Actividad", activity)
    );
    heading.append(identity, overview);

    const body = document.createElement("div");
    body.className = "basic-metrics-session-body";
    const stats = document.createElement("div");
    stats.className = "basic-metrics-detail-stats";
    stats.append(
      metric("Asistencia", quantity(session.participants?.connected, "persona", "personas"), `Pico de ${Number(session.participants?.peak) || 0} conectadas`),
      metric("Encuestas", quantity((session.polls || []).length, "encuesta", "encuestas"), quantity(pollResponses, "respuesta", "respuestas")),
      metric("Q&A", quantity(session.qna?.received, "recibida", "recibidas"), `${Number(session.qna?.projected) || 0} proyectada${Number(session.qna?.projected) === 1 ? "" : "s"}`),
      metric("Reacciones", Number(session.reactions?.total) || 0, ["❤️", "👏", "🔥"].map((emoji) => `${emoji} ${Number(session.reactions?.byEmoji?.[emoji]) || 0}`).join(" · "))
    );
    body.appendChild(stats);
    if ((session.polls || []).length) {
      const polls = document.createElement("div");
      polls.className = "basic-metrics-polls";
      (session.polls || []).forEach((poll) => polls.appendChild(renderPoll(poll)));
      body.appendChild(polls);
    } else {
      const empty = document.createElement("p");
      empty.className = "basic-metrics-inline-empty";
      empty.textContent = "No se lanzaron encuestas en esta sesión.";
      body.appendChild(empty);
    }
    article.classList.add("is-expanded");
    article.append(heading, body);
    return article;
  }

  async function selectSession() {
    const mine = ++detailVersion;
    const session = sessions.find(item => item.id === select.value);
    exportButton.disabled = !session || !canExport;
    sessionsHost.replaceChildren();
    if (!session || !activeDeck) return;
    const card = renderSession(session);
    sessionsHost.append(card);
    const body = card.querySelector(".basic-metrics-session-body");
    try {
      const response = await fetch("/api/decks/" + encodeURIComponent(activeDeck.deckId) + "/metrics/sessions/" + encodeURIComponent(session.id) + "/summary", {cache:"no-store"});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el resumen.");
      if (mine !== detailVersion) return;
      const activity = data.polls.reduce((n, p) => n + p.totalResponses, 0) + data.qna.received + data.reactions.total +
        data.knowledge.reduce((n, k) => n + k.answers, 0) + data.raffles.entries + data.brands.reduce((n, b) => n + b.clicks, 0);
      card.querySelector(".basic-metrics-session-overview").lastElementChild.querySelector("strong").textContent = (data.raffles.estimated ? "≈ " : "") + activity;
      const stats = body.querySelector(".basic-metrics-detail-stats");
      const knowledge = data.knowledge || [];
      stats.append(
        metric("Participación", data.participation.estimated
          ? data.participation.percentageMinimum + "–" + data.participation.percentageMaximum + "%"
          : data.participation.percentage + "%", data.participation.estimated
          ? "Entre " + data.participation.minimum + " y " + data.participation.maximum + " activos · estimado"
          : data.participation.active + " asistentes activos"),
        metric("Trivias", knowledge.find(k => k.category === "contest")?.executions || 0, (knowledge.find(k => k.category === "contest")?.answers || 0) + " respuestas"),
        metric("Evaluaciones", knowledge.find(k => k.category === "assessment")?.executions || 0, (knowledge.find(k => k.category === "assessment")?.answers || 0) + " respuestas"),
        metric("Sorteos", data.raffles.total, (data.raffles.estimated ? "≈ " : "") + data.raffles.entries + " participaciones · " + data.raffles.winners + " ganadores")
      );
      if (data.raffles.winnerName) {
        const winner = document.createElement("small");
        winner.textContent = "Ganadora · " + data.raffles.winnerName;
        stats.lastElementChild.append(winner);
      }
      const brands = document.createElement("section");
      brands.className = "basic-metrics-brands";
      const heading = document.createElement("h4");
      heading.textContent = "Marcas" + (data.supplement?.brandCount ? " · " + data.supplement.brandCount + " reportadas" : "");
      brands.append(heading);
      if (!data.brands.length) {
        const empty = document.createElement("p");
        empty.className = "basic-metrics-inline-empty";
        empty.textContent = data.supplement?.brandCount ? "Vistas y clics sin registro histórico." : "Sin vistas de banners registradas en esta sesión.";
        brands.append(empty);
      }
      for (const brand of data.brands) {
        const article = document.createElement("article");
        article.className = "basic-metrics-poll";
        const name = document.createElement("strong");
        name.textContent = brand.name;
        const grid = document.createElement("div");
        grid.className = "basic-metrics-detail-stats";
        grid.append(metric("Despliegues", brand.displays), metric("Vistas", brand.impressions, brand.viewers + " espectadores únicos"),
          metric("Clics", brand.clicks), metric("Personas con clic", brand.clickers));
        article.append(name, grid);
        brands.append(article);
      }
      body.append(brands);
    } catch (error) {
      if (mine !== detailVersion) return;
      const message = document.createElement("p");
      message.className = "basic-metrics-error";
      message.textContent = error.message;
      body.append(message);
    }
  }
  exportButton.addEventListener("click", async () => {
    if (!activeDeck || !select.value || exportButton.disabled) return;
    const deck = activeDeck.deckId, id = select.value;
    exportButton.disabled = true;
    const mine = requestVersion;
    try {
      const response = await fetch("/api/decks/" + encodeURIComponent(deck) + "/metrics/sessions/" + encodeURIComponent(id) + "/export", {cache:"no-store"});
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "No se pudo exportar la sesión.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "IMMERSA-sesion-" + id + ".xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (mine === requestVersion) status.textContent = error.message;
    } finally {
      if (mine === requestVersion) exportButton.disabled = !select.value || !canExport;
    }
  });

  function render(results) {
    const previousId = select.value;
    sessions = results;
    choice.hidden = !sessions.length;
    select.replaceChildren(...sessions.map((session) => new Option(
      `${formatDate(session.startedAt)} · ${session.id.slice(-8)}`, session.id
    )));
    if (sessions.some((session) => session.id === previousId)) select.value = previousId;
    selectSession();
    if (!sessions.length) {
      status.textContent = "Todavía no hay sesiones registradas.";
      const empty = document.createElement("div");
      empty.className = "basic-metrics-empty";
      const title = document.createElement("strong");
      title.textContent = "Tus resultados aparecerán aquí";
      const copy = document.createElement("p");
      copy.textContent = "Inicia manualmente desde Backstage para una prueba pequeña, o conecta al menos 5 personas de Público para iniciar el registro automático.";
      empty.append(title, copy);
      sessionsHost.appendChild(empty);
      return;
    }
    status.textContent = quantity(sessions.length, "sesión registrada", "sesiones registradas");

  }

  async function loadMetrics(force = false) {
    if (!activeDeck || loading || (loaded && !force)) return;
    const version = ++requestVersion;
    loading = true;
    refreshButton.disabled = true;
    status.textContent = "Cargando sesiones…";
    select.disabled = true;
    sessionsHost.replaceChildren();
    document.dispatchEvent(new CustomEvent("immersa:metrics-session-selected", { detail: { id: "" } }));
    try {
      const response = await fetch(`/api/decks/${encodeURIComponent(activeDeck.deckId)}/metrics/basic`, {
        headers: { Accept: "application/json" }, cache: "no-store"
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "No se pudieron cargar las métricas.");
      if (version !== requestVersion) return;
      loaded = true;
      render(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (error) {
      if (version !== requestVersion) return;
      status.textContent = error.message || "No se pudieron cargar las métricas.";
      choice.hidden = true;
      const retry = document.createElement("p");
      retry.className = "basic-metrics-error";
      retry.textContent = "Intenta actualizar en unos momentos.";
      sessionsHost.replaceChildren(retry);
    } finally {
      if (version === requestVersion) {
        loading = false;
        refreshButton.disabled = false;
        select.disabled = false;
      }
    }
  }

  select.addEventListener("change", selectSession);
  metricsTab.addEventListener("click", () => loadMetrics());
  document.addEventListener("immersa:deck-panel-visible", event => { if (event.detail?.panel === "metrics") loadMetrics(); });
  refreshButton.addEventListener("click", () => loadMetrics(true));
  document.addEventListener("immersa:deck-detail-open", (event) => {
    requestVersion += 1;
    detailVersion += 1;
    activeDeck = null;
    loaded = false;
    loading = false;
    sessions = [];
    select.replaceChildren();
    choice.hidden = true;
    sessionsHost.replaceChildren();
    canExport = event.detail?.capabilities?.["metrics.export"] === true;
    exportButton.title = canExport ? "Descargar Excel de la sesión" : "Exportación disponible en Speaker Pro";
    const deck = event.detail?.deck;
    const enabled = event.detail?.capabilities?.["metrics.basic"] === true;
    section.hidden = !deck?.deckId || !enabled;
    if (!section.hidden) {
      activeDeck = deck;
      status.textContent = "Entra a Métricas para consultar tus resultados.";
      refreshButton.disabled = false;
    }
  });
  document.addEventListener("immersa:deck-detail-close", () => {
    requestVersion += 1;
    detailVersion += 1;
    activeDeck = null;
    loaded = false;
    loading = false;
    section.hidden = true;
  });
})();
