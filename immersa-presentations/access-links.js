const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN_PATTERN = /^a_[a-z0-9]{10}$/;
const PUBLIC_ID_PATTERN = /^p_[a-z0-9]+$/;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const VALID_ROLES = new Set(['speaker', 'stage', 'audience', 'screen', 'viewer']);
const ROLE_ACCESS_COOKIE = 'immersa_role_access';
const ROLE_ACCESS_TTL_SECONDS = 120;
const ROLE_GUARD_SECRET = process.env.IMMERSA_ROUTE_GUARD_SECRET || process.env.SESSION_SECRET || process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');

function randomTokenSuffix(length) {
  const bytes = crypto.randomBytes(length);
  let suffix = '';
  for (const byte of bytes) suffix += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return suffix;
}

function generateAccessToken() {
  return 'a_' + randomTokenSuffix(10);
}

function generatePublicId() {
  return 'p_' + randomTokenSuffix(8);
}

function isValidRole(role) {
  return VALID_ROLES.has(String(role || '').trim());
}

function normalizeAccessLinkStore(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.access_links)) return data.access_links;
  return [];
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

async function loadAccessLinks(storePath) {
  return normalizeAccessLinkStore(await readJsonFile(storePath, []));
}

async function saveAccessLinks(storePath, accessLinks) {
  await writeJsonFile(storePath, accessLinks);
}

function publicDeckFromManifest(manifest, entryName) {
  const deckId = manifest.deckId || entryName;
  return {
    deckId,
    title: manifest.title || entryName,
    session_id: manifest.session_id,
    ratio: manifest.ratio || '16:9',
    status: manifest.status || 'ready',
    conversionStatus: manifest.conversion?.status || 'ready'
  };
}

async function findDeckManifestBySessionId(sessionId, deckDirs) {
  for (const rootDir of deckDirs) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(rootDir, entry.name, 'manifest.json');
      try {
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        if (manifest.session_id !== sessionId) continue;
        return { manifest, deck: publicDeckFromManifest(manifest, entry.name) };
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('Skipping deck manifest', manifestPath, error.message);
      }
    }
  }

  return null;
}

async function findDeckBySessionId(sessionId, deckDirs) {
  const result = await findDeckManifestBySessionId(sessionId, deckDirs);
  return result?.deck || null;
}

function publicAccessLink(accessLink, deck = null) {
  return {
    access_token: accessLink.access_token,
    public_id: accessLink.public_id,
    session_id: accessLink.session_id,
    role: accessLink.role,
    created_at: accessLink.created_at,
    active: accessLink.active,
    deck
  };
}

function presentationOpenResponse(accessLink, manifest, deck) {
  const slides = Array.isArray(manifest.slides) ? manifest.slides : [];
  const status = manifest.status || 'ready';
  const conversionStatus = manifest.conversion?.status || 'ready';
  const realSlideCount = (status === 'converted' && conversionStatus === 'completed') || (status === 'ready' && conversionStatus === 'ready');
  const manifestUrl = '/decks/' + encodeURIComponent(deck.deckId) + '/manifest.json';

  return {
    access_token: accessLink.access_token,
    public_id: accessLink.public_id,
    session_id: accessLink.session_id,
    role: accessLink.role,
    active: accessLink.active,
    deckId: deck.deckId,
    title: deck.title,
    ratio: manifest.ratio || '16:9',
    status,
    conversionStatus,
    conversionMessage: manifest.conversion?.message || '',
    slides,
    slideCount: realSlideCount ? slides.length : null,
    placeholderSlides: realSlideCount ? 0 : slides.length,
    manifestUrl,
    manifest: {
      deckId: deck.deckId,
      title: deck.title,
      session_id: accessLink.session_id,
      ratio: manifest.ratio || '16:9',
      status,
      source: manifest.source,
      slides,
      conversion: manifest.conversion,
      url: manifestUrl
    },
    deck
  };
}

function roleRedirectUrl(route, accessLink, deck) {
  const params = new URLSearchParams({
    session: accessLink.session_id,
    deck: deck.deckId
  });
  return '/' + route + '/?' + params.toString();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signRoleAccessPayload(payload) {
  return crypto.createHmac('sha256', ROLE_GUARD_SECRET).update(payload).digest('base64url');
}

function createRoleAccessValue({ accessLink, deck, route }) {
  const payload = JSON.stringify({
    access_token: accessLink.access_token,
    session_id: accessLink.session_id,
    deckId: deck.deckId,
    role: accessLink.role,
    route,
    exp: Date.now() + ROLE_ACCESS_TTL_SECONDS * 1000
  });
  const encodedPayload = base64UrlEncode(payload);
  return encodedPayload + '.' + signRoleAccessPayload(encodedPayload);
}

function parseCookies(cookieHeader) {
  const cookies = new Map();
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseRoleAccessCookie(cookieHeader) {
  const cookieValue = parseCookies(cookieHeader).get(ROLE_ACCESS_COOKIE);
  if (!cookieValue) return null;

  const [encodedPayload, signature] = cookieValue.split('.');
  if (!encodedPayload || !signature) return null;
  if (!timingSafeEqualString(signature, signRoleAccessPayload(encodedPayload))) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function serializeCookie(name, value, req) {
  const parts = [
    name + '=' + encodeURIComponent(value),
    'Max-Age=' + ROLE_ACCESS_TTL_SECONDS,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') parts.push('Secure');
  return parts.join('; ');
}

function injectPublicAudienceContext(html, accessLink, deck) {
  const context = JSON.stringify({
    session: accessLink.session_id,
    deck: deck.deckId
  }).replace(/</g, '\\u003c');
  const script = '<script>window.IMMERSA_PUBLIC_OPEN = ' + context + ';</script>';
  if (html.includes('</head>')) return html.replace('</head>', '  ' + script + '\n</head>');
  return script + '\n' + html;
}

function createAccessLinkHandlers({ dataDir, staticDecksDir, dataDecksDir, publicDir }) {
  const storePath = path.join(dataDir, 'access-links.json');
  const deckDirs = [dataDecksDir, staticDecksDir];
  const audienceIndexPath = publicDir ? path.join(publicDir, 'audience', 'index.html') : null;

  async function findActiveAccessLink(accessToken) {
    if (!ACCESS_TOKEN_PATTERN.test(accessToken)) return { status: 404, error: 'Access link not found' };

    const accessLinks = await loadAccessLinks(storePath);
    const accessLink = accessLinks.find((link) => link.access_token === accessToken);
    if (!accessLink) return { status: 404, error: 'Access link not found' };
    if (accessLink.active === false) return { status: 403, error: 'Access link inactive' };
    return { accessLink };
  }

  async function findActivePublicAudienceLink(publicId) {
    if (!PUBLIC_ID_PATTERN.test(publicId)) return { status: 404, error: 'Public link not found' };

    const accessLinks = await loadAccessLinks(storePath);
    const accessLink = accessLinks.find((link) => link.public_id === publicId);
    if (!accessLink) return { status: 404, error: 'Public link not found' };
    if (!ACCESS_TOKEN_PATTERN.test(String(accessLink.access_token || ''))) return { status: 404, error: 'Public link not found' };
    if (accessLink.role !== 'audience') return { status: 403, error: 'Public link role is not allowed' };
    if (accessLink.active === false) return { status: 403, error: 'Public link inactive' };
    return { accessLink };
  }

  async function createAccessLink(req, res) {
    const sessionId = String(req.body?.session_id || '').trim();
    const role = String(req.body?.role || '').trim();

    if (!sessionId) return res.status(400).json({ error: 'session_id is required' });
    if (!isValidRole(role)) return res.status(400).json({ error: 'Invalid role' });

    try {
      const deck = await findDeckBySessionId(sessionId, deckDirs);
      if (!deck) return res.status(404).json({ error: 'Presentation not found' });

      const accessLinks = await loadAccessLinks(storePath);
      const usedTokens = new Set(accessLinks.map((link) => link.access_token).filter(Boolean));
      const usedPublicIds = new Set(accessLinks.map((link) => link.public_id).filter(Boolean));
      let accessToken = generateAccessToken();
      while (usedTokens.has(accessToken)) accessToken = generateAccessToken();

      const accessLink = {
        access_token: accessToken,
        session_id: sessionId,
        role,
        created_at: new Date().toISOString(),
        active: true
      };

      if (role === 'audience') {
        let publicId = generatePublicId();
        while (usedPublicIds.has(publicId)) publicId = generatePublicId();
        accessLink.public_id = publicId;
      }

      accessLinks.push(accessLink);
      await saveAccessLinks(storePath, accessLinks);
      return res.status(201).json(publicAccessLink(accessLink, deck));
    } catch (error) {
      console.error('Unable to create access link', error);
      return res.status(500).json({ error: 'Unable to create access link' });
    }
  }

  async function resolveAccessLink(req, res) {
    const accessToken = String(req.params.access_token || '').trim();

    try {
      const result = await findActiveAccessLink(accessToken);
      if (result.error) return res.status(result.status).json({ error: result.error });

      const deck = await findDeckBySessionId(result.accessLink.session_id, deckDirs);
      return res.json(publicAccessLink(result.accessLink, deck));
    } catch (error) {
      console.error('Unable to resolve access link', error);
      return res.status(500).json({ error: 'Unable to resolve access link' });
    }
  }

  async function openPresentation(req, res) {
    const accessToken = String(req.params.access_token || '').trim();

    try {
      const result = await findActiveAccessLink(accessToken);
      if (result.error) return res.status(result.status).json({ error: result.error });

      const deckResult = await findDeckManifestBySessionId(result.accessLink.session_id, deckDirs);
      if (!deckResult) return res.status(404).json({ error: 'Presentation not found' });

      return res.json(presentationOpenResponse(result.accessLink, deckResult.manifest, deckResult.deck));
    } catch (error) {
      console.error('Unable to open presentation', error);
      return res.status(500).json({ error: 'Unable to open presentation' });
    }
  }

  function openRole(requiredRole, route) {
    return async (req, res, next) => {
      const accessToken = String(req.params.access_token || '').trim();
      if (!ACCESS_TOKEN_PATTERN.test(accessToken)) return next();

      try {
        const result = await findActiveAccessLink(accessToken);
        if (result.error) return res.status(result.status).json({ error: result.error });
        if (result.accessLink.role !== requiredRole) return res.status(403).json({ error: 'Role not allowed for this experience' });

        const deck = await findDeckBySessionId(result.accessLink.session_id, deckDirs);
        if (!deck) return res.status(404).json({ error: 'Presentation not found' });

        res.setHeader('Set-Cookie', serializeCookie(ROLE_ACCESS_COOKIE, createRoleAccessValue({ accessLink: result.accessLink, deck, route }), req));
        return res.redirect(302, roleRedirectUrl(route, result.accessLink, deck));
      } catch (error) {
        console.error('Unable to open role experience', error);
        return res.status(500).json({ error: 'Unable to open role experience' });
      }
    };
  }

  async function openPublicAudience(req, res, next) {
    const publicId = String(req.params.public_id || '').trim();
    if (!PUBLIC_ID_PATTERN.test(publicId)) return next();

    try {
      const result = await findActivePublicAudienceLink(publicId);
      if (result.error) return res.status(result.status).json({ error: result.error });

      const deck = await findDeckBySessionId(result.accessLink.session_id, deckDirs);
      if (!deck) return res.status(404).json({ error: 'Presentation not found' });
      if (!audienceIndexPath) return res.status(500).json({ error: 'Audience experience is not configured' });

      const html = await fs.promises.readFile(audienceIndexPath, 'utf8');
      res.setHeader('Set-Cookie', serializeCookie(ROLE_ACCESS_COOKIE, createRoleAccessValue({ accessLink: result.accessLink, deck, route: 'audience' }), req));
      return res.type('html').send(injectPublicAudienceContext(html, result.accessLink, deck));
    } catch (error) {
      console.error('Unable to open public audience link', error);
      return res.status(500).json({ error: 'Unable to open public audience link' });
    }
  }

  function guardLegacyRoute(requiredRole, route) {
    return async (req, res, next) => {
      const sessionId = String(req.query?.session || '').trim();
      const deckId = String(req.query?.deck || '').trim();
      if (!sessionId && !deckId) return next();
      if (!sessionId || !deckId) return res.status(403).json({ error: 'Access token required' });

      const payload = parseRoleAccessCookie(req.headers.cookie);
      if (!payload) return res.status(403).json({ error: 'Access token required' });
      if (payload.session_id !== sessionId || payload.deckId !== deckId || payload.role !== requiredRole || payload.route !== route) {
        return res.status(403).json({ error: 'Access token required' });
      }

      try {
        const result = await findActiveAccessLink(String(payload.access_token || ''));
        if (result.error) return res.status(result.status).json({ error: result.error });
        if (result.accessLink.session_id !== sessionId || result.accessLink.role !== requiredRole) {
          return res.status(403).json({ error: 'Access token required' });
        }

        const deck = await findDeckBySessionId(sessionId, deckDirs);
        if (!deck || deck.deckId !== deckId) return res.status(404).json({ error: 'Presentation not found' });
        return next();
      } catch (error) {
        console.error('Unable to validate legacy route access', error);
        return res.status(500).json({ error: 'Unable to validate route access' });
      }
    };
  }

  return { createAccessLink, resolveAccessLink, openPresentation, openRole, openPublicAudience, guardLegacyRoute };
}

module.exports = {
  createAccessLinkHandlers,
  generateAccessToken,
  isValidRole
};
