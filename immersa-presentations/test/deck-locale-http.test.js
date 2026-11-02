const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { requireLocaleWriteOrigin } = require('../deck-locale-http');

test('locale writes require the current host and reject foreign or missing origins before mutation', async (t) => {
  const app = express();
  let writes = 0;
  for (const method of ['post', 'patch', 'delete']) {
    app[method]('/locales/en', requireLocaleWriteOrigin, (_req, res) => {
      writes++;
      res.json({ ok: true });
    });
  }
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    for (const headers of [
      {},
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { origin: 'file://' + server.address().address },
      { origin: base, 'sec-fetch-site': 'cross-site' }
    ]) {
      const response = await fetch(base + '/locales/en', { method, headers });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'ORIGIN_DENIED');
    }
    assert.equal(writes, ['POST', 'PATCH', 'DELETE'].indexOf(method));
    const response = await fetch(base + '/locales/en', {
      method, headers: { origin: base, 'sec-fetch-site': 'same-origin' }
    });
    assert.equal(response.status, 200);
  }
  assert.equal(writes, 3);
});
