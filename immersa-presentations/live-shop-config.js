const BETA_ENVIRONMENT_ID = "9ae7d5ba-2954-4c96-818a-ee918310e20d";

function liveShopDemoEnabled(env = process.env) {
  return env.RAILWAY_ENVIRONMENT_ID !== BETA_ENVIRONMENT_ID
    && Boolean(env.IMMERSA_LIVE_SHOP_ENVIRONMENT_ID)
    && env.IMMERSA_LIVE_SHOP_ENVIRONMENT_ID === env.RAILWAY_ENVIRONMENT_ID;
}

function liveShopEnabled(env = process.env) {
  return liveShopDemoEnabled(env)
    || (env.RAILWAY_ENVIRONMENT_ID === BETA_ENVIRONMENT_ID && env.IMMERSA_LIVE_SHOP_BETA_ENABLED === "true");
}

function liveShopTester(user, env = process.env) {
  const email = String(user?.email || "").trim().toLowerCase();
  const allowed = String(env.IMMERSA_LIVE_SHOP_TEST_EMAILS || "").toLowerCase().split(/[,;\s]+/);
  return liveShopEnabled(env) && Boolean(user?.id && email) && allowed.includes(email);
}

module.exports = { liveShopDemoEnabled, liveShopEnabled, liveShopTester };
