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
  assert.equal(persistence.DB_VERSION, 2);
  assert.ok(persistence.MAX_INDEXEDDB_COPY_BYTES >= 256 * 1024 * 1024);
});

test('Screen loads verified persistence before the local media manager', () => {
  const screen = read('public/screen/index.html');
  const fix = read('public/screen/screen-local-media-persistence-fix.js');
  const fixPosition = screen.indexOf('screen-local-media-persistence-fix.js?v=109');
  const managerPosition = screen.indexOf('screen-local-media.js?v=108');

  assert.ok(fixPosition >= 0);
  assert.ok(managerPosition > fixPosition);
  assert.match(fix, /transaction\.oncomplete/);
  assert.match(fix, /storage_mode: 'opfs'/);
  assert.match(fix, /createWritable/);
  assert.match(fix, /storage_mode: 'indexeddb-file'/);
  assert.match(fix, /file_blob/);
  assert.match(fix, /putRecord/);
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
