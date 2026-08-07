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
  const safeName = escapeHtml(name || "");
  const greeting = safeName ? `Hola ${safeName},` : "Hola,";
  const verification = kind === "email-verification";
  const subject = verification ? "Confirma tu correo en IMMERSA" : "Restablece tu contraseña de IMMERSA";
  const title = verification ? "Confirma tu correo" : "Crea una nueva contraseña";
  const action = verification ? "Confirmar correo" : "Restablecer contraseña";
  const intro = verification
    ? "Sólo falta confirmar este correo para entrar a IMMERSA."
    : "Recibimos una solicitud para cambiar la contraseña de tu cuenta IMMERSA.";
  const safeUrl = escapeHtml(url);
  return {
    subject,
    html: `<!doctype html><html><body style="margin:0;background:#f5f6fb;font-family:Inter,Arial,sans-serif;color:#0a0d28"><div style="max-width:560px;margin:0 auto;padding:48px 20px"><div style="background:#fff;border-radius:24px;padding:38px;box-shadow:0 18px 50px rgba(26,28,70,.08)"><div style="font-size:13px;font-weight:800;letter-spacing:.16em;color:#7057ff">IMMERSA</div><h1 style="font-size:28px;line-height:1.15;margin:18px 0 14px">${title}</h1><p style="font-size:16px;line-height:1.65;margin:0 0 10px">${greeting}</p><p style="font-size:16px;line-height:1.65;margin:0 0 26px;color:#555b72">${intro}</p><a href="${safeUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:linear-gradient(100deg,#5e5bff,#b20de9);color:#fff;text-decoration:none;font-weight:700">${action}</a><p style="font-size:12px;line-height:1.6;margin:28px 0 0;color:#8b90a3">Si tú no solicitaste esto, puedes ignorar este correo.</p></div></div></body></html>`
  };
}

function createResendEmailSender(options = {}) {
  const env = options.env || process.env;
  const apiKey = setting(env, "RESEND_API_KEY");
  const from = setting(env, "IMMERSA_EMAIL_FROM");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || !from) return null;
  if (typeof fetchImpl !== "function") throw new Error("fetch is required for Resend email delivery");

  return async ({ kind, to, name, url }) => {
    const recipient = String(to || "").trim();
    if (!recipient || !url) throw new Error("Email recipient and action URL are required");
    const copy = emailCopy(kind, name, url);
    const response = await fetchImpl(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to: [recipient], subject: copy.subject, html: copy.html })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend email delivery failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    }
    return response.json();
  };
}

module.exports = { createResendEmailSender, emailCopy, RESEND_EMAILS_URL };
