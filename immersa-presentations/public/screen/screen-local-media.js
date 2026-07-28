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
    return (Array.isArray(config.videos) ? config.videos : []).filter((video) =>
      video?.slide_id
      && !hidden.has(String(video.slide_id))
      && String(video?.source?.type || video?.provider || '').toLowerCase() !== 'youtube'
    );
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>\"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[char]));
  }

  function candidateValue(candidate) {
    return candidate?.file ? candidate : { file: candidate, handle: null };
  }

  function sameFile(left, right) {
    const leftName = normalizeName(left?.name);
    const rightName = normalizeName(right?.name);
    const leftSize = Number(left?.size) || 0;
    const rightSize = Number(right?.size) || 0;
    return leftName === rightName && (!leftSize || !rightSize || leftSize === rightSize);
  }

  function matchFiles(expectedVideos, files) {
    const pool = Array.from(files || []).map(candidateValue);
    const used = new Set();
    return expectedVideos.map((video) => {
      const expected = video.file || {};
      const sameName = pool.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => !used.has(index) && normalizeName(candidate.file?.name) === normalizeName(expected.name));
      const exact = sameName.find(({ candidate }) => sameFile(candidate.file, expected));
      const selected = exact || sameName[0];
      if (!selected) return { video, file: null, handle: null, status: 'missing' };
      used.add(selected.index);
      return {
        video,
        file: selected.candidate.file,
        handle: selected.candidate.handle || null,
        status: exact ? 'selected' : 'mismatched'
      };
    });
  }

  function isReadyStatus(status) {
    return status === 'ready' || status === 'ready_override';
  }

  function summarize(records) {
    const list = Array.from(records || []);
    return {
      total: list.length,
      ready: list.filter((item) => isReadyStatus(item.status)).length,
      missing: list.filter((item) => item.status === 'missing' || item.status === 'permission_required').length,
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
    const urlApi = options.URL || root.URL;
    const picker = options.showOpenFilePicker || root.showOpenFilePicker?.bind(root);
    const handleStore = options.handleStore || root.ImmersaLocalMediaHandleStore?.createStore?.();
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
    let multiInput = null;
    let singleInput = null;
    let singleTargetSlideId = '';

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

    function findRecord(slideId) {
      return records.find((record) => String(record.video?.slide_id) === String(slideId)) || null;
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
      return ({
        ready: 'Listo',
        ready_override: 'Listo · reemplazo local',
        permission_required: 'Requiere autorización',
        missing: 'Falta',
        mismatched: 'Archivo diferente',
        incompatible: 'Incompatible',
        validating: 'Validando…',
        selected: 'Validando…'
      })[status] || 'Pendiente';
    }

    function pickerOptions(multiple) {
      return {
        multiple: Boolean(multiple),
        types: [{ description: 'Video MP4', accept: { 'video/mp4': ['.mp4'] } }],
        excludeAcceptAllOption: false
      };
    }

    async function pickHandles(multiple) {
      if (!picker) return null;
      try {
        const handles = await picker(pickerOptions(multiple));
        const candidates = [];
        for (const handle of handles || []) {
          const file = await handle.getFile();
          candidates.push({ file, handle });
        }
        return candidates;
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('Unable to select local video', error);
        return [];
      }
    }

    function ensureUi() {
      if (modal) return;
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/screen/screen-local-media.css?v=108';
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
      modal.innerHTML = '<section class="screen-media-modal" role="dialog" aria-modal="true" aria-labelledby="screenMediaTitle"><button class="screen-media-close" type="button" aria-label="Cerrar">×</button><header><span>Multimedia local</span><h2 id="screenMediaTitle">Preparar videos</h2><p>Los vínculos se guardan en esta computadora. Los archivos nunca se suben.</p></header><div class="screen-media-summary"></div><div class="screen-media-list"></div><div class="screen-media-actions"><button type="button" class="screen-media-secondary" data-close>Presentar con posters</button><button type="button" class="screen-media-primary" data-pick>Seleccionar MP4</button></div><input class="screen-media-input" data-multi-input type="file" accept=".mp4,video/mp4" multiple><input class="screen-media-input" data-single-input type="file" accept=".mp4,video/mp4"></section>';
      listNode = modal.querySelector('.screen-media-list');
      summaryNode = modal.querySelector('.screen-media-summary');
      multiInput = modal.querySelector('[data-multi-input]');
      singleInput = modal.querySelector('[data-single-input]');
      modal.querySelector('.screen-media-close').addEventListener('click', closeModal);
      modal.querySelector('[data-close]').addEventListener('click', closeModal);
      modal.querySelector('[data-pick]').addEventListener('click', pickMany);
      multiInput.addEventListener('change', async () => {
        await prepareCandidates(Array.from(multiInput.files || []).map((file) => ({ file, handle: null })));
        multiInput.value = '';
      });
      singleInput.addEventListener('change', async () => {
        const record = findRecord(singleTargetSlideId);
        const file = singleInput.files?.[0];
        singleInput.value = '';
        if (record && file) await prepareRecord(record, file, { handle: null, override: !sameFile(file, record.video.file) });
      });
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

    function actionMarkup(record) {
      const slideId = escapeHtml(record.video?.slide_id || '');
      if (record.status === 'permission_required') {
        return '<button type="button" data-media-action="authorize" data-slide-id="' + slideId + '">Autorizar archivo</button><button type="button" data-media-action="change" data-slide-id="' + slideId + '">Cambiar MP4</button>';
      }
      if (record.status === 'mismatched' && record.file) {
        return '<button type="button" data-media-action="accept" data-slide-id="' + slideId + '">Usar este MP4</button><button type="button" data-media-action="change" data-slide-id="' + slideId + '">Elegir otro</button>';
      }
      const label = isReadyStatus(record.status) ? 'Cambiar MP4' : 'Elegir MP4';
      return '<button type="button" data-media-action="change" data-slide-id="' + slideId + '">' + label + '</button>';
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
        const actual = record.file && !sameFile(record.file, video.file)
          ? '<em>Usando localmente: ' + escapeHtml(record.file.name) + ' · ' + escapeHtml(formatBytes(record.file.size)) + '</em>'
          : '';
        return '<article class="screen-media-item is-' + escapeHtml(record.status) + '"><span class="screen-media-index">' + (index >= 0 ? index + 1 : '—') + '</span><div class="screen-media-copy"><strong>' + escapeHtml(video.file?.name || 'Video') + '</strong><small>Slide ' + (index >= 0 ? index + 1 : 'no encontrada') + ' · ' + escapeHtml(formatBytes(video.file?.size)) + '</small>' + actual + '</div><div class="screen-media-item-state"><b>' + statusLabel(record.status) + '</b><span class="screen-media-row-actions">' + actionMarkup(record) + '</span></div></article>';
      }).join('');
      listNode.querySelectorAll('[data-media-action]').forEach((button) => {
        button.addEventListener('click', async () => {
          const record = findRecord(button.dataset.slideId);
          if (!record) return;
          if (button.dataset.mediaAction === 'change') await pickOne(record);
          if (button.dataset.mediaAction === 'accept' && record.file) await prepareRecord(record, record.file, { handle: record.handle, override: true });
          if (button.dataset.mediaAction === 'authorize') await authorizeRecord(record);
        });
      });
    }

    function reportStatus() {
      const counts = summarize(records);
      liveSocket.emit('media:status_update', {
        deck_id: deckId,
        ...counts,
        items: records.map((record) => ({
          slide_id: String(record.video.slide_id),
          file_name: String(record.video.file?.name || ''),
          status: isReadyStatus(record.status) ? 'ready' : record.status === 'permission_required' ? 'missing' : record.status
        }))
      });
    }

    function revokeSlideUrl(slideId) {
      const key = String(slideId);
      const previous = urls.get(key);
      if (previous) urlApi?.revokeObjectURL?.(previous);
      urls.delete(key);
    }

    async function prepareRecord(record, file, options = {}) {
      if (!record || !file) return;
      record.file = file;
      record.handle = options.handle || record.handle || null;
      record.status = 'validating';
      renderUi();
      const mp4 = /\.mp4$/i.test(String(file.name || '')) || String(file.type || '').toLowerCase() === 'video/mp4';
      if (!mp4 || !urlApi?.createObjectURL) {
        record.status = 'incompatible';
        renderUi();
        reportStatus();
        return;
      }
      revokeSlideUrl(record.video.slide_id);
      const url = urlApi.createObjectURL(file);
      const playable = await validatePlayable(file, url, document);
      if (playable) {
        const override = typeof options.override === 'boolean' ? options.override : !sameFile(file, record.video.file);
        record.status = override ? 'ready_override' : 'ready';
        record.persisted = false;
        urls.set(String(record.video.slide_id), url);
        if (record.handle && options.persist !== false && handleStore?.put) {
          record.persisted = await handleStore.put(deckId, record.video.slide_id, record.handle, file);
        }
      } else {
        record.status = 'incompatible';
        urlApi.revokeObjectURL(url);
      }
      renderUi();
      reportStatus();
      notify();
      if (options.close !== false && summarize(records).ready === records.length && records.length) setTimeout(closeModal, 550);
    }

    async function prepareCandidates(candidates) {
      const matches = matchFiles(expected, candidates);
      for (const match of matches) {
        const record = findRecord(match.video.slide_id);
        if (!record || match.status === 'missing') continue;
        record.file = match.file;
        record.handle = match.handle || null;
        if (match.status === 'mismatched') {
          record.status = 'mismatched';
          continue;
        }
        await prepareRecord(record, match.file, { handle: match.handle, override: false, close: false });
      }
      renderUi();
      reportStatus();
      notify();
      if (summarize(records).ready === records.length && records.length) setTimeout(closeModal, 550);
    }

    async function pickMany() {
      const candidates = await pickHandles(true);
      if (candidates === null) {
        multiInput.click();
        return;
      }
      if (candidates.length) await prepareCandidates(candidates);
    }

    async function pickOne(record) {
      const candidates = await pickHandles(false);
      if (candidates === null) {
        singleTargetSlideId = String(record.video.slide_id);
        singleInput.click();
        return;
      }
      const candidate = candidates[0];
      if (candidate?.file) await prepareRecord(record, candidate.file, { handle: candidate.handle, override: !sameFile(candidate.file, record.video.file) });
    }

    async function authorizeRecord(record) {
      if (!record?.binding || !handleStore?.read) return pickOne(record);
      const restored = await handleStore.read(record.binding, { request: true });
      if (restored.status === 'file') {
        await prepareRecord(record, restored.file, { handle: restored.handle, override: !sameFile(restored.file, record.video.file), persist: false });
      } else {
        record.status = 'permission_required';
        renderUi();
        reportStatus();
      }
    }

    async function restoreBindings() {
      if (!handleStore?.supported?.() || !handleStore.getDeck) return;
      const bindings = await handleStore.getDeck(deckId);
      const bySlide = new Map((bindings || []).map((binding) => [String(binding.slide_id), binding]));
      for (const record of records) {
        const binding = bySlide.get(String(record.video.slide_id));
        if (!binding) continue;
        record.binding = binding;
        record.handle = binding.handle || null;
        record.file = binding.file || null;
        const restored = await handleStore.read(binding, { request: false });
        if (restored.status === 'file') {
          await prepareRecord(record, restored.file, { handle: restored.handle, override: !sameFile(restored.file, record.video.file), persist: false, close: false });
        } else if (restored.status === 'permission_required') {
          record.status = 'permission_required';
        } else {
          record.status = 'missing';
          await handleStore.remove?.(deckId, record.video.slide_id);
        }
      }
      renderUi();
      reportStatus();
      notify();
    }

    async function loadConfig() {
      const response = await fetchFn('/api/decks/' + encodeURIComponent(deckId) + '/interactions', { cache: 'no-store' });
      config = response.ok ? await response.json() : {};
      expected = activeVideos(config);
      records = expected.map((video) => ({ video, file: null, handle: null, binding: null, status: 'missing', persisted: false }));
      ensureUi();
      renderUi();
      await restoreBindings();
      reportStatus();
      if (records.length && summarize(records).ready !== records.length) setTimeout(openModal, 150);
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

  return { stableSlideId, activeVideos, normalizeName, escapeHtml, sameFile, matchFiles, isReadyStatus, summarize, formatBytes, validatePlayable, createManager, autoMount };
});
