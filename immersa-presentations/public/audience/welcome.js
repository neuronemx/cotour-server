(() => {
  const context = window.IMMERSA_PUBLIC_OPEN || {};
  const config = context.welcome;
  const dialog = document.getElementById("audienceWelcome");
  if (!config || !/^\/p_[a-z0-9]+$/.test(config.path) || typeof dialog?.showModal !== "function") return;
  const registration = config.registration || { mode: "name", revision: 0 };
  const contacts = registration.mode !== "name";
  const key = "immersa:audience-welcome:" + config.path;
  const form = document.getElementById("audienceWelcomeForm");
  const nameField = document.getElementById("audienceWelcomeName");
  const status = document.getElementById("audienceWelcomeStatus");
  const title = document.getElementById("audienceWelcomeTitle");
  const skip = document.getElementById("audienceWelcomeSkip");
  const submit = document.getElementById("audienceWelcomeEnter");
  let saved = null;
  let locale = "es";
  try { locale = localStorage.getItem("immersa:locale:" + context.session) === "en" ? "en" : "es"; } catch (_) {}
  const say = (es, en) => locale === "en" ? en : es;
  function remember(record) {
    saved = record;
    for (const storage of ["sessionStorage", "localStorage"]) {
      try { window[storage].setItem(key, JSON.stringify(record)); } catch (_) {}
    }
  }
  function clear() {
    saved = null;
    for (const storage of ["sessionStorage", "localStorage"]) {
      try { window[storage].removeItem(key); } catch (_) {}
    }
  }
  for (const storage of ["localStorage", "sessionStorage"]) {
    try {
      const value = window[storage].getItem(key);
      if (!value) continue;
      let record;
      try { record = JSON.parse(value); } catch (_) {}
      if (!record && !contacts) record = { name: value.trim().slice(0, 120), expiresAt: Date.now() + 86400000 };
      if (record?.expiresAt > Date.now() &&
          (!contacts ? Boolean(typeof record.name === "string" && record.name.trim()) : record.revision === registration.revision && (record.token || record.skipped && registration.mode === "optional"))) {
        saved = record;
        break;
      }
    } catch (_) {}
  }
  const translations = {
    audienceWelcomeKicker: "AUDIENCE ACCESS", audienceWelcomeTitle: "Welcome",
    audienceWelcomeNameLabel: "What’s your name?", audienceWelcomeEnter: "Enter the presentation",
    audienceWelcomeEmailLabel: "Email", audienceWelcomePhoneLabel: "Phone", audienceWelcomeCompanyLabel: "Company",
    audienceWelcomeTermsText: "I accept the", audienceWelcomeTermsLink: "terms and conditions",
    audienceWelcomeSkip: "Continue without registering"
  };
  if (locale === "en") {
    for (const [id, text] of Object.entries(translations)) document.getElementById(id).textContent = text;
  }
  document.getElementById("audienceWelcomeInfo").textContent = say(
    "Tu participación se registra para medir la experiencia de esta presentación.",
    "Your participation is recorded to measure this presentation’s experience."
  );
  document.getElementById("audienceWelcomeContact").hidden = !contacts;
  skip.hidden = registration.mode !== "optional";
  const terms = document.getElementById("audienceWelcomeTerms");
  terms.required = contacts;
  for (const field of ["Email", "Phone", "Company"]) document.getElementById("audienceWelcome" + field).required = contacts;
  if (contacts && /^https:\/\//.test(registration.termsUrl)) {
    document.getElementById("audienceWelcomeTermsLink").href = registration.termsUrl;
  }
  window.ImmersaAudienceWelcome = {
    required: !saved,
    get name() { return saved?.name || ""; },
    get token() { return saved?.token || ""; },
    clear,
    start() {
      if (saved) return Promise.resolve();
      document.getElementById("audienceWelcomeDeck").textContent = config.title || "";
      dialog.addEventListener("cancel", event => event.preventDefault());
      dialog.showModal();
      title.focus();
      return new Promise(resolve => {
        function finish(record) {
          remember(record);
          dialog.close();
          resolve();
        }
        skip.addEventListener("click", () => finish({
          name: "", skipped: true, revision: registration.revision, expiresAt: Date.now() + 86400000
        }), { once: true });
        form.addEventListener("submit", async event => {
          event.preventDefault();
          if (submit.disabled) return;
          const name = nameField.value.trim();
          if (!name) {
            status.textContent = say("Escribe tu nombre para continuar.", "Enter your name to continue.");
            nameField.focus();
            return;
          }
          if (!contacts) return finish({ name, expiresAt: Date.now() + 86400000 });
          submit.disabled = true;
          skip.disabled = true;
          status.textContent = say("Guardando registro…", "Saving registration…");
          try {
            const response = await fetch("/api/audience/" + config.path.slice(1) + "/registration", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audienceId: getAudienceId(), name,
                email: document.getElementById("audienceWelcomeEmail").value,
                phone: document.getElementById("audienceWelcomePhone").value,
                company: document.getElementById("audienceWelcomeCompany").value,
                termsAccepted: terms.checked, revision: registration.revision
              })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || say("No se pudo guardar tu registro.", "Unable to save registration."));
            finish(result);
          } catch (error) {
            status.textContent = error.message;
          } finally {
            submit.disabled = false;
            skip.disabled = false;
          }
        });
      });
    }
  };
})();
