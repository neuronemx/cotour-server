const qs = new URLSearchParams(window.location.search);
const returnTo = safeReturnTo(qs.get("returnTo")) || "/home";
const loginView = document.getElementById("loginView");
const messageView = document.getElementById("messageView");
const resetView = document.getElementById("resetView");
const emailForm = document.getElementById("emailForm");
const nameLabel = document.getElementById("nameLabel");
const nameInput = document.getElementById("name");
const email = document.getElementById("email");
const password = document.getElementById("password");
const submitButton = document.getElementById("submitButton");
const switchMode = document.getElementById("switchMode");
const switchPrompt = document.getElementById("switchPrompt");
const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");
const authStatus = document.getElementById("authStatus");
const googleButton = document.getElementById("googleButton");
const emailArea = document.getElementById("emailArea");
const messageAction = document.getElementById("messageAction");
const messageSecondary = document.getElementById("messageSecondary");
const messageStatus = document.getElementById("messageStatus");
let createMode = false;
let pendingVerificationEmail = "";

function safeReturnTo(value) {
  const path = String(value || "").trim();
  return path.startsWith("/") && !path.startsWith("//") ? path : "";
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  let data = {};
  try { data = await response.json(); } catch (_error) {}
  if (!response.ok) {
    const error = new Error(data.message || data.error || "No pudimos completar la solicitud.");
    error.code = data.code || "";
    error.status = response.status;
    throw error;
  }
  return data;
}

function friendlyError(error) {
  const code = String(error?.code || "");
  if (code.includes("INVALID_EMAIL_OR_PASSWORD")) return "El correo o la contraseña no coinciden.";
  if (code.includes("EMAIL_NOT_VERIFIED")) return "Confirma tu correo. Te enviamos un nuevo enlace.";
  if (code.includes("USER_ALREADY_EXISTS")) return "Ya existe una cuenta con este correo. Prueba entrar.";
  if (code.includes("PASSWORD_TOO_SHORT")) return "Usa una contraseña de al menos 8 caracteres.";
  if (code.includes("INVALID_EMAIL")) return "Escribe un correo válido.";
  return error?.message || "Algo no salió bien. Inténtalo nuevamente.";
}

function setBusy(busy) {
  submitButton.disabled = busy;
  googleButton.disabled = busy;
}

function showMessage(title, text, actionText = "Volver a entrar") {
  loginView.hidden = true;
  resetView.hidden = true;
  messageView.hidden = false;
  document.getElementById("messageTitle").textContent = title;
  document.getElementById("messageText").textContent = text;
  messageAction.textContent = actionText;
  messageSecondary.hidden = true;
  messageStatus.textContent = "";
  messageStatus.classList.remove("success");
}

function showVerificationMessage(emailValue) {
  pendingVerificationEmail = emailValue;
  showMessage("Revisa tu correo", `Enviamos un enlace a ${emailValue}. Confírmalo y entrarás directo a IMMERSA.`, "Reenviar correo");
  messageSecondary.hidden = false;
}

function setCreateMode(next) {
  createMode = Boolean(next);
  authTitle.textContent = createMode ? "Crea tu cuenta" : "Entra a IMMERSA";
  authSubtitle.textContent = createMode ? "En un minuto tendrás tu primera presentación lista." : "Tus presentaciones, listas para conectar con todos.";
  submitButton.textContent = createMode ? "Crear cuenta" : "Entrar";
  switchPrompt.textContent = createMode ? "¿Ya tienes cuenta?" : "¿Primera vez en IMMERSA?";
  switchMode.textContent = createMode ? "Entrar" : "Crear cuenta";
  nameLabel.hidden = !createMode;
  nameInput.required = createMode;
  password.autocomplete = createMode ? "new-password" : "current-password";
  authStatus.textContent = "";
}

switchMode.addEventListener("click", () => setCreateMode(!createMode));

emailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!emailForm.reportValidity()) return;
  setBusy(true);
  authStatus.textContent = "";
  try {
    if (createMode) {
      const emailValue = email.value.trim();
      await api("/api/auth/sign-up/email", {
        name: nameInput.value.trim(),
        email: emailValue,
        password: password.value,
        callbackURL: returnTo,
        rememberMe: true
      });
      showVerificationMessage(emailValue);
    } else {
      await api("/api/auth/sign-in/email", {
        email: email.value.trim(), password: password.value, callbackURL: returnTo, rememberMe: true
      });
      window.location.assign(returnTo);
    }
  } catch (error) {
    authStatus.textContent = friendlyError(error);
  } finally {
    setBusy(false);
  }
});

googleButton.addEventListener("click", async () => {
  setBusy(true);
  authStatus.textContent = "";
  try {
    const result = await api("/api/auth/sign-in/social", { provider: "google", callbackURL: returnTo });
    if (!result.url) throw new Error("Google no devolvió una URL de acceso.");
    window.location.assign(result.url);
  } catch (error) {
    authStatus.textContent = friendlyError(error);
    setBusy(false);
  }
});

document.getElementById("forgotButton").addEventListener("click", async () => {
  const emailValue = email.value.trim();
  if (!emailValue || !email.checkValidity()) {
    authStatus.textContent = "Escribe primero el correo de tu cuenta.";
    email.focus();
    return;
  }
  setBusy(true);
  try {
    await api("/api/auth/request-password-reset", { email: emailValue, redirectTo: "/auth?mode=reset" });
    showMessage("Revisa tu correo", `Si ${emailValue} está registrado, recibirás un enlace para crear una nueva contraseña.`);
  } catch (error) {
    authStatus.textContent = friendlyError(error);
  } finally {
    setBusy(false);
  }
});

messageAction.addEventListener("click", async () => {
  if (!pendingVerificationEmail) {
    window.location.assign("/auth");
    return;
  }
  messageAction.disabled = true;
  messageStatus.textContent = "";
  try {
    await api("/api/auth/send-verification-email", { email: pendingVerificationEmail, callbackURL: returnTo });
    messageStatus.textContent = "Listo. Te enviamos un nuevo enlace.";
    messageStatus.classList.add("success");
  } catch (error) {
    messageStatus.textContent = friendlyError(error);
    messageStatus.classList.remove("success");
  } finally {
    messageAction.disabled = false;
  }
});

messageSecondary.addEventListener("click", () => {
  pendingVerificationEmail = "";
  messageView.hidden = true;
  loginView.hidden = false;
  setCreateMode(true);
  email.value = "";
  password.value = "";
  email.focus();
});

document.getElementById("resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("newPassword");
  if (!event.currentTarget.reportValidity()) return;
  const resetStatus = document.getElementById("resetStatus");
  resetStatus.textContent = "";
  try {
    await api("/api/auth/reset-password", { token: qs.get("token"), newPassword: input.value });
    showMessage("Contraseña actualizada", "Listo. Ya puedes entrar con tu nueva contraseña.");
  } catch (error) {
    resetStatus.textContent = friendlyError(error);
  }
});

async function boot() {
  if (qs.get("mode") === "reset") {
    loginView.hidden = true;
    resetView.hidden = false;
    if (!qs.get("token")) document.getElementById("resetStatus").textContent = "Este enlace ya no es válido. Solicita uno nuevo.";
    return;
  }
  try {
    const sessionResponse = await fetch("/api/auth/get-session");
    const session = sessionResponse.ok ? await sessionResponse.json() : null;
    if (session?.user) {
      window.location.replace(returnTo);
      return;
    }
    const capabilities = await fetch("/api/account/capabilities").then((response) => response.json());
    googleButton.hidden = !capabilities.google;
    emailArea.hidden = !capabilities.email;
    if (!capabilities.google && !capabilities.email) authStatus.textContent = "El acceso de IMMERSA aún no está configurado en este entorno.";
  } catch (_error) {
    authStatus.textContent = "No pudimos conectar con el acceso de IMMERSA.";
  }
}

boot();
