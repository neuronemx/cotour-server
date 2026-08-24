const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  EventHubRepository,
  EventHubError,
  canEnterActivity,
  registrationKeyHash
  ,secretHash
  ,pollOptions
} = require("../event-hub/repository");

function fakePool(results = []) {
  const calls = [];
  const queue = [...results];
  const connection = {
    async beginTransaction() { calls.push({ kind: "begin" }); },
    async commit() { calls.push({ kind: "commit" }); },
    async rollback() { calls.push({ kind: "rollback" }); },
    release() { calls.push({ kind: "release" }); },
    async execute(sql, values = []) { calls.push({ kind: "execute", sql, values }); return queue.shift() || [{ affectedRows: 1 }, []]; }
  };
  return {
    calls,
    async getConnection() { return connection; },
    async execute(sql, values = []) { calls.push({ kind: "execute", sql, values }); return queue.shift() || [{ affectedRows: 1 }, []]; }
  };
}

test("Paid participant enters Paid and Free activities; Free only enters Free", () => {
  assert.equal(canEnterActivity("FREE", "FREE"), true);
  assert.equal(canEnterActivity("FREE", "PAID"), false);
  assert.equal(canEnterActivity("PAID", "FREE"), true);
  assert.equal(canEnterActivity("PAID", "PAID"), true);
});

test("registration identity is persisted as a hash, not as public data", () => {
  assert.match(registrationKeyHash("private-event-registration"), /^[a-f0-9]{64}$/);
  assert.notEqual(registrationKeyHash("private-event-registration"), registrationKeyHash("other-registration"));
});

test("Event Hub polls have no artificial option limit and require distinct choices", () => {
  assert.equal(pollOptions(["Sí", "No", "Tal vez", "Después"]).length, 4);
  assert.throws(() => pollOptions(["Sí", "sí"]), /distintas/);
  assert.throws(() => pollOptions(["Solo una"]), /al menos dos/);
});

test("a public QR resolves its event and the only level it grants", async () => {
  const pool = fakePool([[[{
    public_id: "p_evt_paid", audience_level: "PAID", workspace_id: "hub-1", slug: "semana-amc", title: "Semana AMC", status: "DRAFT"
  }], []]]);
  const repository = new EventHubRepository(pool);
  const qr = await repository.getPublicQr("p_evt_paid");
  assert.equal(qr.audienceLevel, "PAID");
  assert.equal(qr.eventWorkspaceId, "hub-1");
});

test("temporary Event Stage access is checked by secret hash", async () => {
  const pool = fakePool([[[{ id: "stage-access-1", event_stage_id: "stage-ccc" }], []]]);
  const repository = new EventHubRepository(pool);
  const access = await repository.authorizeStageOperation({ eventStageId: "stage-ccc", accessSecret: "temporary-secret" });
  assert.equal(access.eventStageId, "stage-ccc");
  assert.match(secretHash("temporary-secret"), /^[a-f0-9]{64}$/);
});

test("Event Stage capacity is explicit configuration, never inferred from Speaker plan", async () => {
  const pool = fakePool([[{ affectedRows: 1 }, []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(await repository.setStageCapacity({ eventStageId: "stage-ccc", audienceCapacity: 600 }), { eventStageId: "stage-ccc", audienceCapacity: 600 });
  await assert.rejects(() => repository.setStageCapacity({ eventStageId: "stage-ccc", audienceCapacity: 0 }), /capacity/);
});

test("a live Event Stage capacity is returned for its Deck", async () => {
  const pool = fakePool([[[{ event_stage_id: "stage-ccc", audience_capacity: 600 }], []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(await repository.getLiveStageCapacityForDeck("deck-1"), { eventStageId: "stage-ccc", audienceCapacity: 600 });
});

test("a live Deck resolves the Event Hub that owns its brands", async () => {
  const pool = fakePool([[[{ event_workspace_id: "hub-1" }], []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(await repository.getLiveEventForDeck("deck-1"), { event_workspace_id: "hub-1" });
  assert.match(pool.calls[0].sql, /status = 'LIVE'/);
});

test("public event activity list hides Enter when a Free QR reaches a Paid live activity", async () => {
  const pool = fakePool([[[{
    id: "activity-paid", title: "Conferencia", access_level: "PAID", status: "LIVE", event_stage_id: "stage-ccc",
    stage_name: "CCC", live_session_id: "live-1", live_status: "LIVE"
  }], []], [[], []]]);
  const repository = new EventHubRepository(pool);
  const activities = await repository.listPublicActivities({ eventWorkspaceId: "hub-1", audienceLevel: "FREE" });
  assert.equal(activities[0].live, true);
  assert.equal(activities[0].canEnter, false);
});

test("creating a hub seeds the five official Semana AMC Stages and exactly two audience QR levels", async () => {
  const pool = fakePool([
    [[], []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []], [{ affectedRows: 1 }, []],
    [[{ workspace_id: "hub-1", slug: "semana-amc", title: "Semana AMC", timezone: "America/Mexico_City", status: "DRAFT" }], []],
    [[
      { id: "stage-ccc", name: "CCC Sala THX", sort_order: 0, active: 1 },
      { id: "stage-nela", name: "CHURUBUSCO Foro NELA", sort_order: 1, active: 1 },
      { id: "stage-a", name: "CHURUBUSCO Foro A", sort_order: 2, active: 1 },
      { id: "stage-foro", name: "CHURUBUSCO Foro 2", sort_order: 3, active: 1 },
      { id: "stage-lobby", name: "CHURUBUSCO Lobby", sort_order: 4, active: 1 }
    ], []],
    [[{ public_id: "p_evt_free", audience_level: "FREE", active: 1 }, { public_id: "p_evt_paid", audience_level: "PAID", active: 1 }], []]
  ]);
  const ids = ["hub-1", "stage-ccc", "stage-nela", "stage-a", "stage-foro", "stage-lobby", "qr-free", "qr-paid", "qr-free-public", "qr-paid-public"];
  const repository = new EventHubRepository(pool, { createId: () => ids.shift() });
  const hub = await repository.createHub({ slug: "semana-amc", title: "Semana AMC", createdByUserId: "admin-1" });
  assert.deepEqual(hub.stages.map((stage) => stage.name), ["CCC Sala THX", "CHURUBUSCO Foro NELA", "CHURUBUSCO Foro A", "CHURUBUSCO Foro 2", "CHURUBUSCO Lobby"]);
  assert.deepEqual(hub.publicQrs.map((qr) => qr.audience_level), ["FREE", "PAID"]);
  const statements = pool.calls.filter((call) => call.kind === "execute").map((call) => call.sql).join("\n");
  assert.match(statements, /INSERT INTO workspaces .*'event'/);
  assert.match(statements, /audience_capacity\) VALUES \(\?, \?, \?, \?, 300\)/);
  assert.match(statements, /INSERT INTO event_public_qrs/);
});

test("creating a hub rejects an identifier already in use", async () => {
  const pool = fakePool([[[{ workspace_id: "hub-1" }], []]]);
  const repository = new EventHubRepository(pool);
  await assert.rejects(
    () => repository.createHub({ slug: "semana-amc", title: "Semana AMC", createdByUserId: "admin-1" }),
    (error) => error instanceof EventHubError && error.code === "EVENT_HUB_SLUG_EXISTS"
  );
});

test("Event Admin can list Event Hubs to reopen one in another browser", async () => {
  const pool = fakePool([[[{ workspace_id: "hub-1", slug: "semana-amc", title: "Semana AMC", status: "DRAFT" }], []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(await repository.listHubs(), [{ workspace_id: "hub-1", slug: "semana-amc", title: "Semana AMC", status: "DRAFT" }]);
});

test("only a scheduled activity can be edited", async () => {
  const pool = fakePool([[[{ id: "activity-1", event_workspace_id: "hub-1", event_stage_id: "stage-1", status: "LIVE" }], []]]);
  const repository = new EventHubRepository(pool);
  await assert.rejects(
    () => repository.updateActivity({ activityId: "activity-1", eventWorkspaceId: "hub-1", eventStageId: "stage-1", title: "Cambio", durationMinutes: 60 }),
    (error) => error instanceof EventHubError && error.code === "ACTIVITY_NOT_EDITABLE"
  );
});

test("a Stage cannot start a second LiveSession at the same time", async () => {
  const pool = fakePool([
    [[{ id: "activity-1", event_workspace_id: "hub-1", event_stage_id: "stage-1", title: "Conferencia", access_level: "PAID", deck_id: "deck-1", status: "SCHEDULED", stage_name: "CCC" }], []],
    [[{ id: "live-1" }], []]
  ]);
  const repository = new EventHubRepository(pool);
  await assert.rejects(() => repository.startLiveSession({ eventActivityId: "activity-1" }), (error) => error instanceof EventHubError && error.code === "STAGE_ALREADY_LIVE");
});

test("a LiveSession identifies its Event Stage before an operator can finish it", async () => {
  const pool = fakePool([[[{ id: "live-1", event_workspace_id: "hub-1", event_activity_id: "activity-1", event_stage_id: "stage-ccc", deck_id: "deck-1", status: "LIVE" }], []]]);
  const repository = new EventHubRepository(pool);
  const live = await repository.getLiveSession("live-1");
  assert.equal(live.event_stage_id, "stage-ccc");
});

test("finishing a LiveSession preserves it for metrics and makes its Activity operable again", async () => {
  const pool = fakePool([
    [[{ id: "live-1", event_activity_id: "activity-1" }], []],
    [{ affectedRows: 1 }, []],
    [{ affectedRows: 1 }, []]
  ]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(await repository.finishLiveSession("live-1"), { id: "live-1", status: "FINISHED" });
  const statements = pool.calls.filter((call) => call.kind === "execute").map((call) => call.sql).join("\n");
  assert.match(statements, /event_live_sessions SET status = 'FINISHED'/);
  assert.match(statements, /event_activities SET status = 'SCHEDULED'/);
});

test("Event Stage resolves only its scheduled or live activity from the approved Deck", async () => {
  const pool = fakePool([[[{
    activity_id: "activity-1", activity_title: "Conferencia", event_stage_id: "stage-ccc", stage_name: "CCC Sala THX", activity_status: "SCHEDULED", deck_check_status: "DECK_CHECK", live_session_id: null
  }], []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(await repository.getStageControlForDeck("deck-1"), {
    activityId: "activity-1", title: "Conferencia", stageId: "stage-ccc", stageName: "CCC Sala THX", status: "SCHEDULED", deckCheckStatus: "DECK_CHECK", liveSessionId: null
  });
});

test("Event Stage uses its access token when loading Event Hub controls", async () => {
  const stage = await fs.promises.readFile(path.join(__dirname, "..", "public", "stage", "stage.js"), "utf8");
  assert.match(stage, /\/api\/event\/stage-control\//);
  assert.match(stage, /"x-immersa-access-token": roleOpenContext\.access_token/);
});

test("Event Stage has one conference action and keeps Deck rehearsal separate", async () => {
  const stage = await fs.promises.readFile(path.join(__dirname, "..", "public", "stage", "stage.js"), "utf8");
  const server = await fs.promises.readFile(path.join(__dirname, "..", "server.js"), "utf8");
  const lifecycle = await fs.promises.readFile(path.join(__dirname, "..", "presentation-lifecycle.js"), "utf8");
  assert.match(stage, /Iniciar conferencia/);
  assert.match(stage, /Finalizar conferencia/);
  assert.match(stage, /Probar Deck/);
  assert.match(stage, /conference\/\$\{live \? "finish" : "start"\}/);
  assert.match(server, /stage-control\/:deckId\/conference\/:action/);
  assert.match(server, /presentationLifecycleRuntime\.start\(lifecycleContext\)/);
  assert.match(server, /presentationLifecycleRuntime\.finish\(lifecycleContext\)/);
  assert.match(lifecycle, /return \{ attach, start, finish, sendCurrentState/);
});

test("Event Hub migration keeps Base, Event Hub and LiveSession in separate tables", async () => {
  const migration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "020_event_hub_foundation.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_hubs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_stages/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_activities/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_live_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_participants/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_live_attendance/);
  const durationMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "023_event_activity_duration.sql"), "utf8");
  assert.match(durationMigration, /duration_minutes/);
  const typeMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "024_event_activity_type.sql"), "utf8");
  assert.match(typeMigration, /activity_type/);
  const speakersMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "025_event_activity_speakers.sql"), "utf8");
  assert.match(speakersMigration, /event_activity_speakers/);
  const deckCheckMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "026_event_activity_deck_check.sql"), "utf8");
  assert.match(deckCheckMigration, /deck_check_status/);
  const assignmentsMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "027_event_speaker_assignments.sql"), "utf8");
  assert.match(assignmentsMigration, /event_activity_speaker_assignments/);
  const linkingMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "028_event_speaker_linking.sql"), "utf8");
  assert.match(linkingMigration, /status = 'LINKED'/);
  const orphanCleanupMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "029_remove_orphaned_event_speaker_assignments.sql"), "utf8");
  assert.match(orphanCleanupMigration, /DELETE asa/);
  const defaultCapacityMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "030_event_stage_default_capacity.sql"), "utf8");
  assert.match(defaultCapacityMigration, /audience_capacity = 300/);
  const officialStagesMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "031_semana_amc_official_stages.sql"), "utf8");
  assert.match(officialStagesMigration, /CHURUBUSCO Foro NELA/);
  const reopenActivitiesMigration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "032_event_activity_reopen_after_live_session.sql"), "utf8");
  assert.match(reopenActivitiesMigration, /SET status = 'SCHEDULED'/);
});

test("a speaker can accept only their own Event Hub invitation", async () => {
  const pool = fakePool([[{ affectedRows: 1 }, []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(
    await repository.acceptSpeakerInvitation({ assignmentId: "invite-1", userId: "speaker-1" }),
    { assignmentId: "invite-1", status: "LINKED" }
  );
  assert.match(pool.calls[0].sql, /es\.account_user_id = \?/);
});

test("a linked Speaker can open their assigned Event Hub Deck without waiting for Deck Check", async () => {
  const pool = fakePool([[[{ id: "invite-1", activity_id: "activity-1", deck_id: null, pending_deck_id: "deck-1", deck_check_status: "READY_FOR_TEST" }], []]]);
  const repository = new EventHubRepository(pool);
  assert.deepEqual(
    await repository.getSpeakerPresentationAccess({ assignmentId: "invite-1", userId: "speaker-1" }),
    { assignmentId: "invite-1", activityId: "activity-1", deckId: "deck-1", deckCheckStatus: "READY_FOR_TEST" }
  );
  const statements = pool.calls.filter((call) => call.kind === "execute").map((call) => call.sql).join("\n");
  assert.match(statements, /es\.account_user_id = \?/);
  assert.match(statements, /asa\.status = 'LINKED'/);
});

test("Speaker invitation cards open the assigned Deck without exposing Event Stage access", async () => {
  const invitations = await fs.promises.readFile(path.join(__dirname, "..", "public", "home", "event-invitations.js"), "utf8");
  const server = await fs.promises.readFile(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(invitations, /Abrir como Speaker/);
  assert.match(invitations, /speaker-access/);
  assert.match(server, /speaker-invitations\/:assignmentId\/speaker-access/);
  assert.match(server, /createAccessLinkForDeck\(\{ deckId: access\.deckId, role: "speaker" \}\)/);
});

test("Event Stage can operate an assigned pending Deck and clearly marks no Deck Check", async () => {
  const repository = await fs.promises.readFile(path.join(__dirname, "..", "event-hub", "repository.js"), "utf8");
  const stage = await fs.promises.readFile(path.join(__dirname, "..", "public", "stage", "stage.js"), "utf8");
  const admin = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.js"), "utf8");
  assert.match(repository, /COALESCE\(a\.deck_id, a\.pending_deck_id\) = \?/);
  assert.match(repository, /const deckId = activity\.deck_id \|\| activity\.pending_deck_id/);
  assert.match(stage, /sin Deck Check/);
  assert.match(admin, /Abrir Event Stage sin Deck Check/);
});

test("public Event Hub defaults Free visitors to Exposición and Paid visitors to Programa", async () => {
  const page = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "index.html"), "utf8");
  const script = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "event.js"), "utf8");
  assert.match(page, /Feria de expositores/);
  assert.match(page, /https:\/\/semanaamc\.expofp\.com\//);
  assert.match(script, /event\.audienceLevel === "PAID" \? "program" : "exposition"/);
  assert.match(script, /tab\.classList\.add\("is-activating"\)/);
  assert.match(script, /En vivo para acceso preferente/);
  assert.match(script, /setInterval\(\(\) => \{ refreshActivities\(\)\.catch\(\(\) => \{\}\); \}, 5000\)/);
  assert.match(page, /Mostrando actividades en vivo/);
  assert.match(script, /immersa:event-live-return/);
});

test("Event Admin owns one brand configuration that is visible in both public views", async () => {
  const server = await fs.promises.readFile(path.join(__dirname, "..", "server.js"), "utf8");
  const page = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "index.html"), "utf8");
  const script = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "event.js"), "utf8");
  const styles = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "event-brands.css"), "utf8");
  const admin = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.js"), "utf8");
  const runtime = await fs.promises.readFile(path.join(__dirname, "..", "brand-mention-runtime.js"), "utf8");
  assert.match(server, /api\/admin\/event-hubs\/:workspaceId\/brand-mentions/);
  assert.match(server, /api\/event\/public\/:publicId\/brand-mentions/);
  assert.match(page, /Con el apoyo de/);
  assert.match(page, /event-brands\.css\?v=8/);
  assert.match(page, /<\/main>\s*<section id="event-brands"/);
  assert.match(styles, /\.event-brands\{position:fixed/);
  assert.match(styles, /bottom:0/);
  assert.match(styles, /width:54px;height:54px/);
  assert.match(script, /matchLogoSurface\(logo, link\)/);
  assert.match(script, /refreshBrands/);
  assert.match(script, /eventBrands\.hidden = brands\.length === 0/);
  assert.match(admin, /eventBrands/);
  assert.match(runtime, /brandSourceId/);
});

test("Event Admin polls run in the public Program and exclude LiveSession attendees", async () => {
  const server = await fs.promises.readFile(path.join(__dirname, "..", "server.js"), "utf8");
  const repository = await fs.promises.readFile(path.join(__dirname, "..", "event-hub", "repository.js"), "utf8");
  const migration = await fs.promises.readFile(path.join(__dirname, "..", "db", "migrations", "033_event_hub_polls.sql"), "utf8");
  const admin = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.js"), "utf8");
  const stage = await fs.promises.readFile(path.join(__dirname, "..", "public", "stage", "stage.js"), "utf8");
  const publicProgram = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "event.js"), "utf8");
  const runtime = await fs.promises.readFile(path.join(__dirname, "..", "event-hub", "admin-interactions.js"), "utf8");
  assert.match(server, /api\/admin\/event-hubs\/:workspaceId\/polls/);
  assert.match(server, /polls\/:pollId\/launch/);
  assert.match(server, /polls\/close/);
  assert.match(server, /polls\/interaction/);
  assert.match(server, /event-hubs\/:workspaceId\/overview/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS event_hub_polls/);
  assert.match(repository, /listEventPolls/);
  assert.match(repository, /isParticipantInLiveSession/);
  assert.match(repository, /getAdminOverview/);
  assert.match(admin, /polls\/\$\{encodeURIComponent\(poll\.id\)\}\/launch/);
  assert.match(admin, /Cerrar interacción/);
  assert.match(admin, /responsesTotal/);
  assert.match(admin, /loadEventOverview/);
  assert.match(admin, /overviewEngagement/);
  assert.match(publicProgram, /event-admin:join/);
  assert.match(publicProgram, /event-admin:interaction:state/);
  assert.match(publicProgram, /adminThankYou/);
  assert.match(publicProgram, /Ayúdanos a mejorar para la siguiente edición de/);
  assert.match(publicProgram, /3000/);
  assert.match(publicProgram, /aria-modal="true"/);
  assert.match(runtime, /event-hub:\$\{workspaceId\}:program/);
  assert.match(runtime, /isParticipantInLiveSession/);
  assert.match(runtime, /event-admin:interaction:submit/);
  assert.match(runtime, /responsesTotal/);
  assert.doesNotMatch(stage, /stage-control\/\$\{encodeURIComponent\(deckId\)\}\/polls/);
});

test("an Event Hub attendee can return to the public Program when their LiveSession closes", async () => {
  const audience = await fs.promises.readFile(path.join(__dirname, "..", "public", "audience", "audience.js"), "utf8");
  const server = await fs.promises.readFile(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(audience, /returnToEventProgramIfClosed/);
  assert.match(audience, /\^\\\/p_\[a-z0-9_\]\+\$/);
  assert.match(audience, /setInterval\(returnToEventProgramIfClosed, 3000\)/);
  assert.match(audience, /\/api\/event\/live-sessions\/\$\{encodeURIComponent\(state\.liveSessionId\)\}\/status/);
  assert.match(server, /isParticipantLiveSessionActive/);
});

test("Event Admin activity cards expose one focused shell per action", async () => {
  const script = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.js"), "utf8");
  const styles = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.css"), "utf8");
  assert.match(script, /data-tool='edit'/);
  assert.match(script, /Invitación aceptada/);
  assert.match(script, /action-deck-approved/);
  assert.match(script, /item\.after\(activityEditor\)/);
  assert.match(styles, /\*\[hidden\]\{display:none!important\}/);
});

test("Proyección is a first-class Event Hub activity type", async () => {
  const repository = await fs.promises.readFile(path.join(__dirname, "..", "event-hub", "repository.js"), "utf8");
  const admin = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.js"), "utf8");
  const page = await fs.promises.readFile(path.join(__dirname, "..", "public", "admin", "event-hub.html"), "utf8");
  const publicProgram = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "event.js"), "utf8");
  const styles = await fs.promises.readFile(path.join(__dirname, "..", "public", "event", "event.css"), "utf8");
  assert.match(repository, /"PROJECTION"/);
  assert.match(admin, /PROJECTION: "Proyección"/);
  assert.match(page, /value="PROJECTION">Proyección/);
  assert.match(publicProgram, /PROJECTION: "Proyección"/);
  assert.match(styles, /\.type-PROJECTION/);
});
