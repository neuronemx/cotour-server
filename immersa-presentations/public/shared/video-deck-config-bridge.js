(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImmersaVideoDeckBridge = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  function roleFromPath(pathname) {
    const path = String(pathname || '');
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(path)) return 'presenter';
    if (/^\/stage(?:\/|$)/.test(path)) return 'stage';
    if (/^\/(?:screen|viewer)(?:\/|$)/.test(path)) return 'screen';
    if (/^\/(?:audience|p_)/.test(path)) return 'audience';
    return '';
  }

  function stableSlideId(slide, index) {
    return String(slide?.id || 'slide-' + String(index + 1).padStart(3, '0'));
  }

  function activeVideoConfigs(config = {}) {
    const hidden = new Set(Array.isArray(config.hidden_slide_ids) ? config.hidden_slide_ids.map(String) : []);
    return (Array.isArray(config.videos) ? config.videos : []).filter((video) => video?.slide_id && !hidden.has(String(video.slide_id)));
  }

  function isYouTubeConfig(video) {
    return String(video?.source?.type || video?.provider || '').toLowerCase() === 'youtube'
      && /^[a-z0-9_-]{11}$/i.test(String(video?.source?.video_id || ''));
  }

  function activeLocalVideoConfigs(config = {}) {
    return activeVideoConfigs(config).filter((video) => !isYouTubeConfig(video));
  }

  function augmentManifest(manifest = {}, config = {}) {
    const videos = new Map(activeVideoConfigs(config).map((video) => [String(video.slide_id), video]));
    const slides = Array.isArray(manifest.slides) ? manifest.slides : [];
    return {
      ...manifest,
      slides: slides.map((slide, index) => {
        const id = stableSlideId(slide, index);
        const video = videos.get(id);
        if (!video) return slide;
        const playback = video.playback || {};
        const youtube = isYouTubeConfig(video);
        const originalIsVideo = String(slide?.type || '').toLowerCase() === 'video' || /\.mp4(?:$|[?#])/i.test(String(slide?.src || ''));
        return {
          ...slide,
          id,
          slide_id: id,
          type: 'video',
          src: youtube ? String(video.source.url || '') : originalIsVideo ? slide.src : String(video.remote_src || ''),
          poster: slide.poster || slide.src || slide.thumb || '',
          thumb: slide.thumb || slide.src || slide.poster || '',
          autoplay: playback.autoplay !== false,
          muted: Boolean(playback.muted),
          loop: playback.end_behavior === 'loop',
          endBehavior: playback.end_behavior || 'stay',
          expectedFile: video.file || null,
          localOnly: !youtube && !originalIsVideo && !video.remote_src,
          videoProvider: youtube ? 'youtube' : 'local',
          youtubeVideoId: youtube ? String(video.source.video_id) : '',
          youtubeStartSeconds: youtube ? Math.max(0, Number(video.source.start_seconds) || 0) : 0
        };
      })
    };
  }

  function manifestRequestMatches(input, deckId, location) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, location?.origin || 'http://localhost');
      return decodeURIComponent(url.pathname) === '/decks/' + String(deckId) + '/manifest.json';
    } catch (_error) {
      return false;
    }
  }

  function installFetchBridge({ root: target = root, deckId, fetchFn } = {}) {
    if (!target || !deckId) return null;
    const nativeFetch = fetchFn || target.fetch?.bind(target);
    if (!nativeFetch) return null;
    if (target.__immersaVideoDeckFetchBridge) return target.__immersaVideoDeckFetchBridge;

    const configPromise = nativeFetch('/api/decks/' + encodeURIComponent(deckId) + '/interactions', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));

    const bridgedFetch = async function (input, init) {
      const response = await nativeFetch(input, init);
      if (!manifestRequestMatches(input, deckId, target.location)) return response;
      try {
        const manifest = await response.clone().json();
        const config = await configPromise;
        const augmented = augmentManifest(manifest, config);
        return new Response(JSON.stringify(augmented), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch (_error) {
        return response;
      }
    };

    target.fetch = bridgedFetch;
    target.__immersaVideoDeckFetchBridge = { nativeFetch, configPromise, bridgedFetch };
    return target.__immersaVideoDeckFetchBridge;
  }

  function loadStyle(document) {
    if (!document || document.querySelector('link[data-video-deck-bridge]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/shared/video-deck-config-bridge.css?v=108';
    link.dataset.videoDeckBridge = '1';
    document.head.appendChild(link);
  }

  function loadRuntime(document) {
    if (!document || root.ImmersaVideoSlides || root.__immersaVideoSlidesLoading) return;
    root.__immersaVideoSlidesLoading = true;
    const script = document.createElement('script');
    script.src = '/shared/video-slide-runtime.js?v=112';
    script.defer = true;
    script.onerror = () => { root.__immersaVideoSlidesLoading = false; };
    document.head.appendChild(script);
  }

  function createStatusBadge({ document, role, configPromise, socket: liveSocket } = {}) {
    if (!document || (role !== 'presenter' && role !== 'stage')) return null;
    const badge = document.createElement('div');
    badge.className = 'immersa-media-status is-pending';
    badge.hidden = true;
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-live', 'polite');
    document.body.appendChild(badge);

    let total = 0;
    let lastPresentationState = null;
    let lastMediaStatus = null;

    function render() {
      if (!total) {
        badge.hidden = true;
        return;
      }
      badge.hidden = false;
      const screenConnected = Boolean(lastPresentationState?.screenConnected);
      const status = lastMediaStatus;
      badge.className = 'immersa-media-status';
      if (!screenConnected) {
        badge.classList.add('is-warning');
        badge.textContent = 'Screen desconectada · ' + total + ' video' + (total === 1 ? '' : 's');
        return;
      }
      if (!status || Number(status.total) !== total) {
        badge.classList.add('is-pending');
        badge.textContent = 'Preparar multimedia · 0/' + total;
        return;
      }
      const ready = Number(status.ready) || 0;
      if (ready === total && !status.mismatched && !status.incompatible && !status.missing) {
        badge.classList.add('is-ready');
        badge.textContent = 'Multimedia lista · ' + ready + '/' + total;
      } else {
        badge.classList.add('is-error');
        badge.textContent = 'Multimedia incompleta · ' + ready + '/' + total;
      }
      const details = Array.isArray(status.items)
        ? status.items.filter((item) => item.status !== 'ready').map((item) => (item.file_name || item.slide_id) + ': ' + item.status).join('\n')
        : '';
      badge.title = details;
    }

    Promise.resolve(configPromise).then((config) => {
      total = activeLocalVideoConfigs(config).length;
      render();
    });
    liveSocket?.on?.('presentation_state', (state) => {
      lastPresentationState = state || {};
      render();
    });
    liveSocket?.on?.('media:status', (status) => {
      lastMediaStatus = status || null;
      render();
    });
    liveSocket?.on?.('media:advance_request', ({ slideIndex, nextSlideIndex } = {}) => {
      if (!lastPresentationState) return;
      const current = Number(lastPresentationState.presenterSlideIndex ?? lastPresentationState.slideIndex);
      if (Number(slideIndex) !== current) return;
      if (role === 'stage' && lastPresentationState.presenterConnected) return;
      const next = Number(nextSlideIndex);
      if (!Number.isFinite(next) || next <= current) return;
      liveSocket.emit('slide_go', { slideIndex: next });
    });
    return badge;
  }

  function autoMount() {
    if (!root.document || root.__immersaVideoDeckBridgeMounted) return null;
    root.__immersaVideoDeckBridgeMounted = true;
    const params = new URLSearchParams(root.location?.search || '');
    const context = root.IMMERSA_ROLE_OPEN || root.IMMERSA_PUBLIC_OPEN || {};
    const deckId = params.get('deck') || context.deck || context.deckId || 'demo';
    const role = roleFromPath(root.location?.pathname || '');
    const bridge = installFetchBridge({ root, deckId });
    loadStyle(root.document);
    const liveSocket = typeof socket !== 'undefined' ? socket : root.socket;
    createStatusBadge({ document: root.document, role, configPromise: bridge?.configPromise, socket: liveSocket });
    loadRuntime(root.document);
    return bridge;
  }

  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();

  return { roleFromPath, stableSlideId, activeVideoConfigs, activeLocalVideoConfigs, isYouTubeConfig, augmentManifest, manifestRequestMatches, installFetchBridge, autoMount };
});
