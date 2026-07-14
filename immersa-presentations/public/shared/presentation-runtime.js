(function (root) {
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

  function bootstrap() {
    if (typeof socket === "undefined" || typeof sessionId === "undefined" || typeof deckId === "undefined") return null;
    const context = typeof roleOpenContext !== "undefined" ? roleOpenContext : (root.IMMERSA_ROLE_OPEN || root.IMMERSA_PUBLIC_OPEN || {});
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

    let synced = false;
    let attempts = 0;
    function requestSync() {
      if (synced || !socket.connected || attempts >= 5) return;
      attempts += 1;
      timeSync.handlePresentationJoin(attempts === 1 ? 3 : 1).then((sample) => { synced = Boolean(sample); }).catch(() => {});
    }
    socket.on("presentation_state", requestSync);
    socket.on("disconnect", () => { synced = false; attempts = 0; });
    root.setTimeout(requestSync, 900);

    root.ImmersaTimeSyncClient = timeSync;
    root.ImmersaPresentationConnectionClient = connection;
    return { timeSync, connection };
  }

  root.ImmersaPresentationRuntime = { roleFromPath, bootstrap };
  bootstrap();
})(typeof window !== "undefined" ? window : globalThis);