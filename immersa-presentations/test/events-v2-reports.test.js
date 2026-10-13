const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { EventAccessError, requireCapability } = require('../events-v2/authorization');
const { EventReportsRepository, csvCell, pagination, definitionDTO, resultRowDTO } = require('../events-v2/reports-repository');
const { attachEventReports } = require('../events-v2/reports-http');

test('Events report CSV protects complete fields, formulas, Unicode and exact large counts; JSON text is unchanged', () => {
  assert.equal(csvCell('Ana,"東京"\nDos'), '"Ana,""東京""\nDos"');
  for (const text of ['=1+2', '+SUM(1)', '-1+2', '@SUM(1)', '  =1', '＝1', '＠SUM(1)', '\t=1', '\r=1', '\n=1', '18446744073709551615']) {
    const original = text; assert.equal(csvCell(text), '"\t' + text.replace(/"/g, '""') + '"'); assert.equal(text, original);
  }
  assert.equal(csvCell(123), '"123"'); assert.equal(csvCell(null), '""');
});

test('Report capabilities never follow operational roles; page inputs cannot select identities, resources or arbitrary paths', () => {
  for (const capability of ['event.metrics.read', 'event.metrics.export']) {
    requireCapability({ roles: ['ADMIN'] }, capability);
    for (const role of ['PRODUCER', 'STAGE', 'SPEAKER', 'PLAYER', 'PARTICIPANT', 'platform']) assert.throws(() => requireCapability({ roles: [role] }, capability), { statusCode: 403 });
  }
  assert.deepEqual(pagination({ limit: '1', offset: '0' }, 'offset'), { limit: 1, offset: 0, after: null });
  for (const query of [{ limit: '501' }, { limit: '0' }, { limit: '1.5' }, { limit: ['1', '2'] }, { after: '../private' }, { participantId: 'x' }, { role: 'ADMIN' }, { eventId: 'B' }]) assert.throws(() => pagination(query), { code: 'INVALID_REPORT_QUERY' });
  assert.throws(() => pagination({ limit: '1' }, 'none'), { code: 'INVALID_REPORT_QUERY' });
});

test('Knowledge report projections omit recovery secrets, attempts, participant IDs and answer keys', () => {
  const definition = definitionDTO({ private: 'SECRET', questions: [{ id: 'q', prompt: 'Q', correctOptionId: 'yes', options: [{ id: 'yes', label: 'Sí', correct: true }, { id: 'no', label: 'No' }] }] });
  const row = resultRowDTO({ participantId: crypto.randomUUID(), label: '=Alice', state: 'COMPLETED', recoveryTokenHash: 'SECRET', activeTabId: 'SECRET',
    correctCount: 1, incorrectCount: 0, omittedCount: 0, totalQuestions: 1, correctTimeMs: 0, timeUsedMs: 500, grade: 100,
    answers: [{ questionId: 'q', optionId: 'yes', correct: true, correctOptionId: 'yes', clientAttemptId: 'SECRET' }] }, definition, 'assessment');
  const json = JSON.stringify({ definition, row }); assert.equal(json.includes('SECRET'), false); assert.equal(json.includes('participantId'), false); assert.equal(json.includes('correctOptionId'), false); assert.equal(row.label, '=Alice');
});

test('A failed authorization commit, disabled feature or role denial cannot send a report or cache conditional success', async t => {
  const ids = { organizationId: crypto.randomUUID(), eventId: crypto.randomUUID(), liveId: crypto.randomUUID() };
  let failure = true, enabled = true, privateReads = 0, denied = false;
  const db = { execute: async sql => { privateReads++; if (sql.includes('FROM event_live_sessions')) return [[{ id: ids.liveId, deck_id: 'private', event_stage_id: crypto.randomUUID(), event_activity_id: crypto.randomUUID() }]]; if (sql.includes('FROM event_v2_reaction_counts')) return [[]]; throw new Error('unexpected SQL'); } };
  const domain = { event: async () => { if (denied) throw new EventAccessError('EVENT_PERMISSION_DENIED'); }, audit: async () => {}, transaction: async (_actor, _action, operation) => { const value = await operation(db); if (failure) throw new Error('DB_PASSWORD_PRIVATE'); return value; } };
  const reports = new EventReportsRepository({ domain, enabled: () => enabled });
  const app = express(), router = express.Router(); router.use((req, _res, next) => { req.accountContext = { user: { id: 'verified-test-account' } }; next(); });
  attachEventReports(router, reports, '/organizations/:orgId/events/:eventId'); app.use('/api/events-v2', router);
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const path = `http://127.0.0.1:${server.address().port}/api/events-v2/organizations/${ids.organizationId}/events/${ids.eventId}/live-sessions/${ids.liveId}/reactions/export.csv`;
  let response = await fetch(path, { headers: { 'If-None-Match': '"cached-private"' } }); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { code: 'AUTHORIZATION_UNAVAILABLE' }); assert.equal(response.headers.get('content-disposition'), null);
  failure = false; response = await fetch(path); assert.equal(response.status, 200); assert.match(await response.text(), /Corazones/); assert.equal(response.headers.get('cache-control'), 'no-store');
  const before = privateReads; denied = true; response = await fetch(path); assert.equal(response.status, 403); assert.equal(privateReads, before);
  enabled = false; response = await fetch(path); assert.equal(response.status, 404); assert.equal(privateReads, before);
});
