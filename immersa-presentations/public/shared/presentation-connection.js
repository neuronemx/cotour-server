(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaPresentationConnection = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalizeJoinPayload(payload = {}) {
    const session = String(payload.session || payload.session_id || "").trim();
    const deck = String(payload.deck || payload.deckId || "").trim();
    const role = String(payload.role || "").trim();
    if (!session || !deck || !role) return null;
    return { ...payload, session, deck, role };
  }

  function create(socket, options = {}) {
    const getJoinPayload = typeof options.getJoinPayload === "function" ? options.getJoinPayload : () => options.joinPayload || {};
    const timeSync = options.timeSync;
    let active = false;
    let joinedSocketId = "";
    let disconnectedSinceJoin = false;

    function join(force = false) {
      if (!active || !socket.connected) return false;
      const payload = normalizeJoinPayload(getJoinPayload());
      if (!payload) return false;
      const socketId = String(socket.id || "");
      if (!force && socketId && joinedSocketId === socketId && !disconnectedSinceJoin) return false;
      socket.emit("join_presentation", payload);
      joinedSocketId = socketId;
      disconnectedSinceJoin = false;
      Promise.resolve(timeSync?.handlePresentationJoin?.()).catch(() => {});
      options.onJoin?.(payload);
      return true;
    }

    function onConnect() {
      if (joinedSocketId && !disconnectedSinceJoin && joinedSocketId === String(socket.id || "")) return;
      join();
    }
    function onDisconnect() {
      disconnectedSinceJoin = true;
      timeSync?.handleDisconnect?.();
      options.onDisconnect?.();
    }
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    function start({ adoptCurrentConnection = false } = {}) {
      active = true;
      if (adoptCurrentConnection && socket.connected) {
        joinedSocketId = String(socket.id || "");
        disconnectedSinceJoin = false;
        return false;
      }
      return join();
    }

    return {
      start,
      join: () => join(false),
      forceJoin: () => join(true),
      stop: () => { active = false; joinedSocketId = ""; disconnectedSinceJoin = false; },
      isActive: () => active
    };
  }

  return { normalizeJoinPayload, create };
});