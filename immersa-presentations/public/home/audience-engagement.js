(() => {
  const sessions = document.getElementById("basicMetricsSessions");
  if (!sessions) return;
  let deckId = "", sessionId = "", version = 0, page = 0, brandId = "";
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, action) {
    const element = node("button", text);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }
  function person(attendee) {
    const details = node("details", undefined, "engagement-person");
    const summary = node("summary", (attendee.name || "Asistente " + attendee.id.slice(-6)) +
      " · " + attendee.actions + " acciones");
    details.append(summary);
    const contact = [attendee.email, attendee.phone, attendee.company].filter(Boolean);
    if (contact.length) details.append(node("p", contact.join(" · ")));
    details.append(node("p", attendee.answers.length + " respuestas · " + attendee.questions.length +
      " preguntas · " + attendee.reactions.total + " reacciones"));
    if (attendee.reactions.total) {
      details.append(node("p", Object.entries(attendee.reactions.byEmoji).map(([emoji, count]) => emoji + " " + count).join(" · ")));
    }
    for (const answer of attendee.answers) {
      const item = node("div", undefined, "engagement-answer");
      item.append(node("strong", answer.question), node("p", answer.answer));
      item.append(node("small", answer.title + (answer.type === "poll" ? "" : answer.correct ? " · Correcta" : " · Incorrecta")));
      details.append(item);
    }
    for (const question of attendee.questions) {
      details.append(node("p", "Pregunta · " + question.text + (question.projectedAt ? " · Proyectada" : "")));
    }
    for (const banner of attendee.banners) {
      details.append(node("p", banner.name + " · " + banner.views + " vistas · " + banner.clicks + " clics"));
    }
    if (attendee.termsAcceptedAt) {
      details.append(node("small", "Términos aceptados el " + new Date(attendee.termsAcceptedAt).toLocaleString("es-MX")));
    }
    return details;
  }
  async function load() {
    const mine = ++version;
    sessions.querySelector(".audience-engagement")?.remove();
    if (!deckId || !sessionId) return;
    const host = node("section", undefined, "audience-engagement");
    host.append(node("h3", "Participación por asistente"));
    const status = node("p", "Cargando participación…");
    host.append(status);
    sessions.append(host);
    try {
      const query = new URLSearchParams({ page, brandId });
      const response = await fetch("/api/decks/" + encodeURIComponent(deckId) + "/metrics/sessions/" +
        encodeURIComponent(sessionId) + "/engagement?" + query, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo cargar la participación.");
      if (mine !== version) return;
      status.textContent = data.total + " asistentes" + (brandId ? " que hicieron clic en la marca seleccionada" : "");
      if (brandId) host.append(button("Ver todos los asistentes", () => { brandId = ""; page = 0; load(); }));
      const brands = node("section", undefined, "engagement-brands");
      brands.append(node("h3", "Menciones de marca"));
      if (!data.banners.length) brands.append(node("p", "Todavía no hay vistas de banners registradas."));
      for (const banner of data.banners) {
        const card = node("article", undefined, "engagement-brand");
        card.append(node("strong", banner.name));
        card.append(node("p", banner.displays + " despliegues · " + banner.impressions + " vistas · " + banner.viewers + " espectadores únicos"));
        card.append(node("p", banner.clicks + " clics · " + banner.clickers + " personas"));
        if (banner.clickers) card.append(button("Ver quién hizo clic", () => { brandId = banner.id; page = 0; load(); }));
        brands.append(card);
      }
      host.append(brands);
      host.append(node("p", data.recordedSince
        ? "El detalle por persona de reacciones y banners se registra desde " + new Date(data.recordedSince).toLocaleString("es-MX") + "."
        : "Esta sesión es anterior al registro de reacciones y banners por persona."));
      host.append(node("p", "Cada vista corresponde a un banner visible durante al menos un segundo. Las acciones suman respuestas, preguntas, reacciones y clics."));
      const people = node("div", undefined, "engagement-people");
      for (const attendee of data.attendees) people.append(person(attendee));
      host.append(people);
      const pagination = node("nav", undefined, "engagement-pages");
      pagination.setAttribute("aria-label", "Páginas de asistentes");
      if (page > 0) pagination.append(button("Anteriores", () => { page--; load(); }));
      if ((page + 1) * 100 < data.total) pagination.append(button("Siguientes", () => { page++; load(); }));
      host.append(pagination);
    } catch (error) {
      if (mine !== version) return;
      status.textContent = error.message;
      host.append(button("Reintentar", load));
    }
  }
  document.addEventListener("immersa:deck-detail-open", event => {
    version++;
    deckId = event.detail?.deck?.deckId || "";
    sessionId = "";
  });
  document.addEventListener("immersa:deck-detail-close", () => { version++; deckId = ""; sessionId = ""; });
  document.addEventListener("immersa:metrics-session-selected", event => {
    sessionId = event.detail?.id || "";
    page = 0;
    brandId = "";
    load();
  });
})();
