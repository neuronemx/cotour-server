const ALLOWED_STATUSES = new Set(["ready", "missing", "mismatched", "incompatible", "validating", "selected"]);

function sessionKey(context = {}) {
  return String(context.sessionId || "") + "::" + String(context.deckId || "");
}

function normalizeStatus(payload = {}, context = {}) {
  const items = (Array.isArray(payload.items) ? payload.items : []).slice(0, 200).map((item) => ({
    slide_id: String(item?.slide_id || ""),
    file_name: String(item?.file_name || "").slice(0, 240),
    status: ALLOWED_STATUSES.has(String(item?.status || "")) ? String(item.status) : "missing"
  })).filter((item) => item.slide_id);
  const counts = {
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    missing: items.filter((item) => item.status === "missing").length,
    mismatched: items.filter((item) => item.status === "mismatched").length,
    incompatible: items.filter((item) => item.status === "incompatible").length,
    validating: items.filter((item) => item.status === "validating" || item.status === "selected").length
  };
  return {
    session_id: String(context.sessionId || ""),
    deck_id: String(context.deckId || payload.deck_id || ""),
    ...counts,
    items,
    updated_at: new Date().toISOString()
  };
}

function createMediaSocketHandlers({ io, getRoleRoomKey }) {
  const statuses = new Map();

  function emitToControlRoles(context, status) {
    io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("media:status", status);
    io.to(getRoleRoomKey(context.roomKey, "stage")).emit("media:status", status);
  }

  function sendCurrentState(socket, context) {
    if (!context?.sessionId || !context?.deckId) return;
    const status = statuses.get(sessionKey(context));
    if (status && (context.role === "presenter" || context.role === "stage")) socket.emit("media:status", status);
  }

  function attach(socket, getContext) {
    socket.on("media:status_update", (payload = {}) => {
      const context = getContext();
      if (!context?.roomKey || !context?.sessionId || !context?.deckId || context.role !== "screen") return;
      const status = normalizeStatus(payload, context);
      statuses.set(sessionKey(context), status);
      emitToControlRoles(context, status);
    });

    socket.on("media:advance_request", ({ slideIndex, nextSlideIndex } = {}) => {
      const context = getContext();
      if (!context?.roomKey || context.role !== "screen") return;
      const current = Number(slideIndex);
      const next = Number(nextSlideIndex);
      if (!Number.isFinite(current) || !Number.isFinite(next) || next <= current) return;
      const payload = { slideIndex: current, nextSlideIndex: next };
      io.to(getRoleRoomKey(context.roomKey, "presenter")).emit("media:advance_request", payload);
      io.to(getRoleRoomKey(context.roomKey, "stage")).emit("media:advance_request", payload);
    });
  }

  return { attach, sendCurrentState, statuses };
}

module.exports = { createMediaSocketHandlers, normalizeStatus, sessionKey };
