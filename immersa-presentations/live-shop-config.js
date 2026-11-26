function liveShopEnabled(env = process.env) {
  return Boolean(env.IMMERSA_LIVE_SHOP_ENVIRONMENT_ID)
    && env.IMMERSA_LIVE_SHOP_ENVIRONMENT_ID === env.RAILWAY_ENVIRONMENT_ID;
}

function liveShopTester(user, env = process.env) {
  const email = String(user?.email || "").trim().toLowerCase();
  const allowed = String(env.IMMERSA_LIVE_SHOP_TEST_EMAILS || "").toLowerCase().split(/[,;\s]+/);
  return liveShopEnabled(env) && Boolean(user?.id && email) && allowed.includes(email);
}

module.exports = { liveShopEnabled, liveShopTester };
