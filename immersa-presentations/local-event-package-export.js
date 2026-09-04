const { createSnapshot } = require("./local-event-hub-snapshot");

async function readEventHubForLocalExport({ repository, eventWorkspaceId, listBrands = async () => [] }) {
  if (!repository?.getHub || !repository?.listActivities) throw new Error("Event Hub repository is required");
  const hub = await repository.getHub(eventWorkspaceId);
  const activities = await repository.listActivities(eventWorkspaceId);
  const brands = await listBrands(eventWorkspaceId);
  return createSnapshot({
    eventHub: { workspaceId: hub.workspace_id || hub.workspaceId, slug: hub.slug, title: hub.title },
    stages: hub.stages,
    activities,
    publicQrs: hub.publicQrs,
    brands
  });
}

module.exports = { readEventHubForLocalExport };
