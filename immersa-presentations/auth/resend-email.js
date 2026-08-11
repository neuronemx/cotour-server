const RESEND_EMAILS_URL = "https://api.resend.com/emails";

function setting(env, name) {
  return String(env?.[name] || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailCopy(kind, name, url) {
  const safeName = escapeHtml(String(name || "").trim());
  const greeting = safeName ? `Hola ${safeName},` : "Hola,";
  const verification = kind === "email-verification";
  const subject = verification ? "Confirma tu correo en IMMERSA" : "Restablece tu contraseña de IMMERSA";
  const title = verification ? "Confirma tu correo" : "Crea una nueva contraseña";
  const action = verification ? "Confirmar correo" : "Restablecer contraseña";
  const intro = verification
    ? "Sólo falta confirmar este correo para entrar a IMMERSA."
    : "Recibimos una solicitud para cambiar la contraseña de tu cuenta IMMERSA.";
  const safeUrl = escapeHtml(url);
  const logoUrl = "https://app.immersalive.com/home/Logo-Immersa-gris.png?v=1";
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;padding:0;background-color:#f3f4fb;font-family:Arial,sans-serif;color:#0a0d28"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f3f4fb"><tr><td align="center" style="padding:42px 18px"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border-radius:22px;overflow:hidden"><tr><td height="7" bgcolor="#7057ff" style="height:7px;background-color:#7057ff;background-image:linear-gradient(90deg,#06cfe0,#7057ff 52%,#b20de9)"></td></tr><tr><td bgcolor="#ffffff" style="padding:32px 42px 14px;background-color:#ffffff"><img src="${logoUrl}" width="184" alt="IMMERSA" style="display:block;width:184px;max-width:100%;height:auto;border:0"></td></tr><tr><td style="padding:18px 42px 42px"><h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;color:#0a0d28">${title}</h1><p style="margin:0 0 10px;font-size:16px;line-height:1.65;color:#0a0d28">${greeting}</p><p style="margin:0 0 28px;font-size:16px;line-height:1.65;color:#555b72">${intro}</p><table role="presentation" border="0" cellspacing="0" cellpadding="0"><tr><td bgcolor="#7057ff" style="border-radius:999px;background-color:#7057ff;background-image:linear-gradient(100deg,#5e5bff,#b20de9)"><a href="${safeUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold">${action}</a></td></tr></table><p style="margin:30px 0 0;font-size:12px;line-height:1.6;color:#8b90a3">Si tú no solicitaste esto, puedes ignorar este correo.</p></td></tr><tr><td bgcolor="#f7f7fb" style="padding:19px 42px;background-color:#f7f7fb;color:#8b90a3;font-size:11px;line-height:1.5;letter-spacing:.02em">IMMERSA · Presenta e interactúa.</td></tr></table></td></tr></table></body></html>`
  };
}

function accountActivationEmailCopy(user = {}, activatedAt = new Date()) {
  const name = escapeHtml(String(user.name || "").trim() || "Sin nombre");
  const email = escapeHtml(String(user.email || "").trim() || "Sin correo");
  const plan = escapeHtml(String(user.plan || "FREE").trim().toUpperCase());
  const date = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City"
  }).format(new Date(activatedAt));
  return {
    subject: "Nueva cuenta activa en IMMERSA",
    html: `<!doctype html><html><body style="margin:0;padding:0;background-color:#f3f4fb;font-family:Arial,sans-serif;color:#0a0d28"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f3f4fb"><tr><td align="center" style="padding:42px 18px"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#ffffff;border-radius:22px;overflow:hidden"><tr><td height="7" bgcolor="#7057ff" style="height:7px;background-color:#7057ff;background-image:linear-gradient(90deg,#06cfe0,#7057ff 52%,#b20de9)"></td></tr><tr><td style="padding:32px 42px 14px"><h1 style="margin:0;font-size:26px;line-height:1.25">Nueva cuenta activa</h1></td></tr><tr><td style="padding:18px 42px 42px"><p style="margin:0 0 22px;color:#555b72;font-size:15px;line-height:1.6">Una persona completó su acceso a IMMERSA.</p><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size:15px;line-height:1.7"><tr><td style="padding:6px 0;color:#8b90a3">Nombre</td><td style="padding:6px 0;text-align:right;font-weight:bold">${name}</td></tr><tr><td style="padding:6px 0;color:#8b90a3">Correo</td><td style="padding:6px 0;text-align:right;font-weight:bold">${email}</td></tr><tr><td style="padding:6px 0;color:#8b90a3">Plan inicial</td><td style="padding:6px 0;text-align:right;font-weight:bold">${plan}</td></tr><tr><td style="padding:6px 0;color:#8b90a3">Activación</td><td style="padding:6px 0;text-align:right;font-weight:bold">${escapeHtml(date)}</td></tr></table></td></tr><tr><td bgcolor="#f7f7fb" style="padding:19px 42px;color:#8b90a3;font-size:11px;line-height:1.5;letter-spacing:.02em">IMMERSA · Presenta e interactúa.</td></tr></table></td></tr></table></body></html>`
  };
}

function createResendEmailSender(options = {}) {
  const env = options.env || process.env;
  const apiKey = setting(env, "RESEND_API_KEY");
  const from = setting(env, "IMMERSA_EMAIL_FROM");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || !from) return null;
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for Resend email delivery");

  return async ({ kind, to, name, url, user, activatedAt }) => {
    const recipients = (Array.isArray(to) ? to : [to]).map((value) => String(value || "").trim()).filter(Boolean);
    const accountActivation = kind === "account-activation";
    if (!recipients.length || (!accountActivation && !url)) throw new Error("Email recipient and action URL are required");
    const copy = accountActivation ? accountActivationEmailCopy(user, activatedAt) : emailCopy(kind, name, url);
    const response = await fetchImpl(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: recipients, subject: copy.subject, html: copy.html })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend email delivery failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    return response.json();
  };
}

module.exports = { createResendEmailSender, emailCopy, accountActivationEmailCopy, RESEND_EMAILS_URL };
