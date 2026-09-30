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
  const css = read('public/home/locales-editor.css');
  assert.match(css, /\.deck-locale-actions button \{[\s\S]*min-height: 51px;[\s\S]*border: 1px solid var\(--line\);[\s\S]*background: #fff;/);
  assert.match(css, /\.deck-locale-actions #deckLocaleUpload \{[\s\S]*background: var\(--grad\);/);
});

test('Público uses the attached flags as a destination-language toggle beside QR', () => {
  const html = read('public/audience/index.html');
  const script = read('public/audience/audience.js');
  const css = read('public/audience/audience.css');
  assert.match(html, /id="audienceLocaleToggle"[\s\S]*?shared\/flags\/usa\.png/);
  assert.doesNotMatch(html, /id="audienceLocale"|<select[^>]+audience-locale/);
  assert.match(script, /destination === 'en' \? '\/shared\/flags\/usa\.png' : '\/shared\/flags\/mex\.png'/);
  assert.match(script, /setAudienceLocale\(currentLocale === 'en' \? 'es' : 'en'\)/);
  assert.match(css, /\.audience-locale-toggle \{[\s\S]*right: calc\(max\(14px, env\(safe-area-inset-right\)\) \+ 58px\);[\s\S]*bottom: calc\(max\(14px, env\(safe-area-inset-bottom\)\) \+ 3px\);/);
  assert.match(css, /\.audience-locale-toggle img \{[^}]*width: 40px;[^}]*height: 40px;[^}]*opacity: \.85;/);
});

test('Deck Home chooses the Speaker language before opening and Speaker has no locale selector', () => {
  const home = read('public/home/home.js');
  const homeCss = read('public/home/deck-management-shell.css');
  const presenterHtml = read('public/presenter/index.html');
  const presenter = read('public/presenter/presenter.js');
  const server = read('server.js');
  assert.match(home, /deck\?\.locales\?\.en\?\.active === true/);
  assert.match(home, /\{ locale: "es", flag: "mex", label: "Español" \}/);
  assert.match(home, /\{ locale: "en", flag: "usa", label: "Inglés" \}/);
  assert.match(home, /localized\.searchParams\.set\("locale", locale === "en" \? "en" : "es"\)/);
  assert.match(homeCss, /\.speaker-locale-choice img \{ width: 30px; height: 30px;/);
  assert.doesNotMatch(presenterHtml, /speakerLocale|speaker-locale/);
  assert.doesNotMatch(presenter, /getElementById\(['"]speakerLocale['"]\)/);
  assert.match(presenter, /params\.get\("locale"\) === "en"/);
  assert.match(presenter, /join_presentation", \{ session: sessionId, deck: deckId, role: "presenter", locale: requestedLocale \}/);
  assert.match(server, /role === "presenter" && \["es", "en"\]\.includes\(locale\)/);
});
