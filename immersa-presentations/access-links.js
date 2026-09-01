const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN_PATTERN = /^a_[a-z0-9]{10}$/;
const PUBLIC_ID_PATTERN = /^p_[a-z0-9]+$/;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const VALID_ROLES = new Set(['speaker', 'stage', 'audience', 'screen', 'viewer']);
const ROLE_ACCESS_COOKIE_PREFIX = 'immersa_role_access_';
const ROLE_ACCESS_TTL_SECONDS = 120;
const ROLE_GUARD_SECRET = process.env.IMMERSA_ROUTE_GUARD_SECRET || process.env.SESSION_SECRET || process.env.COOKIE_SECRET || crypto.randomBytes(32).toString('hex');
const LOCAL_DEMO_MODE = String(process.env.IMMERSA_MODE || '').trim().toLowerCase() === 'local-demo';

function prepareLocalDemoHtml(html) {
  if (!LOCAL_DEMO_MODE) return html;
  return String(html || '')
    .replace(/<link\b[^>]*href=["']https:\/\/fonts\.googleapis\.com[^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*href=["']https:\/\/fonts\.gstatic\.com[^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*\bsrc=(["'])https:\/\/cdn\.jsdelivr\.net\/npm\/qrcodejs@1\.0\.0\/qrcode\.min\.js\1[^>]*><\/script>/gi, '<script src="/vendor/qrcode.js"></script>');
}

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

async function findDeckManifestByDeckId(deckId, deckDirs) {
  const normalizedDeckId = String(deckId || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(normalizedDeckId)) return null;
  for (const rootDir of deckDirs) {
    const manifestPath = path.join(rootDir, normalizedDeckId, 'manifest.json');
    try {
      const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      return { manifest, deck: publicDeckFromManifest(manifest, normalizedDeckId) };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Skipping deck manifest', manifestPath, error.message);
    }
  }
  return null;
}

async function findDeckManifestForAccessLink(accessLink, deckDirs) {
  if (accessLink?.deck_id) {
    const byId = await findDeckManifestByDeckId(accessLink.deck_id, deckDirs);
    if (byId) return byId;
  }
  return findDeckManifestBySessionId(accessLink?.session_id, deckDirs);
}

async function findDeckForAccessLink(accessLink, deckDirs) {
  return (await findDeckManifestForAccessLink(accessLink, deckDirs))?.deck || null;
}

function publicAccessLink(accessLink, deck = null) {
  return {
    access_token: accessLink.access_token,
    public_id: accessLink.public_id,
    session_id: accessLink.session_id,
    role: accessLink.role,
    demo_role: deck?.systemDemo?.role || "",
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

function findRelatedAccessLink(accessLinks, sessionId, role) {
  return accessLinks.find((link) => link.session_id === sessionId && link.role === role && link.active !== false) || null;
}

function nextUniqueAccessToken(accessLinks) {
  const usedTokens = new Set(accessLinks.map((link) => link.access_token).filter(Boolean));
  let accessToken = generateAccessToken();
  while (usedTokens.has(accessToken)) accessToken = generateAccessToken();
  return accessToken;
}

function nextUniquePublicId(accessLinks) {
  const usedPublicIds = new Set(accessLinks.map((link) => link.public_id).filter(Boolean));
  let publicId = generatePublicId();
  while (usedPublicIds.has(publicId)) publicId = generatePublicId();
  return publicId;
}

function ensureAudienceAccessLink(accessLinks, sessionId) {
  const readyAudience = accessLinks.find((link) => link.session_id === sessionId && link.role === 'audience' && link.active !== false && PUBLIC_ID_PATTERN.test(String(link.public_id || '')) && ACCESS_TOKEN_PATTERN.test(String(link.access_token || '')));
  if (readyAudience) return { accessLink: readyAudience, changed: false };

  const current = findRelatedAccessLink(accessLinks, sessionId, 'audience');
  if (current) {
    if (!ACCESS_TOKEN_PATTERN.test(String(current.access_token || ''))) current.access_token = nextUniqueAccessToken(accessLinks);
    if (!PUBLIC_ID_PATTERN.test(String(current.public_id || ''))) current.public_id = nextUniquePublicId(accessLinks);
    return { accessLink: current, changed: true };
  }

  const accessLink = {
    access_token: nextUniqueAccessToken(accessLinks),
    public_id: nextUniquePublicId(accessLinks),
    session_id: sessionId,
    role: 'audience',
    created_at: new Date().toISOString(),
    active: true
  };
  accessLinks.push(accessLink);
  return { accessLink, changed: true };
}

function absoluteUrl(req, pathname) {
  const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  return protocol + '://' + req.get('host') + pathname;
}

function relatedRoleContext(req, accessLink, deck, relatedLinks = {}, featureAccess = {}) {
  const publicPath = relatedLinks.audience?.public_id ? '/' + relatedLinks.audience.public_id : '';
  const screenPath = relatedLinks.screen?.access_token ? '/screen/' + relatedLinks.screen.access_token : '';
  const stagePath = relatedLinks.stage?.access_token ? '/stage/' + relatedLinks.stage.access_token : '';
  return {
    access_token: accessLink.access_token,
    session: accessLink.session_id,
    session_id: accessLink.session_id,
    deck: deck.deckId,
    deckId: deck.deckId,
    role: accessLink.role,
    demo_role: deck?.systemDemo?.role || "",
    plan: featureAccess.plan || "FREE",
    features: featureAccess.features || { interactions: false, metrics: false },
    presentation_session_id: accessLink.presentation_session_id || relatedLinks.screen?.presentation_session_id || '',
    public_id: relatedLinks.audience?.public_id || '',
    public_url: publicPath ? absoluteUrl(req, publicPath) : '',
    screen_url: screenPath ? absoluteUrl(req, screenPath) : '',
    stage_url: stagePath ? absoluteUrl(req, stagePath) : ''
  };
}

function roleIndexPath(publicDir, route) {
  const page = route === 'viewer' ? 'screen' : route;
  return path.join(publicDir, page, 'index.html');
}

function injectRoleContext(html, context) {
  const safeContext = JSON.stringify(context).replace(/</g, '\\u003c');
  const script = (LOCAL_DEMO_MODE ? '<script>window.IMMERSA_LOCAL_MODE = true;</script>' : '') + '<script>window.IMMERSA_ROLE_OPEN = ' + safeContext + ';</script>';
  if (html.includes('</head>')) return html.replace('</head>', '  ' + script + '\n</head>');
  return script + '\n' + html;
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

function roleAccessCookieName(role) {
  return ROLE_ACCESS_COOKIE_PREFIX + String(role || '').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
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

function parseRoleAccessCookie(cookieHeader, role) {
  const cookieValue = parseCookies(cookieHeader).get(roleAccessCookieName(role));
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

function injectPublicAudienceContext(html, accessLink, deck, presentationSessionId = '') {
  const context = JSON.stringify({
    session: accessLink.session_id,
    deck: deck.deckId,
    presentation_session_id: presentationSessionId
  }).replace(/</g, '\\u003c');
  const script = (LOCAL_DEMO_MODE ? '<script>window.IMMERSA_LOCAL_MODE = true;</script>' : '') + '<script>window.IMMERSA_PUBLIC_OPEN = ' + context + ';</script>';
  if (html.includes('</head>')) return html.replace('</head>', '  ' + script + '\n</head>');
  return script + '\n' + html;
}

function createAccessLinkHandlers({ dataDir, staticDecksDir, dataDecksDir, publicDir, startScreenExecution = null, resolveDeckFeatureAccess = null }) {
  const storePath = path.join(dataDir, 'access-links.json');
  const deckDirs = [dataDecksDir, staticDecksDir];
  const audienceIndexPath = publicDir ? path.join(publicDir, 'audience', 'index.html') : null;

  function latestPresentationSessionId(accessLinks, sessionId) {
    return accessLinks
      .filter((link) => link.session_id === sessionId && link.role === 'screen' && link.presentation_session_id)
      .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))[0]?.presentation_session_id || '';
  }

  async function bindScreenExecution(accessLink, deck, accessLinks) {
    if (accessLink.role !== 'screen' || typeof startScreenExecution !== 'function') return accessLink;
    const execution = await startScreenExecution({
      deckId: deck.deckId,
      sourceSessionId: accessLink.session_id,
      screenLinkId: accessLink.access_token,
      presentationSessionId: accessLink.presentation_session_id || null
    });
    const presentationSessionId = String(execution?.presentationSessionId || '').trim();
    if (!presentationSessionId) throw new Error('Screen execution did not return presentationSessionId');
    const storedLink = accessLinks.find((link) => link.access_token === accessLink.access_token);
    if (!storedLink) throw new Error('Screen access link disappeared while binding its execution');
    if (storedLink.presentation_session_id !== presentationSessionId) {
      storedLink.presentation_session_id = presentationSessionId;
      await saveAccessLinks(storePath, accessLinks);
    }
    return storedLink;
  }

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
      const deckResult = req.ownedDeckId
        ? await findDeckManifestByDeckId(req.ownedDeckId, deckDirs)
        : await findDeckManifestBySessionId(sessionId, deckDirs);
      const deck = deckResult?.deck;
      if (!deck) return res.status(404).json({ error: 'Presentation not found' });

      const accessLinks = await loadAccessLinks(storePath);
      if (role === 'audience') {
        const audienceResult = ensureAudienceAccessLink(accessLinks, sessionId);
        if (audienceResult.accessLink.deck_id !== deck.deckId) {
          audienceResult.accessLink.deck_id = deck.deckId;
          audienceResult.changed = true;
        }
        if (audienceResult.changed) await saveAccessLinks(storePath, accessLinks);
        return res.status(audienceResult.changed ? 201 : 200).json(publicAccessLink(audienceResult.accessLink, deck));
      }

      const usedTokens = new Set(accessLinks.map((link) => link.access_token).filter(Boolean));
      let accessToken = generateAccessToken();
      while (usedTokens.has(accessToken)) accessToken = generateAccessToken();

      const accessLink = {
        access_token: accessToken,
        session_id: sessionId,
        deck_id: deck.deckId,
        role,
        created_at: new Date().toISOString(),
        active: true
      };

      accessLinks.push(accessLink);
      await saveAccessLinks(storePath, accessLinks);
      return res.status(201).json(publicAccessLink(accessLink, deck));
    } catch (error) {
      console.error('Unable to create access link', error);
      return res.status(500).json({ error: 'Unable to create access link' });
    }
  }

  async function createAccessLinkForDeck({ deckId, role }) {
    const normalizedRole = String(role || '').trim();
    if (!isValidRole(normalizedRole)) throw new Error('Invalid role');
    const deckResult = await findDeckManifestByDeckId(deckId, deckDirs);
    const deck = deckResult?.deck;
    if (!deck?.session_id) throw new Error('Presentation not found');

    const accessLinks = await loadAccessLinks(storePath);
    const usedTokens = new Set(accessLinks.map((link) => link.access_token).filter(Boolean));
    let accessToken = generateAccessToken();
    while (usedTokens.has(accessToken)) accessToken = generateAccessToken();
    const accessLink = {
      access_token: accessToken,
      session_id: deck.session_id,
      deck_id: deck.deckId,
      role: normalizedRole,
      created_at: new Date().toISOString(),
      active: true
    };
    accessLinks.push(accessLink);
    await saveAccessLinks(storePath, accessLinks);
    return publicAccessLink(accessLink, deck);
  }

  async function resolveAccessLink(req, res) {
    const accessToken = String(req.params.access_token || '').trim();

    try {
      const result = await findActiveAccessLink(accessToken);
      if (result.error) return res.status(result.status).json({ error: result.error });

      const deck = await findDeckForAccessLink(result.accessLink, deckDirs);
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

      const deckResult = await findDeckManifestForAccessLink(result.accessLink, deckDirs);
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

        const deck = await findDeckForAccessLink(result.accessLink, deckDirs);
        if (!deck) return res.status(404).json({ error: 'Presentation not found' });
        const featureAccess = typeof resolveDeckFeatureAccess === 'function'
          ? await resolveDeckFeatureAccess(deck.deckId)
          : { plan: 'DEMO', capabilities: { 'access.backstage': true }, features: { interactions: true, metrics: true } };
        if (requiredRole === 'stage' && featureAccess.capabilities?.['access.backstage'] !== true) {
          return res.status(403).json({
            error: 'BACKSTAGE está disponible desde SPEAKER',
            code: 'PLAN_FEATURE_LOCKED',
            feature: 'access.backstage'
          });
        }

        const accessLinks = await loadAccessLinks(storePath);
        const activeAccessLink = await bindScreenExecution(result.accessLink, deck, accessLinks);
        const audienceResult = ensureAudienceAccessLink(accessLinks, result.accessLink.session_id);
        if (audienceResult.accessLink.deck_id !== deck.deckId) {
          audienceResult.accessLink.deck_id = deck.deckId;
          audienceResult.changed = true;
        }
        if (audienceResult.changed) await saveAccessLinks(storePath, accessLinks);
        const relatedLinks = {
          audience: audienceResult.accessLink,
          screen: findRelatedAccessLink(accessLinks, result.accessLink.session_id, 'screen'),
          stage: featureAccess.capabilities?.['access.backstage'] === true
            ? findRelatedAccessLink(accessLinks, result.accessLink.session_id, 'stage')
            : null
        };
        const html = await fs.promises.readFile(roleIndexPath(publicDir, route), 'utf8');
        const context = relatedRoleContext(req, activeAccessLink, deck, relatedLinks, featureAccess);

        res.setHeader('Set-Cookie', serializeCookie(roleAccessCookieName(requiredRole), createRoleAccessValue({ accessLink: activeAccessLink, deck, route }), req));
        return res.type('html').send(injectRoleContext(prepareLocalDemoHtml(html), context));
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

      const deck = await findDeckForAccessLink(result.accessLink, deckDirs);
      if (!deck) return res.status(404).json({ error: 'Presentation not found' });
      if (!audienceIndexPath) return res.status(500).json({ error: 'Audience experience is not configured' });

      const accessLinks = await loadAccessLinks(storePath);
      const presentationSessionId = latestPresentationSessionId(accessLinks, result.accessLink.session_id);
      const html = await fs.promises.readFile(audienceIndexPath, 'utf8');
      res.setHeader('Set-Cookie', serializeCookie(roleAccessCookieName('audience'), createRoleAccessValue({ accessLink: result.accessLink, deck, route: 'audience' }), req));
      return res.type('html').send(injectPublicAudienceContext(prepareLocalDemoHtml(html), result.accessLink, deck, presentationSessionId));
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

      const payload = parseRoleAccessCookie(req.headers.cookie, requiredRole);
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

        const deck = await findDeckForAccessLink(result.accessLink, deckDirs);
        if (!deck || deck.deckId !== deckId) return res.status(404).json({ error: 'Presentation not found' });
        return next();
      } catch (error) {
        console.error('Unable to validate legacy route access', error);
        return res.status(500).json({ error: 'Unable to validate route access' });
      }
    };
  }

  function guardAccessRoles(allowedRoles = []) {
    const roles = new Set(allowedRoles.map((role) => String(role || '').trim()).filter(Boolean));
    return async (req, res, next) => {
      const accessToken = String(req.params?.access_token || '').trim();
      if (!ACCESS_TOKEN_PATTERN.test(accessToken)) return res.status(404).json({ error: 'Access link not found' });

      try {
        const result = await findActiveAccessLink(accessToken);
        if (result.error) return res.status(result.status).json({ error: result.error });
        if (!roles.has(result.accessLink.role)) return res.status(403).json({ error: 'Role not allowed for this resource' });

        const deck = await findDeckForAccessLink(result.accessLink, deckDirs);
        if (!deck) return res.status(404).json({ error: 'Presentation not found' });
        req.immersaAccess = { accessLink: result.accessLink, deck };
        return next();
      } catch (error) {
        console.error('Unable to validate resource access', error);
        return res.status(500).json({ error: 'Unable to validate resource access' });
      }
    };
  }

  function guardDeckRoles(allowedRoles = [], deckParam = 'deckId') {
    const roles = allowedRoles.map((role) => String(role || '').trim()).filter(Boolean);
    return async (req, res, next) => {
      const deckId = String(req.params?.[deckParam] || '').trim();
      const headerToken = String(req.headers['x-immersa-access-token'] || '').trim();
      if (ACCESS_TOKEN_PATTERN.test(headerToken)) {
        try {
          const result = await findActiveAccessLink(headerToken);
          if (!result.error && roles.includes(result.accessLink.role)) {
            const deck = await findDeckForAccessLink(result.accessLink, deckDirs);
            if (deck?.deckId === deckId) {
              req.immersaAccess = { accessLink: result.accessLink, deck };
              return next();
            }
          }
        } catch (error) {
          console.error('Unable to validate deck access token', error);
          return res.status(500).json({ error: 'Unable to validate deck access' });
        }
      }
      for (const role of roles) {
        const payload = parseRoleAccessCookie(req.headers.cookie, role);
        if (!payload || payload.deckId !== deckId || payload.role !== role) continue;
        try {
          const result = await findActiveAccessLink(String(payload.access_token || ''));
          if (!result.error && result.accessLink.session_id === payload.session_id && result.accessLink.role === role) {
            req.immersaAccess = { accessLink: result.accessLink, deck: { deckId } };
            return next();
          }
        } catch (error) {
          console.error('Unable to validate deck role access', error);
          return res.status(500).json({ error: 'Unable to validate deck access' });
        }
      }
      return res.status(401).json({ error: 'Authentication required' });
    };
  }

  async function publicAudiencePathForDeck(deckId) {
    const normalizedDeckId = String(deckId || '').trim();
    if (!normalizedDeckId) return null;
    const accessLinks = await loadAccessLinks(storePath);
    const link = accessLinks.find((item) => (
      item.role === 'audience'
      && item.active !== false
      && item.deck_id === normalizedDeckId
      && PUBLIC_ID_PATTERN.test(String(item.public_id || ''))
    ));
    return link ? '/' + link.public_id : null;
  }

  async function ensureLocalDemoLinks(deckId) {
    const deckResult = await findDeckManifestByDeckId(deckId, deckDirs);
    const deck = deckResult?.deck;
    if (!deck?.session_id) throw new Error('Local Demo deck is not available');

    const accessLinks = await loadAccessLinks(storePath);
    const links = {};
    let changed = false;
    for (const role of ['speaker', 'screen', 'audience']) {
      let accessLink = accessLinks.find((item) => (
        item.role === role
        && item.active !== false
        && item.session_id === deck.session_id
        && item.deck_id === deck.deckId
      )) || null;

      if (!accessLink && role === 'audience') {
        const audienceResult = ensureAudienceAccessLink(accessLinks, deck.session_id);
        accessLink = audienceResult.accessLink;
        accessLink.deck_id = deck.deckId;
        accessLink.local_demo = true;
        changed = true;
      }

      if (!accessLink) {
        accessLink = {
          access_token: nextUniqueAccessToken(accessLinks),
          session_id: deck.session_id,
          deck_id: deck.deckId,
          role,
          created_at: new Date().toISOString(),
          active: true,
          local_demo: true
        };
        accessLinks.push(accessLink);
        changed = true;
      }
      links[role] = publicAccessLink(accessLink, deck);
    }

    if (changed) await saveAccessLinks(storePath, accessLinks);
    return { deck, links };
  }

  return { createAccessLink, createAccessLinkForDeck, resolveAccessLink, openPresentation, openRole, openPublicAudience, guardLegacyRoute, guardAccessRoles, guardDeckRoles, publicAudiencePathForDeck, ensureLocalDemoLinks };
}

module.exports = {
  createAccessLinkHandlers,
  generateAccessToken,
  isValidRole
};
