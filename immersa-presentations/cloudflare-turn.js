const TLS_URL = "turns:turn.cloudflare.com:443?transport=tcp";
const TURN_URLS = new Set([
  "turn:turn.cloudflare.com:3478?transport=udp",
  "turn:turn.cloudflare.com:443?transport=udp",
  "turn:turn.cloudflare.com:3478?transport=tcp",
  "turn:turn.cloudflare.com:80?transport=tcp",
  "turns:turn.cloudflare.com:5349?transport=tcp",
  TLS_URL
]);

function createCloudflareTurn({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const keyId = env.IMMERSA_CLOUDFLARE_TURN_KEY_ID?.trim();
  const apiToken = env.IMMERSA_CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!keyId && !apiToken) return null;
  const relayOnly = env.IMMERSA_LIVE_CAMERA_FORCE_RELAY === "true";
  const tlsOnly = env.IMMERSA_LIVE_CAMERA_TURN_TLS_ONLY === "true";

  return async (pilot = {}) => {
    try {
      if (!/^[a-f0-9]{32}$/i.test(keyId || "") || !apiToken) throw new Error();
      const response = await fetchImpl(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
          signal: AbortSignal.timeout(3000),
          redirect: "error"
        }
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      const iceServers = [];
      for (const server of body.iceServers || []) {
        const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
          .filter(url => TURN_URLS.has(url) && (!tlsOnly || url === TLS_URL));
        if (!urls.length || typeof server.username !== "string" || !server.username
          || typeof server.credential !== "string" || !server.credential) continue;
        iceServers.push({ urls, username: server.username, credential: server.credential });
      }
      if (!iceServers.some(server => server.urls.includes(TLS_URL))) throw new Error();
      return { iceServers, iceTransportPolicy: relayOnly || tlsOnly || pilot.forceRelay ? "relay" : "all" };
    } catch {
      // Keep keys, credentials and provider response bodies out of logs and socket errors.
      throw new Error("Cloudflare TURN credentials unavailable");
    }
  };
}

module.exports = { createCloudflareTurn };
