(() => {
  "use strict";
  const find = (selector) => () => document.querySelector(selector);
  const definitions = [
    {
      id: "home-first-steps",
      version: 1,
      context: "home",
      steps: [
        { id: "welcome", target: find("#inicio"), title: "Este es tu HOME", copy: "Aquí preparas y administras cada experiencia IMMERSA.", type: "informative" },
        { id: "decks", target: find("#deckList"), title: "Tus Decks", copy: "Cada Deck conserva su contenido y su configuración.", type: "informative" },
        { id: "demo", target: find("#deckList"), title: "Deck Demo", copy: "Ábrelo para conocer IMMERSA sin modificar tu contenido.", type: "action-required", advanceWhen: () => !document.getElementById("deckDetailModal")?.hidden },
        { id: "slides", target: find("#detailSlideStrip"), title: "Slides y miniaturas", copy: "Aquí recorres visualmente el contenido de este Deck.", type: "informative" },
        { id: "setup", target: find("#deckTabParticipation"), title: "Prepara la participación", copy: "En esta sección configuras Encuestas, Trivias, Evaluaciones y otras herramientas.", type: "action-required", advanceWhen: { selector: "#deckTabParticipation", event: "click" } },
        { id: "video", target: find("#deckTabVideo"), title: "Capa audiovisual", copy: "Aquí agregas video a slides específicos de tu Deck.", type: "informative" },
        { id: "transitions", target: find("#deckTransitionSettings"), title: "Transiciones", copy: "Elige Flash, Disolvencia, Wipe o Ninguna para tus cambios de slide.", type: "informative" },
        { id: "links", target: find("#detailActions"), title: "Tres accesos", copy: "Speaker controla. Pantalla es la salida visual. Público participa desde su dispositivo.", type: "informative" },
        { id: "screen", target: find(".role-screen"), title: "Abre Pantalla", copy: "Copia este acceso y ábrelo en la pantalla donde proyectarás.", type: "action-required", advanceWhen: { selector: ".role-screen", event: "click" } },
        { id: "audience", target: find(".role-audience"), title: "Abre Público", copy: "Comparte este acceso con un teléfono para vivir la experiencia completa.", type: "action-required", advanceWhen: { selector: ".role-audience", event: "click" } },
        { id: "speaker", target: find(".role-speaker"), title: "Abre Speaker", copy: "Ahora controla la experiencia desde Speaker.", type: "action-required", advanceWhen: { selector: ".role-speaker", event: "click" }, nextContext: "speaker-next" }
      ]
    },
    {
      id: "home-first-steps",
      version: 1,
      context: "speaker",
      steps: [
        { id: "speaker-next", target: find("#next"), title: "Hazlo en vivo", copy: "Pulsa Siguiente. Pantalla y Público se sincronizan con tu control.", type: "action-required", advanceWhen: { selector: "#next", event: "click" } },
        { id: "speaker-qr", target: find("#audienceQr"), title: "Comparte el QR", copy: "Cuando presentes, este QR ayuda al público a entrar desde su teléfono.", type: "informative" },
        { id: "speaker-fullscreen", target: find("#fullscreenToggle"), title: "Pantalla completa", copy: "Usa este control cuando quieras concentrarte en la experiencia.", type: "informative" },
        { id: "finish", target: find("#deckHomeLink"), title: "Listo", copy: "Ya conoces el flujo esencial: prepara en HOME y controla en Speaker.", type: "informative" }
      ]
    }
  ];
  window.ImmersaTutorials?.boot(definitions);
})();