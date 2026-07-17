const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const { createDeckInteractionHandlers } = require('../deck-interactions-api');

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('legacy hidden slide indexes migrate to stable slide ids', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'immersa-video-model-'));
  const dataDecksDir = path.join(temp, 'data');
  const staticDecksDir = path.join(temp, 'static');
  const deckDir = path.join(dataDecksDir, 'sales');
  fs.mkdirSync(deckDir, { recursive: true });
  fs.mkdirSync(staticDecksDir, { recursive: true });
  fs.writeFileSync(path.join(deckDir, 'manifest.json'), JSON.stringify({
    deckId: 'sales',
    slides: [
      { id: 'intro', src: 'slides/slide-001.jpg' },
      { id: 'product', src: 'slides/slide-002.jpg' },
      { id: 'closing', src: 'slides/slide-003.jpg' }
    ]
  }));
  fs.writeFileSync(path.join(deckDir, 'interactions.json'), JSON.stringify({ interactions: [], hidden_slide_indexes: [1] }));

  const handlers = createDeckInteractionHandlers({ dataDecksDir, staticDecksDir });
  const getRes = responseCapture();
  await handlers.getInteractions({ params: { deckId: 'sales' } }, getRes);
  assert.equal(getRes.statusCode, 200);
  assert.deepEqual(getRes.body.hidden_slide_ids, ['product']);
  assert.equal(getRes.body.slides.length, 3);

  const putRes = responseCapture();
  await handlers.putInteractions({
    params: { deckId: 'sales' },
    body: {
      interactions: [],
      hidden_slide_ids: ['closing'],
      videos: [{
        id: 'vid_product',
        slide_id: 'product',
        file: { name: 'producto-4k.mp4', size: 987654321, type: 'video/mp4', last_modified: 123 },
        playback: { autoplay: true, end_behavior: 'loop', muted: false }
      }]
    }
  }, putRes);
  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(putRes.body.hidden_slide_ids, ['closing']);
  assert.deepEqual(putRes.body.hidden_slide_indexes, [2]);
  assert.equal(putRes.body.videos[0].slide_id, 'product');
  assert.equal(putRes.body.videos[0].playback.end_behavior, 'loop');

  const stored = JSON.parse(fs.readFileSync(path.join(deckDir, 'interactions.json'), 'utf8'));
  assert.equal(stored.videos[0].file.name, 'producto-4k.mp4');
  assert.deepEqual(stored.hidden_slide_ids, ['closing']);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('Home exposes compact multimedia configuration with visible linked file', () => {
  const html = read('public/home/index.html');
  const editor = read('public/home/video-editor.js');
  const css = read('public/home/video-editor.css');
  const visibility = read('public/shared/slide-visibility.js');

  assert.match(html, /video-editor\.css\?v=105/);
  assert.match(html, /video-editor\.js\?v=105/);
  assert.match(editor, /button\.textContent = "Videos"/);
  assert.match(editor, /Configuración Multimedia/);
  assert.match(editor, /Archivo vinculado/);
  assert.match(editor, /Reemplazar MP4/);
  assert.doesNotMatch(editor, />Video local</);
  assert.match(editor, /El archivo no se sube/);
  assert.match(editor, /end_behavior/);
  assert.match(editor, /Repetir hasta recibir Siguiente/);
  assert.match(editor, /slide_id/);
  assert.match(css, /video-editor-linked-file/);
  assert.match(css, /video-editor-native-file/);
  assert.match(visibility, /hidden_slide_ids/);
  assert.match(visibility, /data-slide-id/);
});