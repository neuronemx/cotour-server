(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImmersaScreenLocalMedia = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  function stableSlideId(slide, index) {
    return String(slide?.id || 'slide-' + String(index + 1).padStart(3, '0'));
  }

  function activeVideos(config = {}) {
    const hidden = new Set(Array.isArray(config.hidden_slide_ids) ? config.hidden_slide_ids.map(String) : []);
    return (Array.isArray(config.videos) ? config.videos : []).filter((video) => video?.slide_id && !hidden.has(String(video.slide_id)));
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[char]));
  }

  function matchFiles(expectedVideos, files) {
    const pool = Array.from(files || []);
    return expectedVideos.map((video) => {
      const expected = video.file || {};
      const matches = pool.filter((file) => normalizeName(file.name) === normalizeName(expected.name));
      const exact = matches.find((file) => !expected.size || Number(file.size) === Number(expected.size));
      if (exact) return { video, file: exact, status: 'selected' };
      if (matches.length) return { video, file: matches[0], status: 'mismatched' };
      return { video, file: null, status: 'missing' };
    });
  }

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

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (!bytes) return 'Tamaño no registrado';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, index)).toFixed(index > 1 ? 1 : 0) + ' ' + units[index];
  }

  function validatePlayable(file, url, document, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeAttribute('src');
        video.load?.();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      video.preload = 'metadata';
      video.muted = true;
      video.addEventListener('loadedmetadata', () => finish(Boolean(video.videoWidth || video.duration)), { once: true });
      video.addEventListener('error', () => finish(false), { once: true });
      video.src = url;
      video.load();
    });
  }

  function createManager(options = {}) {
    const document = options.document || root.document;
    const location = options.location || root.location || {};
    const fetchFn = options.fetch || root.fetch?.bind(root);
    const liveSocket = options.socket || (typeof socket !== 'undefined' ? socket : root.socket);
    if (!document || !fetchFn || !liveSocket) return null;

    const params = new URLSearchParams(location.search || '');
    const context = root.IMMERSA_ROLE_OPEN || {};
    const sessionId = params.get('session') || context.session || context.session_id || 'demo01';
    const deckId = params.get('deck') || context.deck || context.deckId || 'demo';
    const screenRoot = document.getElementById('screen') || document.body;
    const urls = new Map();
    const listeners = new Set();
    let config = { videos: [], hidden_slide_ids: [], slides: [] };
    let expected = [];
    let records = [];
    let lastState = null;
    let modal = null;
    let pill = null;
    let listNode = null;
    let summaryNode = null;
    let input = null;

    function notify() {
      listeners.forEach((listener) => {
        try { listener(); } catch (_error) {}
      });
    }

    function getUrl(slideId) {
      return urls.get(String(slideId)) || '';
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function nextVisibleIndex(index) {
      const hidden = new Set((config.hidden_slide_ids || []).map(String));
      const slides = config.slides || [];
      for (let cursor = Number(index) + 1; cursor < slides.length; cursor += 1) {
        if (!hidden.has(stableSlideId(slides[cursor], cursor))) return cursor;
      }
      return Number(index);
    }

    function handleEnded({ slideIndex, item } = {}) {
      if (String(item?.endBehavior || '') !== 'next') return;
      const nextSlideIndex = nextVisibleIndex(slideIndex);
      if (nextSlideIndex <= Number(slideIndex)) return;
      liveSocket.emit('media:advance_request', { slideIndex: Number(slideIndex), nextSlideIndex });
    }

    function statusLabel(status) {
      return ({ ready: 'Listo', missing: 'Falta', mismatched: 'Archivo diferente', incompatible: 'Incompatible', validating: 'Validando…', selected: 'Validando…' })[status] || 'Pendiente';
    }

    function ensureUi() {
      if (modal) return;
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/screen/screen-local-media.css?v=107';
      style.dataset.screenLocalMedia = '1';
      document.head.appendChild(style);

      pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'screen-media-pill';
      pill.hidden = true;
      pill.addEventListener('click', () => openModal());

      modal = document.createElement('div');
      modal.className = 'screen-media-backdrop';
      modal.hidden = true;
      modal.innerHTML = '<section class="screen-media-modal" role="dialog" aria-modal="true" aria-labelledby="screenMediaTitle"><button class="screen-media-close" type="button" aria-label="Cerrar">×</button><header><span>Multimedia local</span><h2 id="screenMediaTitle">Preparar videos</h2><p>Selecciona los MP4 configurados para este deck. Los archivos no se suben.</p></header><div class="screen-media-summary"></div><div class="screen-media-list"></div><div class="screen-media-actions"><button type="button" class="screen-media-secondary" data-close>Presentar con posters</button><button type="button" class="screen-media-primary" data-pick>Seleccionar MP4</button></div><input class="screen-media-input" type="file" accept=".mp4,video/mp4" multiple></section>';
      listNode = modal.querySelector('.screen-media-list');
      summaryNode = modal.querySelector('.screen-media-summary');
      input = modal.querySelector('.screen-media-input');
      modal.querySelector('.screen-media-close').addEventListener('click', closeModal);
      modal.querySelector('[data-close]').addEventListener('click', closeModal);
      modal.querySelector('[data-pick]').addEventListener('click', () => input.click());
      input.addEventListener('change', () => prepareFiles(input.files));
      modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
      screenRoot.append(pill, modal);
    }

    function openModal() {
      ensureUi();
      modal.hidden = false;
      renderUi();
    }

    function closeModal() {
      if (modal) modal.hidden = true;
    }

    function renderUi() {
      ensureUi();
      const counts = summarize(records);
      pill.hidden = counts.total === 0;
      pill.className = 'screen-media-pill ' + (counts.ready === counts.total && counts.total ? 'is-ready' : counts.ready ? 'is-warning' : 'is-pending');
      pill.textContent = 'Multimedia ' + counts.ready + '/' + counts.total;
      summaryNode.className = 'screen-media-summary ' + (counts.ready === counts.total && counts.total ? 'is-ready' : counts.incompatible || counts.mismatched || counts.missing ? 'is-error' : '');
      summaryNode.textContent = counts.total
        ? (counts.ready === counts.total ? 'Multimedia lista para presentar' : counts.ready + ' de ' + counts.total + ' videos disponibles')
        : 'Este deck no tiene videos activos';
      listNode.innerHTML = records.map((record) => {
        const video = record.video;
        const index = (config.slides || []).findIndex((slide, slideIndex) => stableSlideId(slide, slideIndex) === String(video.slide_id));
        return '<article class="screen-media-item is-' + record.status + '"><span class="screen-media-index">' + (index >= 0 ? index + 1 : '—') + '</span><div><strong>' + escapeHtml(video.file?.name || 'Video') + '</strong><small>Slide ' + (index >= 0 ? index + 1 : 'no encontrada') + ' · ' + escapeHtml(formatBytes(video.file?.size)) + '</small></div><b>' + statusLabel(record.status) + '</b></article>';
      }).join('');
    }

    function reportStatus() {
      const counts = summarize(records);
      liveSocket.emit('media:status_update', {
        deck_id: deckId,
        ...counts,
        items: records.map((record) => ({
          slide_id: String(record.video.slide_id),
          file_name: String(record.video.file?.name || ''),
          status: record.status
        }))
      });
    }

    async function prepareFiles(files) {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
      records = matchFiles(expected, files);
      renderUi();
      for (const record of records) {
        if (record.status !== 'selected' || !record.file) continue;
        record.status = 'validating';
        renderUi();
        const url = URL.createObjectURL(record.file);
        const playable = await validatePlayable(record.file, url, document);
        if (playable) {
          record.status = 'ready';
          urls.set(String(record.video.slide_id), url);
        } else {
          record.status = 'incompatible';
          URL.revokeObjectURL(url);
        }
      }
      renderUi();
      reportStatus();
      notify();
      if (summarize(records).ready === records.length && records.length) setTimeout(closeModal, 550);
    }

    async function loadConfig() {
      const response = await fetchFn('/api/decks/' + encodeURIComponent(deckId) + '/interactions', { cache: 'no-store' });
      config = response.ok ? await response.json() : {};
      expected = activeVideos(config);
      records = expected.map((video) => ({ video, file: null, status: 'missing' }));
      ensureUi();
      renderUi();
      reportStatus();
      if (records.length) setTimeout(openModal, 150);
      return config;
    }

    liveSocket.on('presentation_state', (state) => {
      lastState = state || {};
      if (Array.isArray(config.slides) && config.slides.length) reportStatus();
    });
    loadConfig().catch((error) => console.warn('Unable to prepare local multimedia', error.message));

    const registry = { deckId, sessionId, getUrl, subscribe, handleEnded, nextVisibleIndex, getConfig: () => config, getRecords: () => records, open: openModal, getState: () => lastState };
    root.ImmersaLocalMedia = registry;
    return registry;
  }

  function autoMount() {
    if (!root.document || root.__immersaScreenLocalMediaMounted) return root.ImmersaLocalMedia || null;
    root.__immersaScreenLocalMediaMounted = true;
    return createManager();
  }

  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();

  return { stableSlideId, activeVideos, normalizeName, escapeHtml, matchFiles, summarize, formatBytes, validatePlayable, createManager, autoMount };
});
