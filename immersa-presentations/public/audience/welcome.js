(() => {
  const context = window.IMMERSA_PUBLIC_OPEN || {};
  const config = context.welcome;
  const dialog = document.getElementById("audienceWelcome");
  if (!config || !/^\/p_[a-z0-9]+$/.test(config.path) || typeof dialog?.showModal !== "function") return;

  const key = "immersa:audience-welcome:" + config.path;
  const form = document.getElementById("audienceWelcomeForm");
  const nameField = document.getElementById("audienceWelcomeName");
  const linkField = document.getElementById("audienceWelcomeLink");
  const status = document.getElementById("audienceWelcomeStatus");
  const title = document.getElementById("audienceWelcomeTitle");
  const english = {
    audienceWelcomeKicker: "AUDIENCE ACCESS",
    audienceWelcomeTitle: "Welcome",
    audienceWelcomeNameLabel: "What’s your name?",
    audienceWelcomeInfo: "Your name is saved in this tab and filled in when an activity asks for it. You choose whether to participate.",
    audienceWelcomeEnter: "Enter the presentation",
    audienceWelcomeCopy: "Copy access link"
  };
  let name = "";
  let locale = "es";
  try {
    name = String(sessionStorage.getItem(key) || "").trim().slice(0, 80);
    locale = localStorage.getItem("immersa:locale:" + context.session) === "en" ? "en" : "es";
  } catch (_error) {
    // Público can still continue if the browser blocks storage.
  }
  if (locale === "en") {
    Object.entries(english).forEach(([id, value]) => { document.getElementById(id).textContent = value; });
    linkField.setAttribute("aria-label", "Access link");
  }
  const say = (es, en) => locale === "en" ? en : es;
  const link = new URL(config.path, location.origin).href;

  window.ImmersaAudienceWelcome = {
    required: !name,
    get name() { return name; },
    start() {
      if (name) return Promise.resolve();
      document.getElementById("audienceWelcomeDeck").textContent = config.title || "";
      dialog.addEventListener("cancel", (event) => event.preventDefault());
      dialog.showModal();
      title.focus();
      return new Promise((resolve) => {
        form.addEventListener("submit", function submit(event) {
          event.preventDefault();
          const value = nameField.value.trim();
          if (!value) {
            status.textContent = say("Escribe tu nombre para continuar.", "Enter your name to continue.");
            nameField.focus();
            return;
          }
          name = value.slice(0, 80);
          try { sessionStorage.setItem(key, name); } catch (_error) {}
          form.removeEventListener("submit", submit);
          dialog.close();
          resolve();
        });
      });
    }
  };

  document.getElementById("audienceWelcomeCopy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = say("Enlace copiado. Puedes guardarlo en favoritos.", "Link copied. You can save it to your bookmarks.");
    } catch (_error) {
      linkField.value = link;
      linkField.hidden = false;
      linkField.focus();
      linkField.select();
      status.textContent = say("Copia el enlace seleccionado para guardarlo.", "Copy the selected link to save it.");
    }
  });
})();
