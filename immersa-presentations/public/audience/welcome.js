(() => {
  const context = window.IMMERSA_PUBLIC_OPEN || {};
  const config = context.welcome;
  const dialog = document.getElementById("audienceWelcome");
  if (!config || !/^\/p_[a-z0-9]+$/.test(config.path) || typeof dialog?.showModal !== "function") return;

  const key = "immersa:audience-welcome:" + config.path;
  const form = document.getElementById("audienceWelcomeForm");
  const nameField = document.getElementById("audienceWelcomeName");
  const status = document.getElementById("audienceWelcomeStatus");
  const title = document.getElementById("audienceWelcomeTitle");
  const english = {
    audienceWelcomeKicker: "AUDIENCE ACCESS",
    audienceWelcomeTitle: "Welcome",
    audienceWelcomeNameLabel: "What’s your name?",
    audienceWelcomeInfo: "Your name is saved in this tab only for the presentation.",
    audienceWelcomeEnter: "Enter the presentation",
    audienceWelcomeBookmarks: "Save to bookmarks",
    audienceWelcomeBookmarkMobile: "On your phone, open your browser menu and choose Add Bookmark or Favorites.",
    audienceWelcomeBookmarkDesktop: "On a computer, use Ctrl+D (Windows) or ⌘+D (Mac)."
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
          try {
            sessionStorage.setItem(key, name);
          } catch (_error) {}
          form.removeEventListener("submit", submit);
          dialog.close();
          resolve();
        });
      });
    }
  };
})();
