const accountsRoot = document.getElementById("accounts");
const statusNode = document.getElementById("status");
const search = document.getElementById("search");
const planFilter = document.getElementById("planFilter");
const template = document.getElementById("accountTemplate");
const invoiceRequestsRoot = document.getElementById("invoiceRequests");
const invoiceAdminStatus = document.getElementById("invoiceAdminStatus");
const invoiceStatusFilter = document.getElementById("invoiceStatusFilter");
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
    const commercialNode = card.querySelector(".commercial");
    planNode.textContent = planLabel(account.plan) + pendingLabel(account.pendingDowngrade);
    void fetch("/api/admin/accounts/" + encodeURIComponent(account.workspaceId) + "/billing", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Estado no disponible");
        account.billing = data;
        const subscription = data.subscription;
        const grant = data.grants?.[0];
        if (subscription) {
          commercialNode.textContent = "Pago · " + subscription.status + " · " + planLabel(subscription.plan)
            + (subscription.cancelAtPeriodEnd ? " · cancelación programada" : "");
        } else if (grant) {
          commercialNode.textContent = planLabel(grant.origin) + " · " + planLabel(grant.plan)
            + (grant.ends_at ? " · vence " + new Date(grant.ends_at).toLocaleDateString("es-MX") : " · sin vencimiento");
        } else {
          commercialNode.textContent = account.plan === "FREE" ? "FREE" : "Activación manual heredada";
        }
      })
      .catch((error) => { commercialNode.textContent = error.message; });
    card.querySelector(".decks").textContent = account.usage.decks + " de " + account.limits.decks + " Decks";
    card.querySelector(".storage").textContent = mb(account.usage.storageBytes) + " de " + mb(account.limits.storageBytes);
    const form = card.querySelector("form");
    const resendButton = form.querySelector(".resend-email");
    resendButton.hidden = !account.pendingDowngrade;
    form.elements.plan.value = account.pendingDowngrade?.targetPlan || account.plan;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      const feedback = card.querySelector(".feedback");
      button.disabled = true;
      feedback.className = "feedback";
      feedback.textContent = "Guardando…";
      try {
        const ranks = { FREE: 0, SPEAKER: 1, SPEAKER_PRO: 2 };
        const targetPlan = form.elements.plan.value;
        const grantFlow = targetPlan !== "FREE" && (ranks[targetPlan] || 0) >= (ranks[account.plan] || 0);
        const response = await fetch(
          "/api/admin/accounts/" + encodeURIComponent(account.workspaceId) + (grantFlow ? "/billing/grants" : "/plan"),
          {
            method: grantFlow ? "POST" : "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plan: targetPlan,
              origin: form.elements.origin.value,
              endsAt: form.elements.endsAt.value ? new Date(form.elements.endsAt.value + "T23:59:59").toISOString() : null,
              note: form.elements.note.value
            })
          }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo cambiar el plan");
        const normalized = data.status ? { ...account, plan: data.status.effectivePlan, billing: data.status } : data;
        Object.assign(account, normalized);
        planNode.textContent = planLabel(account.plan) + pendingLabel(data.pendingDowngrade);
        card.querySelector(".decks").textContent = account.usage.decks + " de " + account.limits.decks + " Decks";
        card.querySelector(".storage").textContent = mb(account.usage.storageBytes) + " de " + mb(account.limits.storageBytes);
        feedback.classList.add("success");
        if (data.pendingDowngrade) {
          resendButton.hidden = false;
          feedback.textContent = data.emailNotification?.status === "sent"
            ? "Downgrade solicitado. Correo enviado al usuario; tiene 7 días para ajustar sus Decks."
            : "Downgrade solicitado. " + (data.emailNotification?.detail || "No se confirmó el envío; IMMERSA lo reintentará automáticamente.");
          if (data.emailNotification?.status !== "sent") feedback.classList.add("error");
        } else {
          resendButton.hidden = true;
          feedback.textContent = data.grant
            ? planLabel(data.grant.origin) + " registrado para " + planLabel(data.grant.plan) + "."
            : "Plan actualizado a " + planLabel(data.plan) + ".";
        }
        form.elements.note.value = "";
      } catch (error) {
        feedback.classList.add("error");
        feedback.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    resendButton.addEventListener("click", async () => {
      const feedback = card.querySelector(".feedback");
      resendButton.disabled = true;
      feedback.className = "feedback";
      feedback.textContent = "Reenviando…";
      try {
        const response = await fetch("/api/admin/accounts/" + encodeURIComponent(account.workspaceId) + "/downgrade-email", { method: "POST" });
        const data = await response.json();
        if (!response.ok || !["sent", "already_sent"].includes(data.emailNotification?.status)) {
          throw new Error(data.emailNotification?.detail || data.error || "No se pudo reenviar el correo");
        }
        feedback.classList.add("success");
        feedback.textContent = data.emailNotification.status === "already_sent"
          ? "El correo de downgrade ya había sido enviado a " + account.email + "."
          : "Correo de downgrade reenviado a " + account.email + ".";
      } catch (error) {
        feedback.classList.add("error");
        feedback.textContent = error.message;
      } finally {
        resendButton.disabled = false;
      }
    });
    accountsRoot.appendChild(card);
  });
}


const invoiceRequestLabel = (status) => ({
  pending: "Pendiente",
  in_process: "En proceso",
  sent: "Enviada",
  correction_required: "Requiere corrección"
})[status] || status;

function renderInvoiceRequests(requests) {
  invoiceRequestsRoot.replaceChildren();
  invoiceAdminStatus.textContent = requests.length + " solicitud" + (requests.length === 1 ? "" : "es");
  for (const request of requests) {
    const card = document.createElement("article");
    card.className = "invoice-request";
    card.innerHTML = `<div class="invoice-account"><strong></strong><span></span><small></small></div>
      <div class="invoice-fiscal"><strong></strong><span></span><small></small></div>
      <form><label><span>Estado</span><select name="status"><option value="pending">Pendiente</option><option value="in_process">En proceso</option><option value="correction_required">Requiere corrección</option><option value="sent">Enviada</option></select></label><label><span>UUID CFDI opcional</span><input name="cfdiUuid" maxlength="64"></label><label><span>Nota administrativa</span><input name="adminNote" maxlength="500"></label><button type="submit">Guardar estado</button><p class="request-feedback" role="status"></p></form>`;
    const account = card.querySelector(".invoice-account");
    account.querySelector("strong").textContent = request.account_name || "Cuenta IMMERSA";
    account.querySelector("span").textContent = request.account_email || "";
    account.querySelector("small").textContent = new Intl.NumberFormat("es-MX", {
      style: "currency", currency: String(request.currency || "MXN").toUpperCase()
    }).format(Math.max(0, Number(request.amount_total) || 0) / 100)
      + " · pago " + new Date(request.paid_at).toLocaleDateString("es-MX")
      + " · " + (request.timing === "late" ? "EXTEMPORÁNEA" : "ORDINARIA");
    if (request.timing === "late") account.querySelector("small").classList.add("late");
    const fiscal = card.querySelector(".invoice-fiscal");
    fiscal.querySelector("strong").textContent = request.legal_name;
    fiscal.querySelector("span").textContent = request.rfc + " · CP " + request.fiscal_postal_code;
    fiscal.querySelector("small").textContent = "Régimen " + request.fiscal_regime + " · Uso " + request.cfdi_use
      + " · " + invoiceRequestLabel(request.status);
    const form = card.querySelector("form");
    form.elements.status.value = request.status;
    form.elements.cfdiUuid.value = request.cfdi_uuid || "";
    form.elements.adminNote.value = request.admin_note || "";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const feedback = form.querySelector(".request-feedback");
      const button = form.querySelector("button");
      button.disabled = true;
      feedback.className = "request-feedback";
      feedback.textContent = "Guardando…";
      try {
        const response = await fetch("/api/admin/billing/invoice-requests/" + encodeURIComponent(request.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: form.elements.status.value,
            cfdiUuid: form.elements.cfdiUuid.value,
            adminNote: form.elements.adminNote.value
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo actualizar");
        request.status = data.request.status;
        request.cfdi_uuid = data.request.cfdi_uuid;
        request.admin_note = data.request.admin_note;
        fiscal.querySelector("small").textContent = "Régimen " + request.fiscal_regime + " · Uso " + request.cfdi_use
          + " · " + invoiceRequestLabel(request.status);
        feedback.classList.add("success");
        feedback.textContent = "Estado actualizado.";
      } catch (error) {
        feedback.classList.add("error");
        feedback.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    invoiceRequestsRoot.appendChild(card);
  }
}

async function loadInvoiceRequests() {
  try {
    const status = invoiceStatusFilter.value;
    const response = await fetch("/api/admin/billing/invoice-requests" + (status ? "?status=" + encodeURIComponent(status) : ""), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudieron cargar las solicitudes");
    renderInvoiceRequests(Array.isArray(data.requests) ? data.requests : []);
  } catch (error) {
    invoiceAdminStatus.textContent = error.message;
    invoiceAdminStatus.classList.add("error");
  }
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
invoiceStatusFilter.addEventListener("change", loadInvoiceRequests);
void Promise.all([load(), loadInvoiceRequests()]);
