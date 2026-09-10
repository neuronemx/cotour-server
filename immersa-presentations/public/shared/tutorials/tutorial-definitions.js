(() => {
  "use strict";
  const find = (selector) => () => document.querySelector(selector);
  const openDemo = () => {
    const rows = [...document.querySelectorAll("#deckList .deck-row")];
    const demo = rows.find((row) => /DEMO|MAESTRO/i.test(row.textContent || "")) || rows[0];
    demo?.click();
  };
  window.ImmersaTutorials?.boot([{
    id: "home-first-steps",
    version: 2,
    context: "home",
    steps: [
      { id: "welcome", target: find("#inicio"), title: "Bienvenido a IMMERSA", copy: "En pocos pasos conocerás cómo preparar tu primera experiencia.", type: "informative" },
      { id: "home-decks", target: find("#deckList"), title: "HOME y Deck Demo", copy: "Aquí están tus Decks. El Deck Demo te permite conocer IMMERSA sin modificar tu contenido.", type: "informative" },
      { id: "account", target: find("#planBadge"), title: "Tu plan y perfil", copy: "Aquí consultas tus límites y administras tu perfil.", type: "informative" },
      { id: "upload", target: find("#fileDrop"), title: "Sube tu contenido", copy: "Este es el punto de partida para crear un nuevo Deck.", type: "informative" },
      { id: "deck", target: find("#deckDetailModal:not([hidden])"), prepare: openDemo, title: "Este es un Deck", copy: "Cada Deck conserva su contenido y toda la configuración asociada.", type: "informative" },
      { id: "slides", target: find("#detailSlideStrip"), title: "Slides y miniaturas", copy: "Aquí recorres las slides de tu Deck de forma visual.", type: "informative" },
      { id: "videos", target: find("#deckTabVideo"), title: "Videos", copy: "Aquí agregas video a slides específicos del Deck.", type: "informative" },
      { id: "participation", target: find("#deckTabParticipation"), title: "Participación", copy: "Aquí preparas Encuestas, Trivias, Evaluaciones y las demás herramientas.", type: "informative" },
      { id: "transitions", target: find("#deckTransitionSettings"), title: "Transiciones", copy: "Puedes elegir Flash, Disolvencia, Wipe o Ninguna.", type: "informative" },
      { id: "accesses", target: find("#detailActions"), title: "La experiencia conectada", copy: "Speaker controla. Pantalla proyecta. Público participa desde su dispositivo. Si cuentas con acceso, Asistente te apoya desde Backstage.", type: "informative" },
      { id: "screen", target: find(".role-screen"), title: "Prepara Pantalla", copy: "Al terminar el tutorial, copia este enlace y ábrelo en otra pestaña, navegador o computadora. Después regresa a HOME.", type: "informative" },
      { id: "finish", target: find(".role-speaker"), title: "Listo para presentar", copy: "Termina este tutorial y abre Speaker para controlar la experiencia. Desde ahí podrás mostrar el QR para que el Público entre.", type: "informative" }
    ]
  }]);
})();