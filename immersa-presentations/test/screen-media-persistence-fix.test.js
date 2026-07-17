const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const persistence = require('../public/screen/screen-local-media-persistence-fix.js');

test('persistent multimedia fallback keeps stable deck and slide keys', () => {
  assert.equal(persistence.bindingKey('pitch', 'slide-005'), 'pitch::slide-005');
  assert.equal(persistence.safeSegment('Pitch 2026 / Final'), 'Pitch-2026-Final');
  assert.equal(persistence.DB_VERSION, 3);
  assert.ok(persistence.MAX_INDEXEDDB_COPY_BYTES >= 256 * 1024 * 1024);
});

test('Screen loads picker adapter and canonical persistence before the media manager', () => {
  const screen = read('public/screen/index.html');
  const fix = read('public/screen/screen-local-media-persistence-fix.js');
  const adapterPosition = screen.indexOf('screen-local-file-picker-adapter.js?v=113');
  const fixPosition = screen.indexOf('screen-local-media-persistence-fix.js?v=111');
  const managerPosition = screen.indexOf('screen-local-media.js?v=111');
  const polishPosition = screen.indexOf('screen-multimedia-modal-polish.js?v=113');

  assert.ok(adapterPosition >= 0);
  assert.ok(fixPosition > adapterPosition);
  assert.ok(managerPosition > fixPosition);
  assert.ok(polishPosition > managerPosition);
  assert.doesNotMatch(screen, /screen-local-media-handle-store\.js/);
  assert.match(fix, /transaction\.oncomplete/);
  assert.match(fix, /discoverOpfs/);
  assert.match(fix, /deckDirectory\.entries/);
  assert.match(fix, /fileName \+ '\.json'/);
  assert.match(fix, /storage_mode: 'opfs'/);
  assert.match(fix, /storage_mode: 'indexeddb-file'/);
});

test('Screen multimedia modal uses one picker per video and no diagnostic marker', () => {
  const adapter = read('public/screen/screen-local-file-picker-adapter.js');
  const polish = read('public/screen/screen-multimedia-modal-polish.js');
  assert.doesNotMatch(adapter, /Persistencia/);
  assert.match(polish, /\[data-pick\]/);
  assert.match(polish, /\[data-multi-input\]/);
  assert.match(polish, /Archivo distinto al registrado en la presentación/);
  assert.match(polish, /data-media-action="accept"/);
});

test('OPFS is the primary persistent copy rather than a database-only handle', () => {
  const fix = read('public/screen/screen-local-media-persistence-fix.js');
  const opfsWrite = fix.indexOf('const opfs = await writeOpfs');
  const handleWrite = fix.indexOf('if (handle)', opfsWrite);
  assert.ok(opfsWrite >= 0);
  assert.ok(handleWrite > opfsWrite);
});

test('persistent file metadata still distinguishes replacements', () => {
  assert.equal(persistence.sameFileMetadata(
    { name: 'RevisionF.mp4', size: 100 },
    { name: 'revisionf.mp4', size: 100 }
  ), true);
  assert.equal(persistence.sameFileMetadata(
    { name: 'RevisionF.mp4', size: 100 },
    { name: 'RevisionG.mp4', size: 100 }
  ), false);
});
