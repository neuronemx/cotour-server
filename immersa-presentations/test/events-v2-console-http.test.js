const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createEventConsolePages } = require('../events-v2/console-http');

test('console pages are generic, flag-gated and isolated from legacy paths and public static files', async t => {
  const app = express(); let enabled = false;
  app.use('/events-v2', createEventConsolePages({ enabled: () => enabled }));
  app.use('/events-v2', (_req, res) => res.status(200).send('PUBLIC_SCRIPT_SENTINEL'));
  app.get('/speaker', (_req, res) => res.send('LEGACY_SPEAKER_SENTINEL'));
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const e = '00000000-0000-4000-8000-000000000001', g = '00000000-0000-4000-8000-000000000002';
  const path = `/events-v2/console/stage/${e}/${g}`;
  const off = await fetch(base + path); assert.equal(off.status, 404); assert.deepEqual(await off.json(), { code: 'EVENTS_V2_DISABLED' });
  enabled = true;
  for (const view of ['stage', 'speaker', 'screen', 'audience']) {
    const page = await fetch(base + path.replace('/stage/', '/' + view + '/'));
    assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(page.headers.get('content-security-policy'), /media-src 'self'; img-src 'self'/);
    assert.equal(page.headers.get('content-security-policy').includes('unsafe-inline'),false);
    const body = await page.text(); assert.match(body, /Verificando acceso/); assert.match(body, /access-client\.js/);
    assert.equal(body.includes('join_presentation'), false); assert.equal(body.includes(e), false); assert.equal(body.includes(g), false);
  }
  for (const path of [`/events-v2/console/venue/${e}/${g}`, '/events-v2/console/index.html',
    `/events-v2/console/stage/no-id/${g}`, `/events-v2/console/stage/${e}/${g}?token=PRIVATE_TOKEN`]) {
    const response = await fetch(base + path); assert.equal(response.status, 404); assert.equal((await response.text()).includes('PRIVATE_TOKEN'), false);
  }
  assert.equal(await (await fetch(base + '/events-v2/access-client.js')).text(), 'PUBLIC_SCRIPT_SENTINEL');
  assert.equal(await (await fetch(base + '/speaker')).text(), 'LEGACY_SPEAKER_SENTINEL');
});


test('Stage start readiness rejects version bindings including cleared tombstones despite legacy approval', async () => {
  const { consoleTargets } = require('../events-v2/console-http');
  const ready = { activityId: 'activity', stageId: 'stage', title: 'Prepared', stageTitle: 'Stage',
    accessLevel: 'FREE', activityStatus: 'SCHEDULED', liveSessionId: null, deck_id: 'legacy', deck_check_status: 'DECK_CHECK' };
  const context = { eventId: 'event', kind: 'STAGE', purpose: 'live' };
  for (const has_version_binding of [0, 1]) {
    const targets = await consoleTargets({ rows: async () => [{ ...ready, has_version_binding }] }, {}, context);
    assert.equal(targets[0].canStart, has_version_binding === 0);
  }
});
