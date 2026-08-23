(() => {
  const panel = document.getElementById("eventInvitations");
  const list = document.getElementById("eventInvitationsList");
  const modal = document.getElementById("eventInvitationModal");
  const modalList = document.getElementById("eventInvitationModalList");
  const close = document.getElementById("eventInvitationClose");
  const presentations = document.getElementById("presentationsContent");
  const presentationsTab = document.getElementById("presentationsTab");
  const invitationsTab = document.getElementById("invitationsTab");
  if (!panel || !list || !modal || !modalList || !presentations || !presentationsTab || !invitationsTab) return;

  let invitations = [];
  function schedule(value) {
    if (!value) return "Horario por definir";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return "Horario por definir";
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", hour12: true }).format(date);
  }
  function setView(view) {
    const showInvitations = view === "invitations";
    panel.hidden = !showInvitations;
    presentations.hidden = showInvitations;
    invitationsTab.classList.toggle("is-active", showInvitations);
    presentationsTab.classList.toggle("is-active", !showInvitations);
  }
  function closeModal() { modal.hidden = true; modal.setAttribute("aria-hidden", "true"); }
  function invitationText(invitation) { return `${invitation.activity.stageName} · ${schedule(invitation.activity.scheduledStartsAt)} · ${invitation.activity.durationMinutes} min`; }
  async function respond(invitation, action) {
    const response = await fetch(`/api/event-hub/speaker-invitations/${encodeURIComponent(invitation.id)}/${action}`, { method: "PUT" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo actualizar la invitación");
    invitation.status = body.status;
    render();
    closeModal();
  }
  function renderList() {
    list.replaceChildren();
    for (const invitation of invitations) {
      const card = document.createElement("article");
      card.className = "event-invitation-card";
      card.innerHTML = `<div><span class="event-invitation-eyebrow"></span><h3></h3><p></p></div><div class="event-invitation-action"></div>`;
      card.querySelector(".event-invitation-eyebrow").textContent = invitation.eventTitle;
      card.querySelector("h3").textContent = invitation.activity.title;
      card.querySelector("p").textContent = invitationText(invitation);
      if (invitation.status === "INVITED") {
        const accept = document.createElement("button");
        accept.type = "button";
        accept.textContent = "Aceptar invitación";
        accept.addEventListener("click", async () => {
          accept.disabled = true;
          try { await respond(invitation, "accept"); } catch (error) { accept.disabled = false; }
        });
        card.querySelector(".event-invitation-action").appendChild(accept);
      }
      list.appendChild(card);
    }
  }
  function renderModal() {
    const pending = invitations.filter((invitation) => invitation.status === "INVITED");
    modalList.replaceChildren();
    if (!pending.length) return closeModal();
    for (const invitation of pending) {
      const card = document.createElement("article");
      card.className = "event-invitation-modal-card";
      card.innerHTML = `<span class="event-invitation-eyebrow"></span><h3></h3><p></p><div class="event-invitation-modal-actions"><button type="button">Aceptar invitación</button><button type="button">Declinar</button></div>`;
      card.querySelector(".event-invitation-eyebrow").textContent = invitation.eventTitle;
      card.querySelector("h3").textContent = invitation.activity.title;
      card.querySelector("p").textContent = invitationText(invitation);
      const [accept, decline] = card.querySelectorAll("button");
      accept.addEventListener("click", async () => {
        accept.disabled = decline.disabled = true;
        try { await respond(invitation, "accept"); } catch (error) { card.querySelector("p").textContent = error.message; accept.disabled = decline.disabled = false; }
      });
      decline.addEventListener("click", async () => {
        accept.disabled = decline.disabled = true;
        try { await respond(invitation, "decline"); } catch (error) { card.querySelector("p").textContent = error.message; accept.disabled = decline.disabled = false; }
      });
      modalList.appendChild(card);
    }
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }
  function render() {
    const hasInvitations = invitations.length > 0;
    invitationsTab.hidden = !hasInvitations;
    panel.hidden = true;
    renderList();
    renderModal();
  }
  close?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  presentationsTab.addEventListener("click", () => setView("presentations"));
  invitationsTab.addEventListener("click", () => {
    setView("invitations");
    if (invitations.some((invitation) => invitation.status === "INVITED")) renderModal();
  });
  fetch("/api/event-hub/speaker-invitations", { cache: "no-store" })
    .then(async (response) => ({ response, body: await response.json() }))
    .then(({ response, body }) => {
      if (!response.ok) throw new Error(body.error || "No se pudieron cargar tus invitaciones");
      invitations = body.invitations || [];
      render();
    })
    .catch(() => { invitationsTab.hidden = true; });
})();
