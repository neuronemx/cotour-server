(function (root) {
  let instance = null;
  let timer = null;
  let attempts = 0;

  function roleFromPath(pathname, configuredRole) {
    const role = configuredRole === "speaker" ? "presenter" : String(configuredRole || "");
    if (["presenter", "stage", "screen", "viewer", "audience"].includes(role)) return role;
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(pathname)) return "presenter";
    if (/^\/stage(?:\/|$)/.test(pathname)) return "stage";
    if (/^\/viewer(?:\/|$)/.test(pathname)) return "viewer";
    if (/^\/screen(?:\/|$)/.test(pathname)) return "screen";
    if (/^\/(?:audience(?:\/|$)|p_[a-z0-9]+$)/i.test(pathname)) return "audience";
    return "";
  }

  function loadUi() {
    if (!root.document.querySelector("link[data-immersa-time-ui]")) {
      const link = root.document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/shared/time-sync-ui.css";
      link.dataset.immersaTimeUi = "1";
      root.document.head.appendChild(link);
    }
    if (!root.document.querySelector("script[data-immersa-time-ui]")) {
      const script = root.document.createElement("script");
      script.src = "/shared/time-sync-ui.js";
      script.dataset.immersaTimeUi = "1";
      root.document.head.appendChild(script);
    }
    if (!root.document.querySelector("link[data-immersa-games-ui]")) {
      const gamesLink = root.document.createElement("link");
      gamesLink.rel = "stylesheet";
      gamesLink.href = "/shared/games-ui.css?v=2";
      gamesLink.dataset.immersaGamesUi = "1";
      root.document.head.appendChild(gamesLink);
    }
    if (!root.document.querySelector("link[data-immersa-breakout-ui]")) {
      const link = root.document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/shared/breakout-ui.css?v=104";
      link.dataset.immersaBreakoutUi = "1";
      root.document.head.appendChild(link);
    }
    if (!root.document.querySelector("link[data-immersa-pong-ui]")) {
      const link = root.document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/shared/pong-ui.css?v=6";
      link.dataset.immersaPongUi = "1";
      root.document.head.appendChild(link);
    }
    if (!root.document.querySelector("script[data-immersa-games-ui]")) {
      const script = root.document.createElement("script");
      script.src = "/shared/games-ui.js?v=2";
      script.dataset.immersaGamesUi = "1";
      root.document.head.appendChild(script);
    }
    if (!root.document.querySelector("script[data-immersa-breakout-ui]")) {
      const script = root.document.createElement("script");
      script.src = "/shared/breakout-ui.js?v=106";
      script.dataset.immersaBreakoutUi = "1";
      root.document.head.appendChild(script);
    }
    if (!root.document.querySelector("script[data-immersa-pong-ui]")) {
      const script = root.document.createElement("script");
      script.src = "/shared/pong-ui.js?v=5";
      script.dataset.immersaPongUi = "1";
      root.document.head.appendChild(script);
    }
  }

  function installSpeakerWakeRecovery(options) {
    const role = options.role;
    const mainSocket = options.socket;
    const connection = options.connection;
    const getJoinPayload = options.getJoinPayload;
    if (role !== "presenter" || !mainSocket || root.__immersaSpeakerWakeRecovery) return null;
    root.__immersaSpeakerWakeRecovery = true;

    const nativeMainEmit = mainSocket.emit.bind(mainSocket);
    let mainJoinedSocketId = mainSocket.connected ? String(mainSocket.id || "") : "";

    function ensureMainJoin() {
      if (!mainSocket.connected) return false;
      const socketId = String(mainSocket.id || "");
      if (socketId && mainJoinedSocketId === socketId) return false;
      if (connection?.isActive?.()) connection.join?.();
      else nativeMainEmit("join_presentation", getJoinPayload());
      mainJoinedSocketId = socketId;
      return true;
    }

    mainSocket.emit = function (eventName, ...args) {
      if (eventName === "drawing_stroke") ensureMainJoin();
      return nativeMainEmit(eventName, ...args);
    };
    mainSocket.on("disconnect", () => { mainJoinedSocketId = ""; });
    mainSocket.on("connect", () => {
      mainJoinedSocketId = "";
      root.setTimeout(ensureMainJoin, 0);
    });

    const controlSocket = typeof overlaySocket !== "undefined" ? overlaySocket : null;
    let ensureControlJoin = () => false;
    let controlWasUsed = false;

    if (controlSocket && controlSocket !== mainSocket) {
      const nativeControlEmit = controlSocket.emit.bind(controlSocket);
      let controlJoinedSocketId = "";

      ensureControlJoin = function () {
        if (!controlSocket.connected) return false;
        const socketId = String(controlSocket.id || "");
        if (socketId && controlJoinedSocketId === socketId) return false;
        nativeControlEmit("join_presentation", { ...getJoinPayload(), role: "stage" });
        controlJoinedSocketId = socketId;
        return true;
      };

      controlSocket.emit = function (eventName, ...args) {
        if (eventName === "join_presentation" && String(args[0]?.role || "") === "stage") {
          controlWasUsed = true;
          controlJoinedSocketId = String(controlSocket.id || "");
          return nativeControlEmit(eventName, ...args);
        }
        if (eventName === "overlay_update") {
          controlWasUsed = true;
          ensureControlJoin();
        }
        return nativeControlEmit(eventName, ...args);
      };
      controlSocket.on("disconnect", () => { controlJoinedSocketId = ""; });
      controlSocket.on("connect", () => {
        controlJoinedSocketId = "";
        if (controlWasUsed) root.setTimeout(ensureControlJoin, 0);
      });
    }

    function recoverAfterWake() {
      [0, 300, 1200].forEach((delay) => {
        root.setTimeout(() => {
          ensureMainJoin();
          if (controlWasUsed) ensureControlJoin();
        }, delay);
      });
    }

    root.document?.addEventListener("visibilitychange", () => {
      if (root.document.visibilityState === "visible") recoverAfterWake();
    });
    root.addEventListener?.("pageshow", recoverAfterWake);

    return { ensureMainJoin, ensureControlJoin, recoverAfterWake };
  }

  function bootstrap() {
    if (instance) return instance;
    if (typeof socket === "undefined" || typeof sessionId === "undefined" || typeof deckId === "undefined") return null;
    const context = typeof roleOpenContext !== "undefined"
      ? roleOpenContext
      : (root.IMMERSA_ROLE_OPEN || root.IMMERSA_PUBLIC_OPEN || {});
    const role = roleFromPath(root.location?.pathname || "", context?.role);
    if (!role || !root.ImmersaTimeSync || !root.ImmersaPresentationConnection) return null;

    const timeSync = root.ImmersaTimeSync.create(socket, { document: root.document });
    const joinPayload = () => {
      const payload = { session: sessionId, deck: deckId, role };
      if (role === "audience" && typeof audienceId !== "undefined") payload.audienceId = audienceId;
      return payload;
    };
    const connection = root.ImmersaPresentationConnection.create(socket, { getJoinPayload: joinPayload, timeSync });
    connection.start({ adoptCurrentConnection: true });
    const wakeRecovery = installSpeakerWakeRecovery({ role, socket, connection, getJoinPayload: joinPayload });

    let synced = false;
    let syncAttempts = 0;
    let retryTimer = null;
    function scheduleRetry() {
      clearTimeout(retryTimer);
      if (!synced && socket.connected && syncAttempts < 8) retryTimer = root.setTimeout(requestSync, 500);
    }
    function requestSync() {
      if (synced || !socket.connected || syncAttempts >= 8) return;
      syncAttempts += 1;
      timeSync.handlePresentationJoin(3).then((sample) => {
        synced = Boolean(sample);
        if (!synced) scheduleRetry();
      }).catch(scheduleRetry);
    }
    socket.on("presentation_state", requestSync);
    socket.on("disconnect", () => {
      synced = false;
      syncAttempts = 0;
      clearTimeout(retryTimer);
    });
    root.setTimeout(requestSync, 300);
    root.ImmersaTimeSyncClient = timeSync;
    root.ImmersaPresentationConnectionClient = connection;
    root.ImmersaSpeakerWakeRecovery = wakeRecovery;
    loadUi();
    instance = { timeSync, connection, wakeRecovery };
    return instance;
  }

  function scheduleBootstrap() {
    if (instance || timer) return;
    timer = root.setInterval(() => {
      attempts += 1;
      if (bootstrap() || attempts >= 50) {
        root.clearInterval(timer);
        timer = null;
      }
    }, 100);
  }

  root.ImmersaPresentationRuntime = { roleFromPath, bootstrap, scheduleBootstrap, installSpeakerWakeRecovery };
  if (!bootstrap()) scheduleBootstrap();
})(typeof window !== "undefined" ? window : globalThis);
