(() => {
  const panel = document.getElementById("eventInvitations");
  const list = document.getElementById("eventInvitationsList");
  if (!panel || !list) return;

  function schedule(value) {
    if (!value) return "Horario por definir";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return "Horario por definir";
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", hour12: true }).format(date);
  }

  async function load() {
    const [invitationsResponse, decksResponse] = await Promise.all([
      fetch("/api/event-hub/speaker-invitations", { cache: "no-store" }),
      fetch("/api/decks", { cache: "no-store" })
    ]);
    const invitationsBody = await invitationsResponse.json();
    const decksBody = await decksResponse.json();
    if (!invitationsResponse.ok) throw new Error(invitationsBody.error || "No se pudieron cargar tus invitaciones");
    if (!decksResponse.ok) throw new Error(decksBody.error || "No se pudieron cargar tus Decks");
    render(invitationsBody.invitations || [], Array.isArray(decksBody) ? decksBody : (decksBody.decks || []));
  }

  function render(invitations, decks) {
    panel.hidden = !invitations.length;
    list.replaceChildren();
    for (const invitation of invitations) {
      const card = document.createElement("article");
      card.className = "event-invitation-card";
      const selected = invitation.selectedDeckId || "";
      const options = [`<option value="">Elige un Deck</option>`, ...decks.map((deck) => `<option value="${String(deck.deckId).replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}"${String(deck.deckId) === selected ? " selected" : ""}>${String(deck.title || deck.deckId).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`)].join("");
      card.innerHTML = `<div><span class="event-invitation-eyebrow">${invitation.eventTitle}</span><h3></h3><p></p></div><div class="event-invitation-action"><select aria-label="Deck para esta actividad">${options}</select><button type="button">${selected ? "Cambiar Deck" : "Elegir mi Deck"}</button><small role="status"></small></div>`;
      card.querySelector("h3").textContent = invitation.activity.title;
      card.querySelector("p").textContent = `${invitation.activity.stageName} · ${schedule(invitation.activity.scheduledStartsAt)} · ${invitation.activity.durationMinutes} min`;
      const select = card.querySelector("select");
      const button = card.querySelector("button");
      const status = card.querySelector("small");
      if (selected) status.textContent = "Deck elegido. El Event Admin realizará el Deck Check.";
      button.addEventListener("click", async () => {
        if (!select.value) { status.textContent = "Elige primero el Deck que usarás."; return; }
        button.disabled = true;
        status.textContent = "Guardando tu Deck…";
        try {
          const response = await fetch(`/api/event-hub/speaker-invitations/${encodeURIComponent(invitation.id)}/deck`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deckId: select.value })
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "No se pudo elegir el Deck");
          status.textContent = "Deck elegido. El Event Admin realizará el Deck Check.";
          button.textContent = "Cambiar Deck";
        } catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      });
      list.appendChild(card);
    }
  }

  load().catch(() => { panel.hidden = true; });
})();
