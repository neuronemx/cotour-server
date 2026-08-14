(() => {
  const section = document.getElementById("basicMetrics");
  const status = document.getElementById("basicMetricsStatus");
  const sessionsHost = document.getElementById("basicMetricsSessions");
  const refreshButton = document.getElementById("basicMetricsRefresh");
  const metricsTab = document.getElementById("deckTabMetrics");
  if (!section || !status || !sessionsHost || !refreshButton || !metricsTab) return;

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

  function renderSession(session, index) {
    const pollResponses = (session.polls || []).reduce((sum, poll) => sum + (Number(poll.totalResponses) || 0), 0);
    const activity = pollResponses + (Number(session.qna?.received) || 0);
    const article = document.createElement("article");
    article.className = "basic-metrics-session";
    const headingId = `basicMetricsSession${index}`;
    const bodyId = `${headingId}Body`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "basic-metrics-session-toggle";
    toggle.id = headingId;
    toggle.setAttribute("aria-controls", bodyId);
    toggle.setAttribute("aria-expanded", String(index === 0));

    const identity = document.createElement("span");
    identity.className = "basic-metrics-session-identity";
    const label = document.createElement("strong");
    label.textContent = formatDate(session.startedAt);
    const meta = document.createElement("small");
    meta.textContent = `${sessionLabel(session)} · ${session.endedAt ? "Finalizada" : "En curso"}`;
    identity.append(label, meta);
    const overview = document.createElement("span");
    overview.className = "basic-metrics-session-overview";
    overview.append(
      metric("Tiempo", formatDuration(session.durationSeconds)),
      metric("Asistencia", Number(session.participants?.connected) || 0),
      metric("Actividad", activity)
    );
    const arrow = document.createElement("span");
    arrow.className = "basic-metrics-chevron";
    arrow.setAttribute("aria-hidden", "true");
    toggle.append(identity, overview, arrow);

    const body = document.createElement("div");
    body.className = "basic-metrics-session-body";
    body.id = bodyId;
    body.setAttribute("role", "region");
    body.setAttribute("aria-labelledby", headingId);
    body.hidden = index !== 0;
    const stats = document.createElement("div");
    stats.className = "basic-metrics-detail-stats";
    stats.append(
      metric("Asistencia", quantity(session.participants?.connected, "persona", "personas"), `Pico de ${Number(session.participants?.peak) || 0} conectadas`),
      metric("Encuestas", quantity((session.polls || []).length, "encuesta", "encuestas"), quantity(pollResponses, "respuesta", "respuestas")),
      metric("Q&A", quantity(session.qna?.received, "recibida", "recibidas"), `${Number(session.qna?.projected) || 0} proyectada${Number(session.qna?.projected) === 1 ? "" : "s"}`)
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
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      body.hidden = expanded;
      article.classList.toggle("is-expanded", !expanded);
    });
    article.classList.toggle("is-expanded", index === 0);
    article.append(toggle, body);
    return article;
  }

  function render(sessions) {
    sessionsHost.replaceChildren();
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
    sessions.forEach((session, index) => sessionsHost.appendChild(renderSession(session, index)));
  }

  async function loadMetrics(force = false) {
    if (!activeDeck || loading || (loaded && !force)) return;
    const version = ++requestVersion;
    loading = true;
    refreshButton.disabled = true;
    status.textContent = "Cargando sesiones…";
    sessionsHost.replaceChildren();
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
      const retry = document.createElement("p");
      retry.className = "basic-metrics-error";
      retry.textContent = "Intenta actualizar en unos momentos.";
      sessionsHost.replaceChildren(retry);
    } finally {
      if (version === requestVersion) {
        loading = false;
        refreshButton.disabled = false;
      }
    }
  }

  metricsTab.addEventListener("click", () => loadMetrics());
  refreshButton.addEventListener("click", () => loadMetrics(true));
  document.addEventListener("immersa:deck-detail-open", (event) => {
    requestVersion += 1;
    activeDeck = null;
    loaded = false;
    loading = false;
    sessionsHost.replaceChildren();
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
    activeDeck = null;
    loaded = false;
    loading = false;
    section.hidden = true;
  });
})();
