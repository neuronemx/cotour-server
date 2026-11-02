const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function twoPagePdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 344] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 344] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 42 >>\nstream\nBT /F1 24 Tf 72 200 Td (First) Tj ET\nendstream',
    '<< /Length 43 >>\nstream\nBT /F1 24 Tf 72 200 Td (Second) Tj ET\nendstream'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return pdf;
}

test('real PDF conversion keeps a staged English source and its rendered slides', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'immersa-pdf-en-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const previous = process.env.IMMERSA_DATA_DIR;
  process.env.IMMERSA_DATA_DIR = root;
  const modulePath = require.resolve('../pdf-upload-support');
  delete require.cache[modulePath];
  const { convertDeckPdf } = require('../pdf-upload-support');
  if (previous === undefined) delete process.env.IMMERSA_DATA_DIR;
  else process.env.IMMERSA_DATA_DIR = previous;

  const stageDir = path.join(root, 'tmp', 'deck-es-en-test');
  await fs.promises.mkdir(stageDir, { recursive: true });
  const pdfPath = path.join(stageDir, 'original.pdf');
  await fs.promises.writeFile(pdfPath, twoPagePdf());
  const manifest = await convertDeckPdf({ deckDir: stageDir, pdfPath, manifest: { deckId: 'deck-es-en-test' } });
  assert.equal(manifest.conversion.status, 'completed');
  assert.equal(manifest.slides.length, 2);
  assert.equal((await fs.promises.stat(pdfPath)).size > 0, true);
  for (const slide of manifest.slides) {
    assert.equal((await fs.promises.stat(path.join(stageDir, slide.src))).size > 0, true);
    assert.equal((await fs.promises.stat(path.join(stageDir, slide.thumb))).size > 0, true);
  }
  assert.deepEqual(await fs.promises.readdir(path.join(root, 'tmp')), ['deck-es-en-test']);
});
