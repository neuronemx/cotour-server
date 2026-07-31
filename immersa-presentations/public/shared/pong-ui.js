(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.ImmersaPongUi = api;
    api.autoMount();
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const ACTIVE_STATUSES = new Set(["ready", "running", "paused", "finished"]);
  const DISPLAY_ROLES = new Set(["screen", "viewer"]);
  const CONTROL_ROLES = new Set(["presenter", "stage"]);
  const HOLD_MS = 75;
  const CELEBRATION_MS = 1200;
  const AUDIENCE_GOAL_MS = 1000;
  const PONG_INTRO_URL = "/assets/games/pong/intro.mp4";
  const PONG_INTRO_REVEAL_AT_SECONDS = 10;
  const PONG_INTRO_LOAD_TIMEOUT_MS = 6000;

  function roleFromPath(path) {
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(path)) return "presenter";
    if (/^\/stage(?:\/|$)/.test(path)) return "stage";
    if (/^\/screen(?:\/|$)/.test(path)) return "screen";
    if (/^\/viewer(?:\/|$)/.test(path)) return "viewer";
    if (/^\/(?:audience(?:\/|$)|p_[a-z0-9]+$)/i.test(path)) return "audience";
    return "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function seconds(ms) {
    return Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  }

  function team(state, id) {
    const defaults = id === "left"
      ? { id: "left", name: "Equipo Azul", color: "#2f80ed", score: 0 }
      : { id: "right", name: "Equipo Naranja", color: "#f2994a", score: 0 };
    return { ...defaults, ...(state?.teams?.[id] || {}) };
  }

  function actionButton(label, event, className = "", disabled = false) {
    return '<button type="button" class="pong-action '+className+'" data-pong-event="'+event+'"'+(disabled ? ' disabled aria-disabled="true"' : '')+'>'+label+'</button>';
  }

  function queueActionButton(label, event, className = "") {
    return '<button type="button" class="pong-action '+className+'" data-games-queue-event="'+event+'">'+label+'</button>';
  }

  function teamsReady(state) {
    return Number(state?.roster_counts?.left || 0) > 0 && Number(state?.roster_counts?.right || 0) > 0;
  }

  function actions(state, queue = {}) {
    const status = state?.status || "idle";
    const queued = (queue.status === "running" || queue.status === "finished") && queue.current_game_type === "pong";
    if (queued) {
      const end = queueActionButton("Terminar juegos", "games:queue:end", "danger");
      const skip = queue.next_game_type ? queueActionButton("Saltar juego", "games:queue:skip") : "";
      if (status === "ready") return actionButton("Iniciar", "pong:start", "primary", !teamsReady(state)) + skip + end;
      if (status === "running") return actionButton("Pausar", "pong:pause") + skip + end;
      if (status === "paused") return actionButton("Reanudar", "pong:resume", "primary") + skip + end;
      return end;
    }
    if (status === "ready") return actionButton("Iniciar", "pong:start", "primary", !teamsReady(state)) + actionButton("Cerrar", "pong:close", "danger");
    if (status === "running") return actionButton("Pausar", "pong:pause") + actionButton("Cerrar", "pong:close", "danger");
    if (status === "paused") return actionButton("Reanudar", "pong:resume", "primary") + actionButton("Cerrar", "pong:close", "danger");
    if (status === "finished") return actionButton("Preparar otra vez", "pong:prepare", "primary") + actionButton("Cerrar", "pong:close", "danger");
    return actionButton("Abrir lobby", "pong:prepare", "primary");
  }

  function resultLabel(state) {
    if (state?.winner_team === "tie") return "Empate";
    if (state?.winner_team === "left" || state?.winner_team === "right") return team(state, state.winner_team).name + " gana";
    return "Partida terminada";
  }

  function statusLabel(state, queue = {}) {
    if (queue.transition_at_ms) return "Preparando siguiente juego…";
    if (state?.status === "ready" && !teamsReady(state)) return "Se necesita al menos 1 persona en cada equipo";
    if (state?.status === "ready") return "Lobby abierto · el público elige equipo";
    if (state?.status === "running") return "Partida en curso";
    if (state?.status === "paused") return "Partida pausada";
    if (state?.status === "finished") return resultLabel(state);
    return "Listo para abrir el lobby";
  }

  function teamEditorMarkup(state, id) {
    const current = team(state, id);
    const count = Number(state?.roster_counts?.[id] || 0);
    return '<label class="pong-team-editor is-'+id+'">'
      +'<span>'+(id === "left" ? "Izquierdo · Azul" : "Derecho · Naranja")+'</span>'
      +'<input type="text" maxlength="24" autocomplete="off" data-pong-team-name="'+id+'" value="'+escapeHtml(current.name)+'" aria-label="Nombre del equipo '+(id === "left" ? "azul" : "naranja")+'">'
      +'<small data-pong-roster-count="'+id+'">'+count+' '+(count === 1 ? "persona" : "personas")+'</small>'
      +'</label>';
  }

  function scoreCardMarkup(state, id) {
    const current = team(state, id);
    return '<div class="pong-controller-team is-'+id+'">'
      +'<span data-pong-controller-team-name="'+id+'">'+escapeHtml(current.name)+'</span>'
      +'<strong data-pong-controller-score="'+id+'">'+Number(current.score || 0)+'</strong>'
      +'</div>';
  }

  function controllerMarkup(state = {}, queue = {}) {
    const status = state.status || "idle";
    const lobby = status === "ready";
    const teams = lobby
      ? '<div class="pong-team-editors">'+teamEditorMarkup(state, "left")+teamEditorMarkup(state, "right")+'</div>'
      : '<div class="pong-controller-scoreboard">'+scoreCardMarkup(state, "left")+scoreCardMarkup(state, "right")+'</div>';
    const totalRoster = Number(state?.roster_counts?.left || 0) + Number(state?.roster_counts?.right || 0);
    return '<section class="pong-controller">'
      +'<div class="pong-controller-head"><span>Juego competitivo</span><h3>PONG</h3><p>Azul controla la izquierda y naranja controla la derecha.</p></div>'
      +teams
      +'<div class="pong-controller-stats">'
      +'<div><span>Tiempo</span><strong data-pong-time>'+(lobby ? "60 s" : seconds(state.remaining_ms)+" s")+'</strong></div>'
      +'<div><span>Velocidad</span><strong data-pong-speed>'+Number(state.speed_multiplier || 1).toFixed(2)+'×</strong></div>'
      +'<div><span>Jugadores</span><strong data-pong-roster-total>'+totalRoster+'</strong></div>'
      +'</div>'
      +'<div class="pong-controller-status" data-pong-status>'+escapeHtml(statusLabel(state, queue))+'</div>'
      +'<div class="pong-controller-actions" data-pong-actions>'+actions(state, queue)+'</div>'
      +'</section>';
  }

  function paddleMarkup(state, id) {
    const paddle = state?.paddles?.[id] || { x: id === "left" ? 0.055 : 0.945, y: 0.5, width: 0.025, height: 0.22 };
    return '<i class="pong-paddle is-'+id+'" data-pong-paddle="'+id+'" style="--x:'+paddle.x+';--y:'+paddle.y+';--w:'+paddle.width+';--h:'+paddle.height+'"></i>';
  }

  function messageMarkup(state) {
    const status = state?.status || "idle";
    if (status === "ready") {
      const leftCount = Number(state?.roster_counts?.left || 0);
      const rightCount = Number(state?.roster_counts?.right || 0);
      return '<div class="pong-message pong-lobby-message">'
        +'<div class="pong-lobby-content">'
        +'<div class="pong-lobby-copy"><strong>ELIGE TU EQUIPO</strong><small>Desde tu teléfono</small></div>'
        +'<div class="pong-lobby-counts"><em class="is-left" data-pong-screen-roster="left">'+leftCount+'</em><b>VS</b><em class="is-right" data-pong-screen-roster="right">'+rightCount+'</em></div>'
        +'</div>'
        +'</div>';
    }
    if (status === "paused") return '<div class="pong-message"><strong>PAUSA</strong></div>';
    if (status === "finished") {
      const label = state.winner_team === "tie" ? "EMPATE" : escapeHtml(team(state, state.winner_team).name) + " GANA";
      return '<div class="pong-message pong-result-message"><span>TIEMPO</span><strong>'+label+'</strong><small>'+Number(team(state, "left").score || 0)+' — '+Number(team(state, "right").score || 0)+'</small></div>';
    }
    return "";
  }

  function celebrationMarkup() {
    const confetti = Array.from({ length: 24 }, (_item, index) => '<i style="--i:'+index+'"></i>').join("");
    return '<div class="pong-goal-celebration" data-pong-goal-celebration hidden>'
      +'<video data-pong-goal-video muted playsinline preload="auto" hidden></video>'
      +'<div class="pong-goal-confetti" aria-hidden="true">'+confetti+'</div>'
      +'<div class="pong-goal-copy"><strong>¡GOOOL!</strong><span data-pong-goal-team></span></div>'
      +'</div>';
  }

  function introMarkup(role, status) {
    if (role !== "screen" || status !== "ready") return "";
    return '<div class="pong-intro" data-pong-intro>'
      +'<video data-pong-intro-video src="'+PONG_INTRO_URL+'" preload="auto" playsinline></video>'
      +'</div>';
  }

  function introStorageKey(id) {
    return "immersa:pong:intro:" + String(id || "");
  }

  function ensureIntroPreload(doc, role) {
    if (role !== "screen" || doc.querySelector?.("[data-pong-intro-preload]")) return;
    const link = doc.createElement("link");
    link.rel = "preload";
    link.as = "video";
    link.href = PONG_INTRO_URL;
    link.dataset.pongIntroPreload = "1";
    doc.head?.appendChild?.(link);
  }

  function boardMarkup(state = {}, role = "screen") {
    const status = state.status || "idle";
    const left = team(state, "left");
    const right = team(state, "right");
    const ball = state.ball || { x: 0.5, y: 0.5, radius: 0.014 };
    const remaining = seconds(state.remaining_ms);
    return '<section class="pong-overlay pong-'+role+' '+status+'">'
      +introMarkup(role, status)
      +'<header class="pong-scoreboard '+(status === "ready" ? "is-lobby" : "")+'">'
      +'<div class="pong-score-team is-left"><span data-pong-screen-name="left">'+escapeHtml(left.name)+'</span><strong data-pong-screen-score="left">'+Number(left.score || 0)+'</strong></div>'
      +(status === "ready" ? "" : '<div class="pong-clock '+(remaining <= 10 && status === "running" ? "is-urgent" : "")+'" data-pong-screen-time>'+remaining+'</div>')
      +'<div class="pong-score-team is-right"><strong data-pong-screen-score="right">'+Number(right.score || 0)+'</strong><span data-pong-screen-name="right">'+escapeHtml(right.name)+'</span></div>'
      +'</header>'
      +'<div class="pong-board">'
      +'<i class="pong-half is-left"></i><i class="pong-half is-right"></i><i class="pong-center-line"></i><i class="pong-center-circle"></i>'
      +paddleMarkup(state, "left")+paddleMarkup(state, "right")
      +(status === "ready" ? "" : '<i class="pong-ball" data-pong-ball style="--x:'+ball.x+';--y:'+ball.y+';--r:'+ball.radius+'"></i>')
      +celebrationMarkup()
      +messageMarkup(state)
      +'</div>'
      +'</section>';
  }

  function audienceResult(state) {
    if (state?.winner_team === "tie") return "EMPATE";
    if (state?.winner_team === "left" || state?.winner_team === "right") return team(state, state.winner_team).name + " GANA";
    return "PARTIDA TERMINADA";
  }

  function audienceHeaderMarkup(state) {
    const left = team(state, "left");
    const right = team(state, "right");
    const lobby = state?.status === "ready";
    return '<header class="pong-audience-header '+(lobby ? "is-lobby" : "")+'">'
      +'<div class="is-left"><span data-pong-audience-name="left">'+escapeHtml(left.name)+'</span><strong data-pong-audience-score="left">'+Number(left.score || 0)+'</strong></div>'
      +(lobby ? "" : '<em data-pong-audience-time>'+seconds(state?.remaining_ms)+' s</em>')
      +'<div class="is-right"><strong data-pong-audience-score="right">'+Number(right.score || 0)+'</strong><span data-pong-audience-name="right">'+escapeHtml(right.name)+'</span></div>'
      +'</header>';
  }

  function isAudienceGoal(membership, goal) {
    return Boolean(membership?.team && membership.team === goal?.scoring_team);
  }

  function audienceGoalMarkup() {
    return '<div class="pong-audience-goal-flash" data-pong-audience-goal role="status" aria-live="polite" hidden>'
      +'<div><strong>¡GOOOL!</strong><span data-pong-audience-goal-team></span></div>'
      +'</div>';
  }

  function teamChoiceMarkup(state) {
    const left = team(state, "left");
    const right = team(state, "right");
    const leftCount = Number(state?.roster_counts?.left || 0);
    const rightCount = Number(state?.roster_counts?.right || 0);
    return '<div class="pong-audience-copy"><strong>Elige tu equipo</strong><span>Puedes cambiar mientras el lobby esté abierto.</span></div>'
      +'<div class="pong-team-choice">'
      +'<button type="button" class="is-left" data-pong-team-choice="left"><span data-pong-choice-name="left">'+escapeHtml(left.name)+'</span><strong>AZUL</strong><small data-pong-choice-count="left">'+leftCount+' '+(leftCount === 1 ? "persona" : "personas")+'</small></button>'
      +'<button type="button" class="is-right" data-pong-team-choice="right"><span data-pong-choice-name="right">'+escapeHtml(right.name)+'</span><strong>NARANJA</strong><small data-pong-choice-count="right">'+rightCount+' '+(rightCount === 1 ? "persona" : "personas")+'</small></button>'
      +'</div>';
  }

  function pongControlImages(side) {
    const glyph = side === "left" ? "←" : "→";
    return '<span class="pong-direction-glyph" aria-hidden="true">'+glyph+'</span>'
      +'<img class="pong-control-art is-off" src="/shared/breakout-controls/'+side+'-off.svg?v=100" alt="" draggable="false">'
      +'<img class="pong-control-art is-on" src="/shared/breakout-controls/'+side+'-on.svg?v=100" alt="" draggable="false">';
  }

  function directionControlsMarkup(state, membership) {
    const current = team(state, membership.team);
    const practice = state.status === "ready";
    const mirrored = membership.team === "right";
    const leftDirection = mirrored ? "down" : "up";
    const rightDirection = mirrored ? "up" : "down";
    return '<div class="pong-audience-copy"><strong>'+(practice ? "Prueba tu paleta" : escapeHtml(current.name))+'</strong><span>'+(practice ? "Mantén presionado para practicar." : "Mantén presionado para mover.")+'</span></div>'
      +'<div class="pong-direction-pad is-'+membership.team+'">'
      +'<button type="button" data-pong-control-side="left" data-pong-direction="'+leftDirection+'" aria-label="Mover paleta hacia '+(leftDirection === "up" ? "arriba" : "abajo")+'">'+pongControlImages("left")+'<small>IZQUIERDA</small></button>'
      +'<button type="button" data-pong-control-side="right" data-pong-direction="'+rightDirection+'" aria-label="Mover paleta hacia '+(rightDirection === "up" ? "arriba" : "abajo")+'">'+pongControlImages("right")+'<small>DERECHA</small></button>'
      +'</div>'
      +(practice ? '<button type="button" class="pong-change-team" data-pong-change-team>Cambiar equipo</button>' : "");
  }

  function spectatorMarkup(state, membership) {
    const finished = state.status === "finished";
    const title = finished ? audienceResult(state) : state.status === "paused" ? "PARTIDA EN PAUSA" : "MIRA LA PARTIDA";
    const copy = membership.spectator
      ? "El roster ya estaba cerrado cuando entraste."
      : finished ? "Gracias por jugar."
        : state.status === "paused" && membership.team ? "Tu equipo espera la reanudación."
          : "Elige equipo cuando se abra el próximo lobby.";
    return '<div class="pong-audience-spectator"><strong>'+escapeHtml(title)+'</strong><span>'+escapeHtml(copy)+'</span></div>';
  }

  function audienceMarkup(state = {}, membership = {}, choosingTeam = false) {
    const status = state.status || "idle";
    const canChoose = status === "ready" && (!membership.team || choosingTeam);
    const canControl = (status === "ready" || status === "running") && Boolean(membership.team) && !choosingTeam;
    const content = canChoose
      ? teamChoiceMarkup(state)
      : canControl ? directionControlsMarkup(state, membership) : spectatorMarkup(state, membership);
    return '<section class="pong-overlay pong-audience '+status+' '+(membership.team ? "is-team-"+membership.team : "is-spectator")+'">'
      +audienceHeaderMarkup(state)
      +'<main>'+content+'</main>'
      +audienceGoalMarkup()
      +'</section>';
  }

  function create(options = {}) {
    const doc = options.document || root.document;
    const socket = options.socket || root.socket;
    const role = options.role || roleFromPath(root.location?.pathname || "");
    if (!doc || !socket || !role) return null;
    ensureIntroPreload(doc, role);
    let state = {
      status: "idle",
      remaining_ms: 60000,
      speed_multiplier: 1,
      roster_counts: { left: 0, right: 0 },
      teams: {
        left: { name: "Equipo Azul", score: 0 },
        right: { name: "Equipo Naranja", score: 0 }
      }
    };
    let membership = { team: "", spectator: false, roster_locked: false };
    let queueState = { status: "idle", current_game_type: "", revision: 0 };
    let queueReady = false;
    let renderer = null;
    let host = null;
    let controllerKey = "";
    let screenKey = "";
    let audienceKey = "";
    let choosingTeam = false;
    let heldDirection = "";
    let holdTimer = null;
    let celebrationTimer = null;
    let audienceGoalTimer = null;
    let lastGoalId = "";
    let lastAudienceGoalId = "";
    let namesTimer = null;
    let mountTimer = null;
    let introLoadTimer = null;
    let introVideo = null;
    let introId = "";
    let destroyed = false;
    let wasActive = false;
    let activateGamesOnce = false;
    const listeners = [];

    function listen(target, name, handler, options) {
      target.addEventListener(name, handler, options);
      listeners.push([target, name, handler, options]);
    }

    function shellView(shell) {
      return shell?.dataset?.view || "home";
    }

    function openController() {
      const button = role === "presenter"
        ? doc.getElementById("interactionToggle")
        : doc.getElementById("stageActionsButton");
      if (button && button.getAttribute("aria-expanded") !== "true") button.click();
    }

    function activateGames(shell) {
      const button = shell?.querySelector?.('[data-interactions-category="games"]');
      if (button && !button.disabled && shellView(shell) !== "games") button.click();
    }

    function emitNames() {
      if (!renderer || state.status !== "ready") return;
      const left = renderer.querySelector('[data-pong-team-name="left"]');
      const right = renderer.querySelector('[data-pong-team-name="right"]');
      if (left && right) socket.emit("pong:teams:set", { left: left.value, right: right.value });
    }

    function scheduleNames() {
      root.clearTimeout(namesTimer);
      namesTimer = root.setTimeout(emitNames, 180);
    }

    function ensureController() {
      const shell = doc.querySelector(".interactions-native-shell");
      if (!shell) return null;
      const content = shell.querySelector("[data-interactions-content-root]");
      if (!content) return null;
      if (!renderer) {
        renderer = doc.createElement("div");
        renderer.className = "interaction-pong-renderer";
        renderer.dataset.interactionsView = "games";
        renderer.hidden = shellView(shell) !== "games";
        content.appendChild(renderer);
        listen(renderer, "click", (event) => {
          const button = event.target.closest?.("[data-pong-event]");
          if (button) {
            if (button.dataset.pongEvent === "pong:start") {
              root.clearTimeout(namesTimer);
              emitNames();
            }
            socket.emit(button.dataset.pongEvent);
          }
          const queueButton = event.target.closest?.("[data-games-queue-event]");
          if (queueButton) socket.emit(queueButton.dataset.gamesQueueEvent);
        });
        listen(renderer, "input", (event) => {
          if (event.target.closest?.("[data-pong-team-name]")) scheduleNames();
        });
        listen(renderer, "change", (event) => {
          if (event.target.closest?.("[data-pong-team-name]")) {
            root.clearTimeout(namesTimer);
            emitNames();
          }
        });
      }
      return shell;
    }

    function patchController() {
      if (!renderer) return;
      const status = state.status || "idle";
      const queued = (queueState.status === "running" || queueState.status === "finished") && queueState.current_game_type === "pong";
      renderer.dataset.gamesQueueHidden = queueReady && !queued && !ACTIVE_STATUSES.has(status) ? "true" : "false";
      const key = [state.id || "", status, queueState.revision || 0, queued, teamsReady(state)].join(":");
      if (controllerKey !== key) {
        renderer.innerHTML = controllerMarkup(state, queueState);
        controllerKey = key;
      }
      const activeElement = doc.activeElement;
      for (const id of ["left", "right"]) {
        const input = renderer.querySelector('[data-pong-team-name="'+id+'"]');
        if (input && input !== activeElement) input.value = team(state, id).name;
        const count = Number(state?.roster_counts?.[id] || 0);
        const roster = renderer.querySelector('[data-pong-roster-count="'+id+'"]');
        if (roster) roster.textContent = count + " " + (count === 1 ? "persona" : "personas");
        const name = renderer.querySelector('[data-pong-controller-team-name="'+id+'"]');
        const score = renderer.querySelector('[data-pong-controller-score="'+id+'"]');
        if (name) name.textContent = team(state, id).name;
        if (score) score.textContent = Number(team(state, id).score || 0);
      }
      const time = renderer.querySelector("[data-pong-time]");
      const speed = renderer.querySelector("[data-pong-speed]");
      const total = renderer.querySelector("[data-pong-roster-total]");
      const label = renderer.querySelector("[data-pong-status]");
      if (time) time.textContent = status === "ready" ? "60 s" : seconds(state.remaining_ms) + " s";
      if (speed) speed.textContent = Number(state.speed_multiplier || 1).toFixed(2) + "×";
      if (total) total.textContent = Number(state?.roster_counts?.left || 0) + Number(state?.roster_counts?.right || 0);
      if (label) label.textContent = statusLabel(state, queueState);
    }

    function ensureOverlay() {
      if (host) return host;
      host = doc.createElement("div");
      host.className = "pong-ui-host";
      doc.body.appendChild(host);
      if (role === "audience") {
        listen(host, "click", (event) => {
          const teamButton = event.target.closest?.("[data-pong-team-choice]");
          if (teamButton && state.status === "ready") {
            choosingTeam = false;
            socket.emit("pong:team:join", { team: teamButton.dataset.pongTeamChoice });
            render();
            return;
          }
          if (event.target.closest?.("[data-pong-change-team]") && state.status === "ready") {
            choosingTeam = true;
            stopHold();
            render();
            return;
          }
        });
        listen(host, "pointerdown", (event) => {
          const button = event.target.closest?.("[data-pong-direction]");
          if (!button || !playable()) return;
          event.preventDefault();
          button.setPointerCapture?.(event.pointerId);
          startHold(button.dataset.pongDirection);
        }, { passive: false });
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) listen(host, name, stopHold);
        for (const name of ["contextmenu", "dragstart", "selectstart"]) listen(host, name, suppressNativeGesture, { passive: false });
      }
      return host;
    }

    function playable() {
      return Boolean(membership.team) && !choosingTeam && (state.status === "ready" || state.status === "running");
    }

    function syncHeld() {
      if (!host) return;
      host.querySelectorAll?.("[data-pong-direction]").forEach((button) => {
        button.classList.toggle("is-held", button.dataset.pongDirection === heldDirection);
      });
    }

    function startHold(direction) {
      heldDirection = direction;
      socket.emit("pong:input", { direction });
      root.clearInterval(holdTimer);
      holdTimer = root.setInterval(() => {
        if (playable()) socket.emit("pong:input", { direction });
      }, HOLD_MS);
      syncHeld();
    }

    function stopHold() {
      heldDirection = "";
      root.clearInterval(holdTimer);
      holdTimer = null;
      syncHeld();
    }

    function suppressNativeGesture(event) {
      if (event.target.closest?.("[data-pong-direction]")) event.preventDefault();
    }

    function setPosition(node, values) {
      if (!node || !values) return;
      for (const [name, value] of Object.entries(values)) node.style.setProperty("--" + name, value);
    }

    function introWasPlayed(id) {
      if (!id) return true;
      try { return root.sessionStorage?.getItem(introStorageKey(id)) === "played"; }
      catch (_error) { return introId === id; }
    }

    function markIntroPlayed(id) {
      introId = id;
      try { root.sessionStorage?.setItem(introStorageKey(id), "played"); }
      catch (_error) {}
    }

    function revealLobby() {
      const overlay = host?.querySelector?.(".pong-screen.ready");
      overlay?.classList?.add("is-intro-revealed");
    }

    function finishIntro() {
      root.clearTimeout(introLoadTimer);
      introLoadTimer = null;
      revealLobby();
      const layer = host?.querySelector?.("[data-pong-intro]");
      layer?.classList?.add("is-finished");
      introVideo?.pause?.();
      introVideo = null;
    }

    function stopIntro() {
      root.clearTimeout(introLoadTimer);
      introLoadTimer = null;
      introVideo?.pause?.();
      introVideo = null;
    }

    function playIntro() {
      if (!introVideo || state.status !== "ready") return;
      const result = introVideo.play?.();
      result?.catch?.((error) => {
        if (error?.name !== "NotAllowedError") finishIntro();
      });
    }

    function setupIntro() {
      if (role !== "screen" || state.status !== "ready") {
        stopIntro();
        return;
      }
      const id = String(state.id || "");
      const layer = host?.querySelector?.("[data-pong-intro]");
      const video = layer?.querySelector?.("[data-pong-intro-video]");
      if (!layer || !video) return;
      if (introWasPlayed(id)) {
        finishIntro();
        return;
      }
      introVideo = video;
      const overlay = layer.closest?.(".pong-overlay");
      overlay?.classList?.add("is-intro-playing");
      video.addEventListener("playing", () => markIntroPlayed(id), { once: true });
      video.addEventListener("timeupdate", () => {
        if (Number(video.currentTime || 0) >= PONG_INTRO_REVEAL_AT_SECONDS) revealLobby();
      });
      video.addEventListener("ended", finishIntro, { once: true });
      video.addEventListener("error", finishIntro, { once: true });
      introLoadTimer = root.setTimeout(() => {
        if (video.readyState < 2) finishIntro();
      }, PONG_INTRO_LOAD_TIMEOUT_MS);
      playIntro();
    }

    function patchScreen() {
      const overlayHost = ensureOverlay();
      const active = ACTIVE_STATUSES.has(state.status);
      overlayHost.hidden = !active;
      if (!active) {
        stopIntro();
        overlayHost.innerHTML = "";
        screenKey = "";
        return;
      }
      const key = [state.id || "", state.status || ""].join(":");
      if (screenKey !== key) {
        stopIntro();
        overlayHost.innerHTML = boardMarkup(state, role);
        screenKey = key;
        setupIntro();
      }
      for (const id of ["left", "right"]) {
        const currentTeam = team(state, id);
        const name = overlayHost.querySelector('[data-pong-screen-name="'+id+'"]');
        const score = overlayHost.querySelector('[data-pong-screen-score="'+id+'"]');
        const roster = overlayHost.querySelector('[data-pong-screen-roster="'+id+'"]');
        if (name) name.textContent = currentTeam.name;
        if (score) score.textContent = Number(currentTeam.score || 0);
        if (roster) roster.textContent = Number(state?.roster_counts?.[id] || 0);
        const paddle = state?.paddles?.[id];
        setPosition(overlayHost.querySelector('[data-pong-paddle="'+id+'"]'), paddle && {
          x: paddle.x, y: paddle.y, w: paddle.width, h: paddle.height
        });
      }
      const ball = state.ball;
      setPosition(overlayHost.querySelector("[data-pong-ball]"), ball && { x: ball.x, y: ball.y, r: ball.radius });
      const clock = overlayHost.querySelector("[data-pong-screen-time]");
      if (clock) {
        clock.textContent = state.status === "ready" ? "LOBBY" : seconds(state.remaining_ms);
        clock.classList.toggle("is-urgent", state.status === "running" && seconds(state.remaining_ms) <= 10);
      }
    }

    function patchAudience() {
      const overlayHost = ensureOverlay();
      const active = ACTIVE_STATUSES.has(state.status);
      overlayHost.hidden = !active;
      if (!active) {
        overlayHost.innerHTML = "";
        audienceKey = "";
        choosingTeam = false;
        stopHold();
        return;
      }
      if (state.status !== "ready") choosingTeam = false;
      const key = [state.id || "", state.status || "", membership.team || "", membership.spectator ? "spectator" : "", choosingTeam ? "choosing" : ""].join(":");
      if (audienceKey !== key) {
        overlayHost.innerHTML = audienceMarkup(state, membership, choosingTeam);
        audienceKey = key;
      }
      for (const id of ["left", "right"]) {
        const currentTeam = team(state, id);
        const name = overlayHost.querySelector('[data-pong-audience-name="'+id+'"]');
        const score = overlayHost.querySelector('[data-pong-audience-score="'+id+'"]');
        const choiceName = overlayHost.querySelector('[data-pong-choice-name="'+id+'"]');
        const choiceCount = overlayHost.querySelector('[data-pong-choice-count="'+id+'"]');
        const count = Number(state?.roster_counts?.[id] || 0);
        if (name) name.textContent = currentTeam.name;
        if (score) score.textContent = Number(currentTeam.score || 0);
        if (choiceName) choiceName.textContent = currentTeam.name;
        if (choiceCount) choiceCount.textContent = count + " " + (count === 1 ? "persona" : "personas");
      }
      const time = overlayHost.querySelector("[data-pong-audience-time]");
      if (time) time.textContent = seconds(state.remaining_ms) + " s";
      if (!playable()) stopHold();
      else syncHeld();
    }

    function showCelebration(goal) {
      if (!DISPLAY_ROLES.has(role) || !goal?.id || goal.id === lastGoalId) return;
      lastGoalId = goal.id;
      const overlayHost = ensureOverlay();
      const layer = overlayHost.querySelector("[data-pong-goal-celebration]");
      if (!layer) return;
      const scoringTeam = goal.scoring_team === "right" ? "right" : "left";
      const label = layer.querySelector("[data-pong-goal-team]");
      if (label) label.textContent = goal.scoring_team_name || team(state, scoringTeam).name;
      layer.classList.remove("is-left", "is-right", "is-active");
      layer.classList.add("is-" + scoringTeam);
      layer.hidden = false;
      void layer.offsetWidth;
      layer.classList.add("is-active");
      const video = layer.querySelector("[data-pong-goal-video]");
      const videoUrl = String(root.IMMERSA_PONG_GOAL_VIDEO_URL || "").trim();
      if (video) {
        video.hidden = !videoUrl;
        if (videoUrl) {
          if (video.getAttribute("src") !== videoUrl) video.setAttribute("src", videoUrl);
          try { video.currentTime = 0; } catch (_error) {}
          video.play?.().catch?.(() => {});
        }
      }
      root.clearTimeout(celebrationTimer);
      celebrationTimer = root.setTimeout(() => {
        layer.classList.remove("is-active");
        layer.hidden = true;
        video?.pause?.();
      }, CELEBRATION_MS);
    }

    function showAudienceGoal(goal) {
      if (role !== "audience" || !goal?.id || goal.id === lastAudienceGoalId) return;
      lastAudienceGoalId = goal.id;
      if (!isAudienceGoal(membership, goal)) return;
      const layer = ensureOverlay().querySelector("[data-pong-audience-goal]");
      if (!layer) return;
      const scoringTeam = goal.scoring_team === "right" ? "right" : "left";
      const label = layer.querySelector("[data-pong-audience-goal-team]");
      if (label) label.textContent = goal.scoring_team_name || team(state, scoringTeam).name;
      layer.classList.remove("is-left", "is-right", "is-active");
      layer.classList.add("is-" + scoringTeam);
      layer.hidden = false;
      void layer.offsetWidth;
      layer.classList.add("is-active");
      root.clearTimeout(audienceGoalTimer);
      audienceGoalTimer = root.setTimeout(() => {
        layer.classList.remove("is-active");
        layer.hidden = true;
      }, AUDIENCE_GOAL_MS);
    }

    function render() {
      if (CONTROL_ROLES.has(role)) {
        const active = ACTIVE_STATUSES.has(state.status);
        if (active && !wasActive) {
          activateGamesOnce = true;
          openController();
        }
        const shell = ensureController();
        patchController();
        if (shell && activateGamesOnce) {
          activateGamesOnce = false;
          activateGames(shell);
        }
        wasActive = active;
        return;
      }
      if (DISPLAY_ROLES.has(role)) patchScreen();
      else if (role === "audience") patchAudience();
    }

    function handle(next) {
      state = next || state;
      render();
    }

    function handleQueue(next) {
      queueReady = true;
      queueState = next || queueState;
      render();
    }

    function handleMembership(next) {
      membership = { ...membership, ...(next || {}) };
      if (membership.team) choosingTeam = false;
      render();
    }

    function handleGoal(goal) {
      showCelebration(goal);
      showAudienceGoal(goal);
    }

    function requestState() {
      socket.emit("pong:request_state");
    }

    const closeForOther = (payload) => {
      if (CONTROL_ROLES.has(role) && ACTIVE_STATUSES.has(state.status) && (payload?.active || payload?.id || payload?.state)) {
        socket.emit(queueReady ? "games:queue:end" : "pong:close");
      }
    };
    socket.on("pong:state", handle);
    socket.on("pong:closed", handle);
    socket.on("pong:membership", handleMembership);
    socket.on("pong:goal", handleGoal);
    socket.on("games:queue:state", handleQueue);
    socket.on("interaction:active", closeForOther);
    socket.on("raffle:active", closeForOther);
    socket.on("connect", requestState);
    if (role === "screen") {
      listen(doc, "click", (event) => {
        if (event.target.closest?.("[data-immersa-media-unlock], [data-pong-audio-unlock], [data-breakout-audio-unlock]")) {
          playIntro();
        }
      });
    }
    if (CONTROL_ROLES.has(role)) {
      mountTimer = root.setInterval(() => {
        if (!destroyed && !renderer) render();
      }, 250);
    }
    render();
    requestState();
    root.setTimeout(requestState, 350);

    return {
      getState: () => state,
      render,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopHold();
        root.clearTimeout(namesTimer);
        root.clearTimeout(celebrationTimer);
        root.clearTimeout(audienceGoalTimer);
        stopIntro();
        root.clearInterval(mountTimer);
        socket.off?.("pong:state", handle);
        socket.off?.("pong:closed", handle);
        socket.off?.("pong:membership", handleMembership);
        socket.off?.("pong:goal", handleGoal);
        socket.off?.("games:queue:state", handleQueue);
        socket.off?.("interaction:active", closeForOther);
        socket.off?.("raffle:active", closeForOther);
        socket.off?.("connect", requestState);
        listeners.splice(0).forEach(([target, name, handler, options]) => target.removeEventListener(name, handler, options));
        renderer?.remove();
        host?.remove();
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

  return {
    create,
    autoMount,
    roleFromPath,
    controllerMarkup,
    boardMarkup,
    audienceMarkup,
    isAudienceGoal,
    statusLabel,
    escapeHtml,
    introStorageKey,
    ensureIntroPreload,
    PONG_INTRO_URL,
    PONG_INTRO_REVEAL_AT_SECONDS
  };
});
