const accountsRoot = document.getElementById("accounts");
const statusNode = document.getElementById("status");
const search = document.getElementById("search");
const planFilter = document.getElementById("planFilter");
const template = document.getElementById("accountTemplate");
let accounts = [];

const mb = (bytes) => {
  const value = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  return (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10) + " MB";
};
const planLabel = (plan) => String(plan || "FREE").replace(/_/g, " ");
const pendingLabel = (pending) => {
  if (!pending) return "";
  if (pending.adjustmentRequired) return " → " + planLabel(pending.targetPlan) + " · AJUSTE REQUERIDO";
  const deadline = pending.deadlineAt ? new Date(pending.deadlineAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "";
  return " → " + planLabel(pending.targetPlan) + " pendiente" + (deadline ? " hasta " + deadline : "");
};

function render() {
  const query = search.value.trim().toLowerCase();
  const plan = planFilter.value;
  const visible = accounts.filter((account) => (
    (!plan || account.plan === plan)
    && (!query || (account.name + " " + account.email).toLowerCase().includes(query))
  ));
  accountsRoot.replaceChildren();
  statusNode.textContent = visible.length + " cuenta" + (visible.length === 1 ? "" : "s");
  visible.forEach((account) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".identity strong").textContent = account.name || "Sin nombre";
    const email = card.querySelector(".identity a");
    email.textContent = account.email;
    email.href = "mailto:" + account.email;
    card.querySelector(".identity small").textContent = "Registro: " + new Date(account.registeredAt).toLocaleDateString("es-MX");
    const planNode = card.querySelector(".plan");
    planNode.textContent = planLabel(account.plan) + pendingLabel(account.pendingDowngrade);
    card.querySelector(".decks").textContent = account.usage.decks + " de " + account.limits.decks + " Decks";
    card.querySelector(".storage").textContent = mb(account.usage.storageBytes) + " de " + mb(account.limits.storageBytes);
    const form = card.querySelector("form");
    form.elements.plan.value = account.pendingDowngrade?.targetPlan || account.plan;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      const feedback = card.querySelector(".feedback");
      button.disabled = true;
      feedback.className = "feedback";
      feedback.textContent = "Guardando…";
      try {
        const response = await fetch("/api/admin/accounts/" + encodeURIComponent(account.workspaceId) + "/plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: form.elements.plan.value, note: form.elements.note.value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cambiar el plan");
        Object.assign(account, data);
        planNode.textContent = planLabel(account.plan) + pendingLabel(data.pendingDowngrade);
        card.querySelector(".decks").textContent = account.usage.decks + " de " + account.limits.decks + " Decks";
        card.querySelector(".storage").textContent = mb(account.usage.storageBytes) + " de " + mb(account.limits.storageBytes);
        feedback.classList.add("success");
        if (data.pendingDowngrade) {
          feedback.textContent = data.emailNotification?.status === "sent"
            ? "Downgrade solicitado. Correo enviado al usuario; tiene 7 días para ajustar sus Decks."
            : "Downgrade solicitado. No se confirmó el envío del correo; IMMERSA lo reintentará automáticamente.";
          if (data.emailNotification?.status !== "sent") feedback.classList.add("error");
        } else feedback.textContent = "Plan actualizado a " + planLabel(data.plan) + ".";
        form.elements.note.value = "";
      } catch (error) {
        feedback.classList.add("error");
        feedback.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    accountsRoot.appendChild(card);
  });
}

async function load() {
  try {
    const response = await fetch("/api/admin/accounts", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudieron cargar las cuentas");
    accounts = Array.isArray(data.accounts) ? data.accounts : [];
    render();
  } catch (error) {
    statusNode.textContent = error.message;
    statusNode.classList.add("error");
  }
}

search.addEventListener("input", render);
planFilter.addEventListener("change", render);
load();
