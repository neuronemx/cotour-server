const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BreakoutUi = require('../public/shared/breakout-ui');

const state = { status: 'running', remaining_ms: 42000, score: 0, blocks: [] };

test('audience renders independent left and right OFF/ON image layers', () => {
  const html = BreakoutUi.audienceMarkup(state);
  assert.match(html, /left-off\.svg/);
  assert.match(html, /left-on\.svg/);
  assert.match(html, /right-off\.svg/);
  assert.match(html, /right-on\.svg/);
  assert.equal((html.match(/class="breakout-control-art/g) || []).length, 4);
  assert.equal((html.match(/\.svg\?v=100/g) || []).length, 4);
});

test('all four control SVGs embed valid artwork with one aspect ratio', () => {
  const controls = path.join(__dirname, '../public/shared/breakout-controls');
  for (const name of ['left-off', 'left-on', 'right-off', 'right-on']) {
    const svg = fs.readFileSync(path.join(controls, `${name}.svg`), 'utf8');
    const dimensions = svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);
    assert.ok(dimensions);
    assert.equal(Number(dimensions[1]) / Number(dimensions[2]), 8 / 9);
    assert.match(svg, /href="data:image\/webp;base64,UklGR/);
  }
});

test('mobile hold controls suppress native long-press gestures', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/shared/breakout-ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/shared/breakout-controls-art.css'), 'utf8');
  assert.match(js, /contextmenu/);
  assert.match(js, /dragstart/);
  assert.match(js, /selectstart/);
  assert.match(css, /-webkit-touch-callout:none/);
  assert.match(css, /-webkit-user-drag:none/);
});

test('portrait audience keeps the illustrated controls side by side and joined', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/shared/breakout-controls-art.css'), 'utf8');
  const portraitCss = css.split('@media (orientation:landscape)')[0];
  assert.match(css, /\.breakout-audience-logo\{[^}]*width:clamp\(147px,38\.4vw,221px\)/);
  assert.match(css, /@media \(orientation:portrait\)\{[\s\S]*?\.breakout-audience \.breakout-pad\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);[^}]*grid-template-rows:minmax\(0,1fr\);[^}]*gap:0/);
  assert.match(css, /\.breakout-audience \.breakout-pad button:last-child\{[^}]*margin-left:-1px/);
  assert.match(css, /@media \(orientation:portrait\)\{[\s\S]*?\.breakout-audience \.breakout-control-art\{[^}]*object-fit:contain/);
  assert.doesNotMatch(portraitCss, /object-fit:cover/);
  assert.doesNotMatch(portraitCss, /content:url\('\/shared\/breakout-controls\/(?:left|right)-(?:off|on)\.svg/);
  assert.match(css, /\.breakout-audience \.breakout-pad button:active,[^}]*button\.is-held\{transform:none;filter:none\}/);
  assert.match(css, /@media \(orientation:portrait\)\{\.breakout-audience\{[^}]*align-content:stretch!important;[^}]*grid-template-rows:minmax\(0,1fr\) auto auto minmax\(96px,18dvh\)/);
  assert.match(css, /\.breakout-audience header\{[^}]*align-self:stretch;[^}]*place-items:center/);
});

test('Screen countdown is pinned above the play field', () => {
  const css = fs.readFileSync(path.join(__dirname, '../public/shared/breakout-controls-art.css'), 'utf8');
  assert.match(css, /\.breakout-countdown\{[^}]*top:max\(10px,env\(safe-area-inset-top\)\)/);
});
