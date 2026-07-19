const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAccessLinkHandlers } = require('../access-links');

async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'immersa-qna-access-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const staticDecksDir = path.join(root, 'static-decks');
  const dataDecksDir = path.join(root, 'data-decks');
  const publicDir = path.join(root, 'public');
  const deckDir = path.join(dataDecksDir, 'deck-a');
  await Promise.all([
    fs.promises.mkdir(dataDir, { recursive: true }),
    fs.promises.mkdir(deckDir, { recursive: true }),
    fs.promises.mkdir(path.join(publicDir, 'screen'), { recursive: true }),
    fs.promises.mkdir(path.join(publicDir, 'audience'), { recursive: true })
  ]);
  await fs.promises.writeFile(path.join(deckDir, 'manifest.json'), JSON.stringify({
    deckId: 'deck-a',
    title: 'Deck A',
    session_id: 's_abcdefghij',
    slides: []
  }));
  await fs.promises.writeFile(path.join(publicDir, 'screen', 'index.html'), '<html><head></head><body>Screen</body></html>');
  await fs.promises.writeFile(path.join(publicDir, 'audience', 'index.html'), '<html><head></head><body>Audience</body></html>');
  const accessLinks = [{
    access_token: 'a_abcdefghij',
    session_id: 's_abcdefghij',
    role: 'screen',
    created_at: '2026-07-19T05:00:00.000Z',
    active: true
  }];
  await fs.promises.writeFile(path.join(dataDir, 'access-links.json'), JSON.stringify(accessLinks));
  return { root, dataDir, staticDecksDir, dataDecksDir, publicDir };
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    type() { return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

function request(params) {
  return {
    params,
    headers: { host: 'immersa.test', 'x-forwarded-proto': 'https' },
    secure: true,
    get(name) { return this.headers[String(name).toLowerCase()]; }
  };
}

test('opening Screen persists and injects its historical presentation session', async (t) => {
  const paths = await fixture(t);
  const calls = [];
  const handlers = createAccessLinkHandlers({
    ...paths,
    startScreenExecution: async (payload) => {
      calls.push(payload);
      return { presentationSessionId: 'presentation-session-1', created: true };
    }
  });
  const res = response();
  await handlers.openRole('screen', 'screen')(
    request({ access_token: 'a_abcdefghij' }),
    res,
    () => assert.fail('Screen route should resolve')
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"presentation_session_id":"presentation-session-1"/);
  assert.deepEqual(calls, [{
    deckId: 'deck-a',
    sourceSessionId: 's_abcdefghij',
    screenLinkId: 'a_abcdefghij',
    presentationSessionId: null
  }]);
  const stored = JSON.parse(await fs.promises.readFile(path.join(paths.dataDir, 'access-links.json'), 'utf8'));
  assert.equal(stored[0].presentation_session_id, 'presentation-session-1');
});

test('refreshing Screen passes its persisted binding back to the coordinator', async (t) => {
  const paths = await fixture(t);
  const storePath = path.join(paths.dataDir, 'access-links.json');
  const stored = JSON.parse(await fs.promises.readFile(storePath, 'utf8'));
  stored[0].presentation_session_id = 'presentation-session-1';
  await fs.promises.writeFile(storePath, JSON.stringify(stored));
  const calls = [];
  const handlers = createAccessLinkHandlers({
    ...paths,
    startScreenExecution: async (payload) => {
      calls.push(payload);
      return { presentationSessionId: 'presentation-session-1', created: false };
    }
  });
  await handlers.openRole('screen', 'screen')(
    request({ access_token: 'a_abcdefghij' }),
    response(),
    () => assert.fail('Screen route should resolve')
  );
  assert.equal(calls[0].presentationSessionId, 'presentation-session-1');
});

test('without a runtime callback Screen remains available and no DB binding is attempted', async (t) => {
  const paths = await fixture(t);
  const handlers = createAccessLinkHandlers(paths);
  const res = response();
  await handlers.openRole('screen', 'screen')(
    request({ access_token: 'a_abcdefghij' }),
    res,
    () => assert.fail('Screen route should resolve')
  );
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"presentation_session_id":""/);
  const stored = JSON.parse(await fs.promises.readFile(path.join(paths.dataDir, 'access-links.json'), 'utf8'));
  assert.equal(Object.hasOwn(stored[0], 'presentation_session_id'), false);
});

test('Q&A resources accept only active Speaker and Stage access links', async (t) => {
  const paths = await fixture(t);
  const storePath = path.join(paths.dataDir, 'access-links.json');
  const stored = JSON.parse(await fs.promises.readFile(storePath, 'utf8'));
  stored.push(
    { access_token: 'a_spk1234567', session_id: 's_abcdefghij', role: 'speaker', active: true },
    { access_token: 'a_stg1234567', session_id: 's_abcdefghij', role: 'stage', active: true },
    { access_token: 'a_aud1234567', session_id: 's_abcdefghij', role: 'audience', active: true }
  );
  await fs.promises.writeFile(storePath, JSON.stringify(stored));
  const handlers = createAccessLinkHandlers(paths);
  const guard = handlers.guardAccessRoles(['speaker', 'stage']);

  for (const accessToken of ['a_spk1234567', 'a_stg1234567']) {
    const req = request({ access_token: accessToken });
    let passed = false;
    await guard(req, response(), () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(req.immersaAccess.deck.deckId, 'deck-a');
    assert.equal(req.immersaAccess.accessLink.access_token, accessToken);
  }

  const audienceResponse = response();
  await guard(request({ access_token: 'a_aud1234567' }), audienceResponse, () => assert.fail('Público must not export Q&A'));
  assert.equal(audienceResponse.statusCode, 403);
});
