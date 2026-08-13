(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ImmersaGamesUi = api;
    api.autoMount();
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  function roleFromPath(path) {
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(path)) return "presenter";
    if (/^\/stage(?:\/|$)/.test(path)) return "stage";
    return "";
  }

  function queueMarkup(state = {}) {
    const selected = new Set(state.selected || []);
    const available = (state.catalog || []).filter((game) => game.available);
    const cards = available.map((game) => {
      const checked = selected.has(game.id);
      const order = checked ? (state.selected || []).indexOf(game.id) + 1 : 0;
      return '<label class="games-queue-card '+(checked?'is-selected':'')+'">'
        +'<input type="checkbox" data-games-queue-game="'+game.id+'" '+(checked?'checked':'')+'>'
        +'<span class="games-queue-check" aria-hidden="true">'+(checked?'✓':'')+'</span>'
        +'<span class="games-queue-copy"><strong>'+game.title+'</strong><small>'+game.mode+' · Nivel '+game.difficulty+'</small></span>'
        +(order?'<em>'+order+'</em>':'')
        +'</label>';
    }).join("");
    const content = cards || (state.hydrated
      ? '<p class="games-queue-empty">No hay juegos disponibles.</p>'
      : '<p class="games-queue-empty">Cargando juegos…</p>');
    return '<section class="games-queue-selector">'
      +'<div class="games-queue-heading"><span>Secuencia de juegos</span><h3>Selecciona los juegos</h3><p>Immersa los ordenará automáticamente de menor a mayor dificultad.</p></div>'
      +'<div class="games-queue-list">'+content+'</div>'
      +'<button type="button" class="games-queue-start" data-games-queue-start '+(selected.size?'':'disabled')+'>Iniciar juegos</button>'
      +'</section>';
  }

  function create(options = {}) {
    const doc = options.document || root.document;
    const socket = options.socket || root.socket;
    const role = options.role || roleFromPath(root.location?.pathname || "");
    if (!doc || !socket || !role) return null;
    let state = { status: "idle", selected: [], catalog: [], locked: false, hydrated: false };
    let renderer = null;
    let mountTimer = null;
    let destroyed = false;
    const listeners = [];

    function listen(target, name, handler) {
      target.addEventListener(name, handler);
      listeners.push([target, name, handler]);
    }

    function ensureRenderer() {
      if (renderer) return renderer;
      const shell = doc.querySelector(".interactions-native-shell");
      const content = shell?.querySelector?.("[data-interactions-content-root]");
      if (!shell || !content) return null;
      renderer = doc.createElement("div");
      renderer.className = "interaction-games-queue-renderer";
      renderer.dataset.interactionsView = "games";
      renderer.hidden = true;
      content.appendChild(renderer);
      listen(renderer, "change", (event) => {
        const input = event.target.closest?.("[data-games-queue-game]");
        if (!input || state.locked) return;
        const selected = new Set(state.selected || []);
        if (input.checked) selected.add(input.dataset.gamesQueueGame);
        else selected.delete(input.dataset.gamesQueueGame);
        socket.emit("games:queue:set", { selected: Array.from(selected) });
      });
      listen(renderer, "click", (event) => {
        if (event.target.closest?.("[data-games-queue-start]") && !state.locked && state.selected?.length) {
          socket.emit("games:queue:start");
        }
      });
      return renderer;
    }

    function render() {
      const node = ensureRenderer();
      if (!node) return;
      node.dataset.gamesQueueHidden = state.locked ? "true" : "false";
      node.innerHTML = queueMarkup(state);
    }

    function handle(next) {
      state = { ...(next || state), hydrated: true };
      render();
    }

    function requestState() {
      socket.emit("games:queue:request_state");
    }

    socket.on("games:queue:state", handle);
    socket.on("presentation_state", requestState);
    socket.on("connect", requestState);
    mountTimer = root.setInterval(() => {
      if (destroyed || renderer) return;
      render();
    }, 250);
    render();
    requestState();
    root.setTimeout(requestState, 350);
    root.setTimeout(requestState, 1000);
    return {
      getState: () => state,
      render,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        root.clearInterval(mountTimer);
        socket.off?.("games:queue:state", handle);
        socket.off?.("presentation_state", requestState);
        socket.off?.("connect", requestState);
        listeners.splice(0).forEach(([target, name, handler]) => target.removeEventListener(name, handler));
        renderer?.remove();
      }
    };
  }

  let instance = null;
  let timer = null;
  let attempts = 0;
  function autoMount() {
    if (instance) return instance;
    function mount() {
      const liveSocket = typeof socket !== "undefined" ? socket : root.socket;
      if (!liveSocket || !root.document) return null;
      instance = create({ socket: liveSocket, document: root.document });
      return instance;
    }
    if (mount()) return instance;
    if (!timer) timer = root.setInterval(() => {
      attempts += 1;
      if (mount() || attempts >= 80) {
        root.clearInterval(timer);
        timer = null;
      }
    }, 100);
    return null;
  }

  return { create, autoMount, roleFromPath, queueMarkup };
});
