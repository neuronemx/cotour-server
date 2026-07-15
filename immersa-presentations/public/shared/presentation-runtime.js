(function (root) {
  let runtimeInstance = null;
  let bootstrapTimer = null;
  let bootstrapAttempts = 0;

  function roleFromPath(pathname, configuredRole) {
    const role = configuredRole === "speaker" ? "presenter" : String(configuredRole || "");
    if (["presenter", "stage", "screen", "viewer", "audience"].includes(role)) return role;
   