const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/shared/slide-loading.js'), 'utf8');
function fixture(cached = false) {
  function element() {
    const classes = new Set(), attrs = {}, events = {};
    return { hidden: false, naturalWidth: 0, complete: false,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
      getAttribute: x => attrs[x] || null, setAttribute: (x, v) => { attrs[x] = v; },
      removeAttribute: x => { delete attrs[x]; }, addEventListener: (x, fn) => { events[x] = fn; }, emit: x => events[x](),
      set src(v) { attrs.src = v; this.naturalWidth = 0; }, get src() { return attrs.src; }
    };
  }
  const slide = element(), loading = element(), message = element(), retry = element();
  slide.classList.add('slide-initial-pending'); retry.hidden = true;
  if (cached) { slide.setAttribute('src', 'cached.jpg'); slide.naturalWidth = 1920; slide.complete = true; }
  const nodes = { slide, slideLoading: loading, slideLoadingMessage: message, slideLoadingRetry: retry };
  vm.runInNewContext(source, { document: { getElementById: id => nodes[id] } });
  return { slide, loading, message, retry };
}
test('all roles hide uninitialized image in HTML and include loading before role code', () => {
  for (const role of ['presenter', 'audience', 'screen', 'stage']) {
    const html = fs.readFileSync(path.join(root, 'public', role, 'index.html'), 'utf8');
    assert.match(html, /<img id="slide" class="slide-initial-pending" aria-busy="true"/);
    assert.match(html, /slide-loading.css\?v=1/);
    assert.ok(html.indexOf('slide-loading.js?v=1') < html.indexOf('/' + role + '/' + role + '.js'));
  }
});
test('slow first image stays hidden until decoded', async () => {
  const { slide, loading } = fixture();
  assert.equal(loading.hidden, false);
  slide.src = 'first.jpg'; slide.naturalWidth = 1920;
  let decoded; slide.decode = () => new Promise(resolve => { decoded = resolve; });
  const ready = slide.emit('load'); await Promise.resolve();
  assert.equal(loading.hidden, false); assert.equal(slide.classList.contains('slide-initial-pending'), true);
  decoded(); await ready;
  assert.equal(loading.hidden, true); assert.equal(slide.classList.contains('slide-initial-pending'), false);
  assert.equal(slide.getAttribute('aria-busy'), 'false');
});
test('failure hides broken image and retry reloads current source', async () => {
  const { slide, loading, message, retry } = fixture();
  slide.src = 'failed.jpg'; slide.emit('error');
  assert.equal(retry.hidden, false); assert.equal(message.textContent, 'No se pudo cargar el slide.');
  assert.equal(slide.classList.contains('slide-initial-pending'), true);
  retry.emit('click');
  assert.equal(slide.src, 'failed.jpg'); assert.equal(retry.hidden, true);
  assert.equal(loading.classList.contains('is-error'), false); assert.equal(slide.getAttribute('aria-busy'), 'true');
  slide.naturalWidth = 1920; await slide.emit('load'); assert.equal(loading.hidden, true);
});
test('stale decode cannot reveal newer failed image', async () => {
  const { slide, loading } = fixture();
  slide.src = 'old.jpg'; slide.naturalWidth = 1920;
  let decoded; slide.decode = () => new Promise(resolve => { decoded = resolve; });
  const ready = slide.emit('load'); slide.src = 'new.jpg'; slide.emit('error');
  decoded(); await ready;
  assert.equal(loading.hidden, false); assert.equal(slide.classList.contains('slide-initial-pending'), true);
});
test('cached slides reveal without another load event', async () => {
  const { slide, loading } = fixture(true); await Promise.resolve();
  assert.equal(loading.hidden, true); assert.equal(slide.classList.contains('slide-initial-pending'), false);
});
