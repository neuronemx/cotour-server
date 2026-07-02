const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN_PATTERN = /^a_[a-z0-9]{10}$/;
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const VALID_ROLES = new Set(['speaker', 'stage', 'audience', 'viewer']);

function generateAccessToken() {
  const bytes = crypto.randomBytes(10);
  let suffix = '';
  for (const byte of bytes) suffix += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return 'a_' + suffix;
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
  return '/' + route + '?' + params.toString();
}

function createAccessLinkHandlers({ dataDir, staticDecksDir, dataDecksDir }) {
  const storePath = path.join(dataDir, 'access-links.json');
  const deckDirs = [dataDecksDir, staticDecksDir];

  async function findActiveAccessLink(accessToken) {
    if (!ACCESS_TOKEN_PATTERN.test(accessToken)) return { status: 404, error: 'Access link not found' };

    const accessLinks = await loadAccessLinks(storePath);
    const accessLink = accessLinks.find((link) => link.access_token === accessToken);
    if (!accessLink) return { status: 404, error: 'Access link not found' };
    if (accessLink.active === false) return { status: 403, error: 'Access link inactive' };
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
      let accessToken = generateAccessToken();
      while (usedTokens.has(accessToken)) accessToken = generateAccessToken();

      const accessLink = {
        access_token: accessToken,
        session_id: sessionId,
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
    return async (req, res) => {
      const accessToken = String(req.params.access_token || '').trim();

      try {
        const result = await findActiveAccessLink(accessToken);
        if (result.error) return res.status(result.status).json({ error: result.error });
        if (result.accessLink.role !== requiredRole) return res.status(403).json({ error: 'Role not allowed for this experience' });

        const deck = await findDeckBySessionId(result.accessLink.session_id, deckDirs);
        if (!deck) return res.status(404).json({ error: 'Presentation not found' });

        return res.redirect(302, roleRedirectUrl(route, result.accessLink, deck));
      } catch (error) {
        console.error('Unable to open role experience', error);
        return res.status(500).json({ error: 'Unable to open role experience' });
      }
    };
  }

  return { createAccessLink, resolveAccessLink, openPresentation, openRole };
}

module.exports = {
  createAccessLinkHandlers,
  generateAccessToken,
  isValidRole
};
