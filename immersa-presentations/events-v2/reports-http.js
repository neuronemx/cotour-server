const { EventAccessError, accountActor } = require('./authorization');
function attachEventReports(router, reports, eventPath) {
  if (!reports) return;
  const path = eventPath + '/live-sessions/:liveId';
  const handle = (family, exportCsv = false) => async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new EventAccessError('ORIGIN_DENIED');
      const result = await reports.read({ actor: accountActor(req), organizationId: req.params.orgId, eventId: req.params.eventId,
        liveId: req.params.liveId, family, executionId: req.params.executionId || null, exportCsv, query: req.query });
      if (!exportCsv) return res.json(result);
      res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.set('X-Report-Row-Count', String(result.rowCount));
      if (result.nextAfter) res.set('X-Report-Next-After', result.nextAfter);
      if (result.nextOffset !== null) res.set('X-Report-Next-Offset', String(result.nextOffset));
      return res.type('text/csv; charset=utf-8').send(result.csv);
    } catch (error) {
      if (error instanceof EventAccessError) return res.status(error.statusCode).json({ code: error.code });
      console.error('[events-v2] report unavailable', { code: error.code || 'UNKNOWN' });
      return res.status(503).json({ code: 'AUTHORIZATION_UNAVAILABLE' });
    }
  };
  router.get(path + '/qna/history', handle('qna'));
  router.get(path + '/qna/export.csv', handle('qna', true));
  router.get(path + '/knowledge/history', handle('knowledge'));
  router.get(path + '/knowledge/:executionId/results', handle('knowledge'));
  router.get(path + '/knowledge/:executionId/export.csv', handle('knowledge', true));
  router.get(path + '/reactions', handle('reactions'));
  router.get(path + '/reactions/export.csv', handle('reactions', true));
}
module.exports = { attachEventReports };
