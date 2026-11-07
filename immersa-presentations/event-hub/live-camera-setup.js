const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { EventHubError } = require("./repository");
const { readLiveCameraPilot } = require("../live-camera");

function createLiveCameraSetup({ env, dataDir, eventHub }) {
  const slug = env.IMMERSA_LIVE_CAMERA_SETUP_EVENT_SLUG?.trim();
  const betaPilot = env.RAILWAY_ENVIRONMENT_NAME === "beta"
    && env.RAILWAY_SERVICE_NAME === "immersa-presentations"
    && env.RAILWAY_ENVIRONMENT_ID === "9ae7d5ba-2954-4c96-818a-ee918310e20d";
  const origin = env.IMMERSA_LIVE_CAMERA_SETUP_ORIGIN?.trim() || (betaPilot ? "https://beta.immersalive.com" : "");
  if (!eventHub || (!slug && !betaPilot) || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) return null;
  } catch {
    return null;
  }
  const turnUrls = env.IMMERSA_LIVE_CAMERA_SETUP_TURN_URLS?.trim().split(/\s*,\s*/);
  const file = path.join(dataDir, "live-camera-pilot.json");
  let pending = null;
  let pilot = null;

  function parse(config) {
    if (!config?.slug || (slug && config.slug !== slug) || config.origin !== origin) return null;
    const read = options => readLiveCameraPilot({
      IMMERSA_LIVE_CAMERA_PILOT: JSON.stringify(options),
      IMMERSA_LIVE_CAMERA_TURN_SECRET: env.IMMERSA_LIVE_CAMERA_TURN_SECRET
    });
    if (turnUrls?.[0]) {
      const withRelay = read({ ...config, turnUrls });
      if (withRelay) return withRelay;
      console.warn("Invalid Event Hub LIVE TURN configuration; using the saved pilot configuration");
    }
    return read(config);
  }

  try {
    pilot = parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Unable to read Event Hub LIVE pilot", error.code || error.name);
  }

  async function configure({ workspaceId, activityId, accessLinks }) {
    const hub = await eventHub.getHub(workspaceId);
    if ((slug && hub.slug !== slug) || (pilot && pilot.eventWorkspaceId !== hub.workspace_id)) {
      throw new EventHubError("LIVE_EVENT_NOT_ALLOWED", "LIVE no está habilitado para este evento", 404);
    }
    const activity = await eventHub.getActivity(activityId);
    if (activity.event_workspace_id !== hub.workspace_id) {
      throw new EventHubError("ACTIVITY_WORKSPACE_MISMATCH", "La actividad no pertenece a este evento", 403);
    }
    const deckId = activity.deck_id || activity.pending_deck_id;
    if (!deckId || !["SCHEDULED", "LIVE"].includes(activity.status)) {
      throw new EventHubError("EVENT_DECK_REQUIRED", "Selecciona un Deck para esta actividad antes de activar LIVE", 409);
    }
    if (pilot) {
      if (pilot.eventWorkspaceId === workspaceId && pilot.activityId === activityId && pilot.deckId === deckId) return pilot;
      throw new EventHubError("LIVE_ALREADY_CONFIGURED", "LIVE ya está vinculado a una actividad del piloto", 409);
    }
    if (!slug && activity.status !== "LIVE") {
      throw new EventHubError("LIVE_EVENT_NOT_STARTED", "Inicia la conferencia en Event Stage antes de preparar LIVE", 409);
    }

    const links = {};
    let sessionId;
    for (const role of ["speaker", "stage", "screen"]) {
      const access = await accessLinks.createAccessLinkForDeck({ deckId, role });
      sessionId ??= access.session_id;
      if (access.session_id !== sessionId) throw new Error("The deck changed while setting up LIVE");
      links[role] = access.access_token;
    }
    const config = { slug: hub.slug, origin, eventWorkspaceId: hub.workspace_id, activityId: activity.id, deckId, sessionId, links };
    const nextPilot = parse(config);
    if (!nextPilot) throw new Error("Invalid Event Hub LIVE pilot");
    await eventHub.grantStageOperatorAccess({ eventStageId: activity.event_stage_id, accessSecret: links.stage });
    const temporary = file + "." + randomUUID();
    try {
      await fs.promises.mkdir(dataDir, { recursive: true });
      await fs.promises.writeFile(temporary, JSON.stringify(config) + "\n", { flag: "wx", mode: 0o600 });
      await fs.promises.rename(temporary, file);
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
    pilot = nextPilot;
    return pilot;
  }

  return {
    available: hub => Boolean(hub && (!slug || hub.slug === slug) && (!pilot || hub.workspace_id === pilot.eventWorkspaceId)),
    origin,
    getPilot: () => pilot,
    async enroll(input) {
      if (pending) await pending.catch(() => {});
      if (pending) throw new EventHubError("LIVE_SETUP_PENDING", "LIVE se está configurando. Vuelve a intentarlo.", 409);
      pending = configure(input);
      try {
        return await pending;
      } finally {
        pending = null;
      }
    }
  };
}

function pilotRoleUrls(pilot) {
  return Object.fromEntries(Object.entries(pilot.links).map(([role, token]) => {
    const url = new URL(`/${role}/${token}`, pilot.origin);
    url.searchParams.set("eventActivityId", pilot.activityId);
    return [role, url.href];
  }));
}

module.exports = { createLiveCameraSetup, pilotRoleUrls };
