(() => {
  "use strict";
  const VIDEOS = {
    horizontal: "https://media.immersalive.com/spots/Spot_2_H.mp4",
    vertical: "https://media.immersalive.com/spots/Spot_2_V.mp4"
  };

  window.ImmersaHomeHelp = {
    mount(button, startTour) {
      const menu = document.createElement("section");
      menu.id = "homeHelpMenu";
      menu.className = "home-help-menu";
      menu.hidden = true;
      menu.setAttribute("aria-label", "Ayuda de IMMERSA");
      menu.innerHTML = '<strong>¿Cómo te ayudamos?</strong><button type="button" data-help-tour>Recorrido guiado</button><button type="button" data-help-video>Ver primeros pasos <small>Tu primer Deck · 48 s</small></button>';
      document.body.appendChild(menu);
      button.title = "Ayuda";
      button.setAttribute("aria-label", "Ayuda de IMMERSA");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", menu.id);

      const dialog = document.createElement("dialog");
      dialog.className = "home-help-video-dialog";
      dialog.setAttribute("aria-labelledby", "homeHelpVideoTitle");
      dialog.innerHTML = '<header><h2 id="homeHelpVideoTitle">Tu primer Deck</h2><button type="button" data-help-close aria-label="Cerrar video"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><video controls playsinline preload="none" aria-label="Video: primeros pasos en IMMERSA"></video><p data-help-error role="status" hidden>No se pudo cargar el video. Puedes volver a intentarlo o <a target="_blank" rel="noopener noreferrer">abrirlo en otra pestaña</a>.</p>';
      document.body.appendChild(dialog);
      const video = dialog.querySelector("video");
      const error = dialog.querySelector("[data-help-error]");
      const tourButton = menu.querySelector("[data-help-tour]");
      const videoButton = menu.querySelector("[data-help-video]");
      const closeButton = dialog.querySelector("[data-help-close]");

      function closeMenu(restoreFocus = false) {
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
        if (restoreFocus) button.focus();
      }
      button.addEventListener("click", () => {
        if (!menu.hidden) return closeMenu(true);
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        tourButton.focus();
      });
      tourButton.addEventListener("click", () => {
        closeMenu();
        startTour();
      });
      videoButton.addEventListener("click", () => {
        closeMenu();
        const portrait = window.matchMedia("(max-width: 700px) and (orientation: portrait)").matches;
        dialog.classList.toggle("is-portrait", portrait);
        error.hidden = true;
        const source = portrait ? VIDEOS.vertical : VIDEOS.horizontal;
        error.querySelector("a").href = source;
        // Choose once per opening: rotation must not restart an in-progress video.
        video.src = source;
        dialog.showModal();
        closeButton.focus();
      });
      closeButton.addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => {
        if (event.target !== dialog) return;
        const bounds = dialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
      });
      // Keep Escape inside this layer; existing Deck/editor Escape handlers must not run.
      dialog.addEventListener("keydown", (event) => event.stopPropagation());
      dialog.addEventListener("close", () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
        button.focus();
      });
      video.addEventListener("error", () => { if (dialog.open) error.hidden = false; });
      document.addEventListener("click", (event) => {
        if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) closeMenu();
      });
      menu.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeMenu(true);
        }
      });
    }
  };
})();
