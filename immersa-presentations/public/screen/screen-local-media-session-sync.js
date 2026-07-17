(function (root) {
  const liveSocket = typeof socket !== 'undefined' ? socket : root.socket;
  if (!liveSocket || root.__immersaScreenMediaSessionSync) return;
  root.__immersaScreenMediaSessionSync = true;

  function summarize(records) {
    const list = Array.from(records || []);
    return {
      total: list.length,
      ready: list.filter((item) => item.status === 'ready').length,
      missing: list.filter((item) => item.status === 'missing').length,
      mismatched: list.filter((item) => item.status === 'mismatched').length,
      incompatible: list.filter((item) => item.status === 'incompatible').length,
      validating: list.filter((item) => item.status === 'validating' || item.status === 'selected').length
    };
  }

  function report(attempt = 0) {
    const registry = root.ImmersaLocalMedia;
    const config = registry?.getConfig?.() || {};
    if (!Array.isArray(config.slides) || (!config.slides.length && attempt < 12)) {
      setTimeout(() => report(attempt + 1), 350);
      return;
    }
    const records = registry?.getRecords?.() || [];
    liveSocket.emit('media:status_update', {
      deck_id: registry?.deckId || '',
      ...summarize(records),
      items: records.map((record) => ({
        slide_id: String(record.video?.slide_id || ''),
        file_name: String(record.video?.file?.name || ''),
        status: String(record.status || 'missing')
      }))
    });
  }

  let joined = false;
  liveSocket.on('presentation_state', () => {
    if (joined) return;
    joined = true;
    report();
  });
})(window);
