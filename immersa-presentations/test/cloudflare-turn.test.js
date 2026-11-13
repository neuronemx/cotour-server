const test = require("node:test");
const assert = require("node:assert/strict");
const { createCloudflareTurn } = require("../cloudflare-turn");

const env = {
  IMMERSA_CLOUDFLARE_TURN_KEY_ID: "0".repeat(32),
  IMMERSA_CLOUDFLARE_TURN_API_TOKEN: "private-api-token"
};
const tls = "turns:turn.cloudflare.com:443?transport=tcp";
const udp = "turn:turn.cloudflare.com:3478?transport=udp";
const result = () => ({
  ok: true,
  json: async () => ({ iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: [udp, tls, "turn:turn.cloudflare.com:53?transport=udp"], username: "temporary-user", credential: "temporary-password" }
  ] })
});

test("Cloudflare issues fresh temporary credentials and keeps the API key server-side", async () => {
  let calls = 0;
  const configure = createCloudflareTurn({ env, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, `https://rtc.live.cloudflare.com/v1/turn/keys/${env.IMMERSA_CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`);
    assert.equal(options.headers.Authorization, `Bearer ${env.IMMERSA_CLOUDFLARE_TURN_API_TOKEN}`);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { ttl: 86400 });
    assert.ok(options.signal instanceof AbortSignal);
    return result();
  } });
  const rtc = await configure();
  assert.deepEqual(rtc, {
    iceServers: [{ urls: [udp, tls], username: "temporary-user", credential: "temporary-password" }],
    iceTransportPolicy: "all"
  });
  assert.equal(JSON.stringify(rtc).includes(env.IMMERSA_CLOUDFLARE_TURN_API_TOKEN), false);
  assert.equal((await configure({ forceRelay: true })).iceTransportPolicy, "relay");
  assert.equal(calls, 2);
});

test("TURN validation can force TLS/443 exclusively", async () => {
  const configure = createCloudflareTurn({
    env: { ...env, IMMERSA_LIVE_CAMERA_TURN_TLS_ONLY: "true" }, fetchImpl: async () => result()
  });
  assert.deepEqual(await configure(), {
    iceServers: [{ urls: [tls], username: "temporary-user", credential: "temporary-password" }],
    iceTransportPolicy: "relay"
  });
});

test("missing, partial, rejected and malformed Cloudflare credentials fail without leaking provider data", async () => {
  assert.equal(createCloudflareTurn({ env: {} }), null);
  for (const [settings, fetchImpl] of [
    [{ IMMERSA_CLOUDFLARE_TURN_KEY_ID: env.IMMERSA_CLOUDFLARE_TURN_KEY_ID }, async () => { throw new Error("should not call"); }],
    [env, async () => ({ ok: false, status: 401 })],
    [env, async () => { throw new Error(env.IMMERSA_CLOUDFLARE_TURN_API_TOKEN); }],
    [env, async () => ({ ok: true, json: async () => ({ iceServers: [] }) })],
    [env, async () => ({ ok: true, json: async () => ({ iceServers: [{ urls: [tls] }] }) })]
  ]) {
    await assert.rejects(createCloudflareTurn({ env: settings, fetchImpl })(), { message: "Cloudflare TURN credentials unavailable" });
  }
});
