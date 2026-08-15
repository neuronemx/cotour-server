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
        playback: { autoplay: true, end_behavior: 'loop', muted: false },
        duration_seconds: 125.432,
        preview: { data_url: 'data:image/jpeg;base64,/9j/2Q==', width: 320, height: 180 }
      }, {
        id: 'vid_intro',
        slide_id: 'intro',
        file: { name: 'intro.MOV', size: 123456, type: 'video/quicktime', last_modified: 456 },
        playback: { autoplay: false, end_behavior: 'stay', muted: false },
        duration_seconds: 9.8
      }]
    }
  }, putRes);
  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(putRes.body.hidden_slide_ids, ['closing']);
  assert.deepEqual(putRes.body.hidden_slide_indexes, [2]);
  assert.deepEqual(putRes.body.videos.map((video) => video.slide_id), ['intro', 'product']);
  const productVideo = putRes.body.videos.find((video) => video.id === 'vid_product');
  assert.equal(productVideo.playback.end_behavior, 'loop');
  assert.equal(productVideo.duration_seconds, 125.432);
  assert.equal(productVideo.preview.url, '/decks/sales/video-previews/vid_product.jpg');
  assert.equal(putRes.body.videos.find((video) => video.id === 'vid_intro').file.type, 'video/quicktime');
  assert.equal(fs.readFileSync(path.join(deckDir, 'video-previews', 'vid_product.jpg')).toString('hex'), 'ffd8ffd9');

  const stored = JSON.parse(fs.readFileSync(path.join(deckDir, 'interactions.json'), 'utf8'));
  assert.equal(stored.videos.find((video) => video.id === 'vid_product').file.name, 'producto-4k.mp4');
  assert.equal(stored.videos.find((video) => video.id === 'vid_product').preview.url, '/decks/sales/video-previews/vid_product.jpg');
  assert.deepEqual(stored.hidden_slide_ids, ['closing']);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('YouTube links are normalized without accepting arbitrary embeds', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'immersa-youtube-model-'));
  const dataDecksDir = path.join(temp, 'data');
  const staticDecksDir = path.join(temp, 'static');
  const deckDir = path.join(dataDecksDir, 'youtube');
  fs.mkdirSync(deckDir, { recursive: true });
  fs.mkdirSync(staticDecksDir, { recursive: true });
  fs.writeFileSync(path.join(deckDir, 'manifest.json'), JSON.stringify({
    deckId: 'youtube',
    slides: [
      { id: 'watch', src: 'slides/slide-001.jpg' },
      { id: 'short', src: 'slides/slide-002.jpg' },
      { id: 'embed', src: 'slides/slide-003.jpg' }
    ]
  }));

  const handlers = createDeckInteractionHandlers({ dataDecksDir, staticDecksDir });
  const putRes = responseCapture();
  await handlers.putInteractions({
    params: { deckId: 'youtube' },
    body: {
      interactions: [],
      videos: [{
        id: 'vid_watch',
        slide_id: 'watch',
        source: { type: 'youtube', url: 'youtu.be/M7lc1UVf-VE?t=1m2s' },
        playback: { autoplay: true, end_behavior: 'next' }
      }, {
        id: 'vid_short',
        slide_id: 'short',
        source: { type: 'youtube', url: 'https://www.youtube.com/shorts/9bZkp7q19f0?start=7' },
        playback: { autoplay: false, end_behavior: 'stay' }
      }, {
        id: 'vid_embed',
        slide_id: 'embed',
        source: { type: 'youtube', url: 'https://www.youtube-nocookie.com/embed/ScMzIvxBSi4' },
        playback: { autoplay: true, end_behavior: 'loop' }
      }]
    }
  }, putRes);

  assert.equal(putRes.statusCode, 200);
  assert.deepEqual(putRes.body.videos.map((video) => video.source.video_id), [
    'M7lc1UVf-VE',
    '9bZkp7q19f0',
    'ScMzIvxBSi4'
  ]);
  assert.equal(putRes.body.videos[0].source.start_seconds, 62);
  assert.equal(putRes.body.videos[0].source.url, 'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=62s');
  assert.equal(putRes.body.videos[0].file, null);
  assert.equal(putRes.body.videos[0].duration_seconds, null);
  assert.equal(putRes.body.videos[0].preview.url, 'https://i.ytimg.com/vi/M7lc1UVf-VE/mqdefault.jpg');

  const invalidRes = responseCapture();
  await handlers.putInteractions({
    params: { deckId: 'youtube' },
    body: {
      interactions: [],
      videos: [{
        id: 'vid_bad',
        slide_id: 'watch',
        source: { type: 'youtube', url: 'https://example.com/embed/M7lc1UVf-VE' }
      }]
    }
  }, invalidRes);
  assert.equal(invalidRes.statusCode, 400);
  assert.match(invalidRes.body.error, /YouTube/);
  fs.rmSync(temp, { recursive: true, force: true });
});

test('Home exposes compact multimedia configuration with visible linked file', () => {
  const html = read('public/home/index.html');
  const editor = read('public/home/video-editor.js');
  const labels = read('public/home/video-slide-labels.js');
  const css = read('public/home/video-editor.css');
  const visibility = read('public/shared/slide-visibility.js');

  assert.match(html, /video-editor\.css\?v=109/);
  assert.match(html, /video-editor\.js\?v=113/);
  assert.match(html, /video-slide-labels\.js\?v=106/);
  assert.match(editor, /button\.textContent = "Videos"/);
  assert.match(editor, /Configuración Multimedia/);
  assert.match(editor, /Archivo vinculado/);
  assert.match(editor, /Reemplazar/);
  assert.doesNotMatch(editor, />Video local</);
  assert.match(editor, /Elige un MP4 \/ MOV \/ M4V local o pega un link de Youtube/);
  assert.match(editor, /Archivo MP4 \/ MOV \/ M4V/);
  assert.match(editor, /video\/quicktime/);
  assert.match(editor, /video\/x-m4v/);
  assert.match(editor, /accept="\.mp4,\.mov,\.m4v"/);
  assert.match(editor, /Link de YouTube/);
  assert.match(editor, /youtube_url/);
  assert.match(editor, /\["embed", "shorts", "live"\]/);
  assert.match(editor, /i\.ytimg\.com/);
  assert.match(editor, /end_behavior/);
  assert.match(editor, /Repetir hasta recibir Siguiente/);
  assert.match(editor, /slide_id/);
  assert.match(labels, /"Slide " \+ position/);
  assert.match(labels, /"pagina " \+ position/);
  assert.match(labels, /MutationObserver/);
  assert.match(css, /video-editor-linked-file/);
  assert.match(css, /video-editor-native-file/);
  assert.match(visibility, /hidden_slide_ids/);
  assert.match(visibility, /data-slide-id/);
});
