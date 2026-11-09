(() => {
  const context = window.IMMERSA_PUBLIC_OPEN || {};
  const config = context.welcome;
  const dialog = document.getElementById("audienceWelcome");
  if (!config || !/^\/p_[a-z0-9]+$/.test(config.path) || typeof dialog?.showModal !== "function") return;

  const key = "immersa:audience-welcome:" + config.path;
  const nameLifetimeMs = 24 * 60 * 60 * 1000;
  const form = document.getElementById("audienceWelcomeForm");
  const nameField = document.getElementById("audienceWelcomeName");
  const status = document.getElementById("audienceWelcomeStatus");
  const title = document.getElementById("audienceWelcomeTitle");
  const english = {
    audienceWelcomeKicker: "AUDIENCE ACCESS",
    audienceWelcomeTitle: "Welcome",
    audienceWelcomeNameLabel: "What’s your name?",
    audienceWelcomeInfo: "Your name is saved in this browser only for the presentation.",
    audienceWelcomeEnter: "Enter the presentation"
  };
  let name = "";
  let locale = "es";

  function rememberName(value) {
    const record = JSON.stringify({ name: value, expiresAt: Date.now() + nameLifetimeMs });
    try {
      sessionStorage.setItem(key, record);
    } catch (_error) {}
    try {
      localStorage.setItem(key, record);
    } catch (_error) {}
  }

  function readName(storage, allowLegacy = false) {
    const saved = storage.getItem(key);
    if (!saved) return "";
    let record;
    try {
      record = JSON.parse(saved);
    } catch (_error) {}
    if (Number.isFinite(record?.expiresAt)) {
      if (record.expiresAt > Date.now() && typeof record.name === "string") {
        return record.name.trim().slice(0, 80);
      }
      storage.removeItem(key);
    } else if (allowLegacy) {
      const legacyName = saved.trim().slice(0, 80);
      if (legacyName) rememberName(legacyName);
      return legacyName;
    }
    return "";
  }

  try {
    name = readName(localStorage);
  } catch (_error) {}
  if (!name) {
    try {
      name = readName(sessionStorage, true);
    } catch (_error) {}
  }
  try {
    locale = localStorage.getItem("immersa:locale:" + context.session) === "en" ? "en" : "es";
  } catch (_error) {
    // Público can still continue if the browser blocks storage.
  }
  if (locale === "en") {
    Object.entries(english).forEach(([id, value]) => { document.getElementById(id).textContent = value; });
  }
  const say = (es, en) => locale === "en" ? en : es;

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
          rememberName(name);
          form.removeEventListener("submit", submit);
          dialog.close();
          resolve();
        });
      });
    }
  };
})();
