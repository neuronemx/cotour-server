(() => {
  "use strict";
  const find = (selector) => () => document.querySelector(selector);
  const accountBounds = () => {
    const plan = document.getElementById("planBadge")?.getBoundingClientRect();
    const profile = document.getElementById("profileButton")?.getBoundingClientRect();
    if (!plan || !profile) return null;
    return { left: plan.left, top: Math.min(plan.top, profile.top), right: profile.right, bottom: Math.max(plan.bottom, profile.bottom), width: profile.right - plan.left, height: Math.max(plan.bottom, profile.bottom) - Math.min(plan.top, profile.top) };
  };
  const demoRow = () => {
    const rows = [...document.querySelectorAll("#deckList .deck-row")];
    return rows.find((row) => /DEMO|MAESTRO/i.test(row.textContent || "")) || rows[0] || null;
  };
  const openDemo = () => {
    demoRow()?.click();
  };
  window.ImmersaTutorials?.boot([{
    id: "home-first-steps",
    version: 2,
    context: "home",
    steps: [
      { id: "welcome", target: find("#inicio"), intro: true, title: "Bienvenido a IMMERSA", copy: "En pocos pasos conocerás cómo preparar tu primera experiencia.", type: "informative" },
      { id: "account", target: find("#planBadge"), bounds: accountBounds, title: "Tu plan y perfil", copy: "Aquí consultas el uso de tu plan y defines tu perfil que verá toda tu audiencia.", type: "informative" },
      { id: "upload", target: find(".create-panel"), title: "Sube tu presentación", copy: "Así creas tu nuevo Deck y podrás agregarle interactividad.", type: "informative" },
      { id: "home-decks", target: find("#deckList"), title: "Decks", copy: "Aquí están tus Decks. El Deck Demo te permite correr una presentación prediseñada para que conozcas todas las funciones. Este Deck no lo puedes editar ni borrar, pero no te ocupa espacio.", type: "informative" },
      { id: "deck", target: find("#deckDetailModal:not([hidden]) .deck-detail-modal"), prepare: openDemo, cleanup: () => document.getElementById("closeDeckDetail")?.click(), title: "Este es el home de tu Deck", copy: "Es donde agregas la capa audiovisual y la interactiva. Aquí defines las funciones que estarán disponibles durante tu presentación.", type: "informative" },
      { id: "slides", target: find("#detailSlideStrip"), title: "Slides y miniaturas", copy: "Aquí recorres los slides de tu Deck de forma visual y compruebas que están completos.", type: "informative" },
      { id: "videos", target: find("#deckTabVideo"), title: "Videos", copy: "Aquí agregas los videos a slides de tu Deck. Recuerda que los deberás tener localmente en donde correrás el link Pantalla. No se suben a IMMERSA.", type: "informative" },
      { id: "participation", target: find("#deckTabParticipation"), title: "Participación", copy: "Aquí preparas la interactividad que lanzarás desde Speaker: Encuestas, Trivias, Evaluaciones y las demás herramientas.", type: "informative" },
      { id: "transitions", target: find("#deckTransitionSettings"), title: "Transiciones", copy: "Puedes elegir cómo cambian tus slides: Flash, Disolvencia, Wipe o Ninguna.", type: "informative" },
      { id: "accesses", target: find("#detailActions"), title: "La experiencia conectada", copy: "Speaker es el link que controla. Pantalla proyecta. Público participa desde su dispositivo. Si cuentas con acceso, Asistente te apoya mientras presentas.", type: "informative" },
      { id: "screen", target: find(".role-screen"), title: "Prepara Pantalla", copy: "Al terminar el tutorial, copia este enlace y ábrelo en otra pestaña, navegador o computadora. Recuerda que si incluiste videos deben estar en donde abras el link Pantalla. Después regresa a tu Deck para elegir el link Speaker.", type: "informative" },
      { id: "speaker", target: find(".role-speaker"), title: "Listo para presentar", copy: "Abre Speaker para correr en vivo tu presentación y controlar la Pantalla. Desde ahí podrás mostrar el QR para que el Público participe.", type: "informative" },
      { id: "finish", target: find("#inicio"), outro: true, title: "¡Listo para crear!", copy: "Ya conoces el flujo esencial de IMMERSA. Puedes repetir este recorrido en cualquier momento seleccionando el botón ? de la esquina inferior derecha.", type: "informative" }
    ]
  }]);
})();