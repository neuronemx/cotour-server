const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Idioma uses a dedicated modal with the approved English-version states and copy', () => {
  const html = read('public/home/index.html');
  const script = read('public/home/locales-editor.js');
  assert.match(html, /id="deckLanguageModal"/);
  assert.match(html, /Conecta con tu audiencia también en Inglés/);
  assert.match(html, /Agrega a tu deck una versión de tu presentación en Inglés, con igual número y orden de slides/);
  assert.match(html, /id="deckLocaleUpload"[^>]*>Subir versión Inglés/);
  assert.match(html, /id="deckLocaleToggle"[^>]*hidden>Desactivar/);
  assert.match(html, /id="deckLocaleDelete"[^>]*hidden>Eliminar/);
  assert.match(html, /id="deckLocaleUpload"[^>]*>Subir versión Inglés<\/button>[\s\S]*id="deckLanguageNote"/);
  assert.doesNotMatch(html, /EN \+|Español Base|Base · Activo/);
  assert.match(script, /upload\.textContent = variant \? 'Reemplazar' : 'Subir versión Inglés'/);
  assert.match(script, /variant\?\.active \? 'Desactivar' : 'Activar'/);
  assert.match(script, /note\.hidden = Boolean\(variant\)/);
  assert.match(script, /Recuerda también incluir los textos en Inglés en Encuestas y Trivias/);
});
