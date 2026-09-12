function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function logoRecord(logo) {
  if (!logo || typeof logo !== "object") return {};
  return {
    file_name: String(logo.file_name || ""),
    mime_type: String(logo.mime_type || ""),
    size_bytes: Math.max(0, Number(logo.size_bytes) || 0),
    width: Math.max(0, Number(logo.width) || 0),
    height: Math.max(0, Number(logo.height) || 0)
  };
}

function createSnapshot({ eventHub, stages = [], activities = [], publicQrs = [], brands = [] }) {
  const normalizedStages = stages.map((stage) => ({ id: required(stage?.id, "stage.id"), name: required(stage?.name, "stage.name"), capacity: Number(stage?.capacity || stage?.audience_capacity || 0) }));
  const stageIds = new Set(normalizedStages.map((stage) => stage.id));
  const normalizedActivities = activities.map((activity) => {
    const stageId = required(activity?.stageId || activity?.event_stage_id, "activity.stageId");
    if (!stageIds.has(stageId)) throw new Error(`Unknown Event Stage: ${stageId}`);
    return {
      id: required(activity?.id, "activity.id"), stageId,
      title: required(activity?.title, "activity.title"),
      deckId: String(activity?.deckId || activity?.deck_id || "").trim(),
      startsAt: String(activity?.startsAt || activity?.scheduled_starts_at || ""),
      durationMinutes: Number(activity?.durationMinutes || activity?.duration_minutes || 0),
      accessLevel: String(activity?.accessLevel || activity?.access_level || "FREE").toUpperCase(),
      activityType: String(activity?.activityType || activity?.activity_type || "CONFERENCE").toUpperCase(),
      status: String(activity?.status || "SCHEDULED").toUpperCase()
    };
  });
  return {
    eventHub: { workspaceId: required(eventHub?.workspaceId, "eventHub.workspaceId"), slug: required(eventHub?.slug, "eventHub.slug"), title: required(eventHub?.title, "eventHub.title") },
    stages: normalizedStages,
    activities: normalizedActivities,
    publicQrs: publicQrs.map((qr) => ({
      publicId: required(qr?.publicId || qr?.public_id, "publicQr.publicId"),
      audienceLevel: String(qr?.audienceLevel || qr?.audience_level || "FREE").toUpperCase(),
      active: qr?.active !== false
    })),
    brands: brands.map((brand) => ({
      id: required(brand?.id, "brand.id"),
      name: required(brand?.name, "brand.name"),
      pitch: String(brand?.pitch || ""),
      targetUrl: String(brand?.targetUrl || brand?.target_url || ""),
      active: brand?.active !== false,
      logo: logoRecord(brand?.logo)
    }))
  };
}

module.exports = { createSnapshot };
