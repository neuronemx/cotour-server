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

  function render(invitations) {
    panel.hidden = !invitations.length;
    list.replaceChildren();
    for (const invitation of invitations) {
      const card = document.createElement("article");
      card.className = "event-invitation-card";
      const linked = invitation.status === "LINKED";
      card.innerHTML = `<div><span class="event-invitation-eyebrow"></span><h3></h3><p></p></div><div class="event-invitation-action"><button type="button"></button><small role="status"></small></div>`;
      card.querySelector(".event-invitation-eyebrow").textContent = invitation.eventTitle;
      card.querySelector("h3").textContent = invitation.activity.title;
      card.querySelector("p").textContent = `${invitation.activity.stageName} · ${schedule(invitation.activity.scheduledStartsAt)} · ${invitation.activity.durationMinutes} min`;
      const button = card.querySelector("button");
      const status = card.querySelector("small");
      button.textContent = linked ? "Cuenta vinculada" : "Aceptar invitación";
      button.disabled = linked;
      status.textContent = linked ? "Tu Deck se seleccionará durante Deck Check." : "Al aceptar vinculas tu cuenta IMMERSA con esta actividad.";
      button.addEventListener("click", async () => {
        button.disabled = true;
        status.textContent = "Vinculando tu cuenta…";
        try {
          const response = await fetch(`/api/event-hub/speaker-invitations/${encodeURIComponent(invitation.id)}/accept`, { method: "PUT" });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "No se pudo aceptar la invitación");
          button.textContent = "Cuenta vinculada";
          status.textContent = "Tu Deck se seleccionará durante Deck Check.";
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
      list.appendChild(card);
    }
  }

  fetch("/api/event-hub/speaker-invitations", { cache: "no-store" })
    .then(async (response) => ({ response, body: await response.json() }))
    .then(({ response, body }) => {
      if (!response.ok) throw new Error(body.error || "No se pudieron cargar tus invitaciones");
      render(body.invitations || []);
    })
    .catch(() => { panel.hidden = true; });
})();
