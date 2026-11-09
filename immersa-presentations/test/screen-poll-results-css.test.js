const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'shared', 'interactions.css'), 'utf8');

test('Pantalla poll results hide the poll title without affecting other interaction views', () => {
  assert.match(css, /\.screen \.interaction-results-overlay h2\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /(?<!\.screen )\.interaction-results-overlay h2\s*\{[^}]*display:\s*none;/s);
});

test('Pantalla poll question and options wrap inside their result badges', () => {
  assert.match(css, /\.screen \.interaction-results-overlay p,[\s\S]*?\.screen \.interaction-results-overlay \.interaction-result-label span\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.screen \.interaction-results-overlay \.interaction-result-label span\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s);
});

test('Pantalla poll question uses title hierarchy above its answers', () => {
  assert.match(css, /\.screen \.interaction-results-overlay > p\s*\{[^}]*color:\s*#f8f4ea;[^}]*font-size:\s*clamp\(28px, 4vw, 54px\);[^}]*font-weight:\s*800;[^}]*line-height:\s*1\.12;[^}]*letter-spacing:\s*-\.02em;/s);
});
