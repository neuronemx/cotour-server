const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDeckInteractionHandlers } = require('../deck-interactions-api');
const { listAudiovisualResources } = require('../audiovisual-library');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test('Speaker library uses only the saved Deck selection, including empty and retired IDs', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'immersa-deck-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDecksDir = path.join(root, 'data');
  const staticDecksDir = path.join(root, 'static');
  const deckDir = path.join(dataDecksDir, 'deck-a');
  await fs.mkdir(deckDir, { recursive: true });
  await fs.mkdir(staticDecksDir);
  await fs.writeFile(path.join(deckDir, 'manifest.json'), JSON.stringify({ slides: [{ id: 'slide-1' }] }));
  const handlers = createDeckInteractionHandlers({ dataDecksDir, staticDecksDir });
  const catalog = listAudiovisualResources();
  const videos = catalog.filter((item) => item.type === 'video');
  const audios = catalog.filter((item) => item.type === 'audio');
  assert.ok(videos.length >= 2 && audios.length >= 2);

  async function saveSelection(ids) {
    const result = response();
    await handlers.putInteractions({ params: { deckId: 'deck-a' }, body: { interactions: [], audiovisual: ids } }, result);
    assert.equal(result.statusCode, 200);
    return result.payload.audiovisual;
  }

  async function speakerResources() {
    const result = response();
    await handlers.getDeckAudiovisualLibrary({ params: { deckId: 'deck-a' } }, result);
    assert.equal(result.statusCode, 200);
    return result.payload.resources;
  }

  // Existing Decks without an interactions.json also start with no selected media.
  assert.deepEqual(await speakerResources(), []);

  assert.deepEqual(await saveSelection([videos[0].id]), [videos[0].id]);
  assert.deepEqual((await speakerResources()).map((item) => item.id), [videos[0].id]);

  const mixed = [audios[0].id, videos[1].id, audios[1].id];
  assert.deepEqual(await saveSelection(mixed), mixed);
  const selected = await speakerResources();
  assert.deepEqual(new Set(selected.map((item) => item.id)), new Set(mixed));
  assert.deepEqual(selected.map((item) => item.type).sort(), ['audio', 'audio', 'video']);

  assert.deepEqual(await saveSelection([]), []);
  assert.deepEqual(await speakerResources(), []);

  // A legacy Deck may still have raw IDs for resources removed from the catalog.
  await fs.writeFile(path.join(deckDir, 'interactions.json'), JSON.stringify({
    interactions: [], audiovisual: ['removed-media', videos[0].id, audios[0].id, 'removed-media']
  }));
  assert.deepEqual(new Set((await speakerResources()).map((item) => item.id)), new Set([videos[0].id, audios[0].id]));
  await fs.writeFile(path.join(deckDir, 'interactions.json'), JSON.stringify({
    interactions: [], audiovisual: ['removed-media']
  }));
  assert.deepEqual(await speakerResources(), []);
});

test('Speaker loads the Deck-scoped API while Home retains the full catalog', async () => {
  const root = path.join(__dirname, '..');
  const server = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  const speaker = await fs.readFile(path.join(root, 'public/presenter/presenter.js'), 'utf8');
  const home = await fs.readFile(path.join(root, 'public/home/audiovisual-editor.js'), 'utf8');
  assert.match(server, /app\.get\("\/api\/decks\/:deckId\/audiovisual-library", deckInteractionHandlers\.getDeckAudiovisualLibrary\)/);
  assert.match(server, /if \(resource === remoteResource\) \{[\s\S]*readDeckConfig\(session\.deckId\)[\s\S]*configuration\.audiovisual\.includes\(remoteResource\.id\)/);
  assert.match(speaker, /fetch\("\/api\/decks\/" \+ encodeURIComponent\(deckId\) \+ "\/audiovisual-library"/);
  assert.doesNotMatch(speaker, /fetch\("\/api\/audiovisual-library"/);
  assert.match(home, /fetch\('\/api\/audiovisual-library'\)/);
});
