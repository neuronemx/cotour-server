(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ImmersaVideoSlides = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const VIDEO_RE = /\.mp4(?:$|[?#])/i;

  function roleFromPath(pathname) {
    const path = String(pathname || '');
    if (/^\/(?:speaker|presenter)(?:\/|$)/.test(path)) return 'presenter';
    if (/^\/stage(?:\/|$)/.test(path)) return 'stage';
    if (/^\/(?:screen|viewer)(?:\/|$)/.test(path)) return 'screen';
    if (/^\/(?:audience|p_)/.test(path)) return 'audience';
    return '';
  }

  function isVideoSlide(item) {
    return Boolean(item && (String(item.type || '').toLowerCase() === 'video' || VIDEO_RE.test(String(item.src || ''))));
  }

  function posterPath(item) {
    return String(item?.poster || item?.thumb || item?.fallback || '').trim();
  }

  function assetUrl(deckId, value) {
    const path = String(value || '').trim();
    if (!path) return '';
    if (/^(?:https?:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('/')) return path;
    return '/decks/' + encodeURIComponent(deckId) + '/' + path.replace(/^\/+/, '');
  }

  function defaultMediaState(item, slideIndex) {
    return {
      slideIndex,
      playing: item?.autoplay !== false,
      muted: Boolean(item?.muted),
      command: 'enter',
      revision: 0
    };
  }

  function effectiveMediaState(state, item, slideIndex) {
    const remote = state?.overlays?.videoMedia;
    if (remote && Number(remote.slideIndex) === slideIndex) {
      return {
        ...defaultMediaState(item, slideIndex),
        ...remote,
        slideIndex,
        playing: remote.playing !== false,
        muted: Boolean(remote.muted)
      };
    }
    return defaultMediaState(item, slideIndex);
  }

  function currentIndex(role, state) {
    if (role === 'screen' || role === 'audience') return Number(state?.liveSlideIndex ?? state?.slideIndex ?? 0);
    return Number(state?.presenterSlideIndex ?? state?.slideIndex ?? 0);
  }

  function loadStyle(document) {
    if (!document || document.querySelector('link[data-video-slide-runtime]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/shared/video-slide-runtime.css?v=103';
    link.dataset.videoSlideRuntime = '1';
    document.head.appendChild(link);
  }

  function createRuntime(options = {}) {
    const document = options.document || root.document;
    const location = options.location || root.location || {};
    const role = options.role || roleFromPath(location.pathname);
    if (!document || !role) return null;

    const mainSocket = options.socket || (typeof socket !== 'undefined' ? socket : root.socket);
    if (!mainSocket) return null;

    const params = new URLSearchParams(location.search || '');
    const roleContext = root.IMMERSA_ROLE_OPEN || root.IMMERSA_PUBLIC_OPEN || {};
    const sessionId = params.get('session') || roleContext.session || roleContext.session_id || 'demo01';
    const deckId = params.get('deck') || roleContext.deck || roleContext.deckId || 'demo';
    const fetchFn = options.fetch || root.fetch?.bind(root);
    if (!fetchFn) return null;

    let manifest = null;
    let pendingState = null;
    let lastState = null;
    let activeIndex = -1;
    let activeItem = null;
    let video = null;
    let controls = null;
    let unlockButton = null;
    let lastAppliedRevision = null;
    let lastInitializedIndex = -1;
    let presenterControlJoined = false;

    const controlSocket = role === 'presenter'
      ? (options.controlSocket || (typeof overlaySocket !== 'undefined' ? overlaySocket : (root.io ? root.io() : mainSocket)))
      : mainSocket;

    loadStyle(document);

    function slideElement() {
      return document.getElementById('slide');
    }

    function hostElement() {
      if (role === 'presenter') return document.querySelector('.stream-area');
      if (role === 'stage') return document.querySelector('.screen-frame');
      if (role === 'screen') return document.getElementById('screen');
      return document.getElementById('slideViewport') || document.getElementById('viewer');
    }

    function ensurePresenterControlJoin() {
      if (role !== 'presenter' || presenterControlJoined || !controlSocket) return;
      controlSocket.emit('join_presentation', { session: sessionId, deck: deckId, role: 'stage' });
      presenterControlJoined = true;
    }

    function emitMedia(patch) {
      if (role !== 'presenter' && role !== 'stage') return;
      if (role === 'presenter') ensurePresenterControlJoin();
      const base = effectiveMediaState(lastState, activeItem, activeIndex);
      const next = {
        ...base,
        ...patch,
        slideIndex: activeIndex,
        revision: Date.now()
      };
      controlSocket.emit('overlay_update', { overlays: { videoMedia: next } });
    }

    function patchPoster(_index, item) {
      const image = slideElement();
      const poster = assetUrl(deckId, posterPath(item));
      if (image && poster) {
        image.src = poster;
        image.style.visibility = '';
      }
      document.querySelectorAll('.thumb img').forEach((node, thumbIndex) => {
        const slide = manifest?.slides?.[thumbIndex];
        if (isVideoSlide(slide)) {
          const thumbPoster = assetUrl(deckId, posterPath(slide));
          if (thumbPoster) node.src = thumbPoster;
        }
      });
    }

    function ensureVideo() {
      if (video) return video;
      const host = hostElement();
      if (!host) return null;
      video = document.createElement('video');
      video.className = 'immersa-video-slide';
      video.dataset.videoSlide = '1';
      video.preload = 'auto';
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      host.appendChild(video);
      return video;
    }

    function removeUnlock() {
      unlockButton?.remove();
      unlockButton = null;
    }

    function ensureUnlock() {
      if (role !== 'screen' || unlockButton) return;
      unlockButton = document.createElement('button');
      unlockButton.type = 'button';
      unlockButton.className = 'immersa-media-unlock';
      unlockButton.dataset.immersaMediaUnlock = '1';
      unlockButton.textContent = '🔊 Activar sonido y multimedia';
      unlockButton.addEventListener('click', async () => {
        if (!video) return;
        try {
          video.muted = Boolean(effectiveMediaState(lastState, activeItem, activeIndex).muted);
          await video.play();
          removeUnlock();
        } catch (_error) {
          unlockButton.textContent = 'Toca de nuevo para reproducir';
        }
      });
      document.body.appendChild(unlockButton);
    }

    function applyVideoState(item, state, index) {
      const player = ensureVideo();
      if (!player) return;
      const image = slideElement();
      const source = assetUrl(deckId, item.src);
      const poster = assetUrl(deckId, posterPath(item));
      const media = effectiveMediaState(state, item, index);
      const sourceChanged = player.dataset.slideIndex !== String(index) || player.dataset.source !== source;

      if (sourceChanged) {
        player.pause();
        player.src = source;
        player.dataset.source = source;
        player.dataset.slideIndex = String(index);
        if (poster) player.poster = poster;
        else player.removeAttribute('poster');
        player.loop = Boolean(item.loop);
        player.load();
        lastAppliedRevision = null;
      }

      if (image) image.style.visibility = 'hidden';
      player.hidden = false;
      player.muted = Boolean(media.muted);

      const revision = String(media.revision ?? '0');
      if (revision !== lastAppliedRevision && (media.command === 'restart' || media.command === 'enter')) {
        try { player.currentTime = 0; } catch (_error) {}
      }
      lastAppliedRevision = revision;

      if (media.playing) {
        const promise = player.play();
        if (promise?.catch) promise.then(removeUnlock).catch(ensureUnlock);
      } else {
        player.pause();
        removeUnlock();
      }
    }

    function hideVideo() {
      if (video) {
        video.pause();
        video.hidden = true;
      }
      const image = slideElement();
      if (image) image.style.visibility = '';
      removeUnlock();
    }

    function ensureControls() {
      if (controls || (role !== 'presenter' && role !== 'stage')) return controls;
      const host = hostElement();
      if (!host) return null;
      controls = document.createElement('div');
      controls.className = 'video-media-controls';
      controls.dataset.videoMediaControls = '1';
      controls.hidden = true;
      controls.innerHTML = [
        '<span class="video-media-label">Video</span>',
        '<button type="button" data-video-action="toggle" aria-label="Play o pausa">▶</button>',
        '<button type="button" data-video-action="restart" aria-label="Reiniciar video">↺</button>',
        '<button type="button" data-video-action="mute" aria-label="Silenciar o activar sonido">🔊</button>'
      ].join('');
      controls.addEventListener('click', (event) => {
        const button = event.target.closest('[data-video-action]');
        if (!button || !activeItem) return;
        const media = effectiveMediaState(lastState, activeItem, activeIndex);
        const action = button.dataset.videoAction;
        if (action === 'toggle') emitMedia({ command: media.playing ? 'pause' : 'play', playing: !media.playing });
        if (action === 'restart') emitMedia({ command: 'restart', playing: true });
        if (action === 'mute') emitMedia({ command: media.muted ? 'unmute' : 'mute', muted: !media.muted });
      });
      host.appendChild(controls);
      return controls;
    }

    function syncControls(state, item, index) {
      const bar = ensureControls();
      if (!bar) return;
      const active = isVideoSlide(item);
      bar.hidden = !active;
      if (!active) return;
      const media = effectiveMediaState(state, item, index);
      const toggle = bar.querySelector('[data-video-action="toggle"]');
      const mute = bar.querySelector('[data-video-action="mute"]');
      toggle.textContent = media.playing ? '❚❚' : '▶';
      toggle.title = media.playing ? 'Pausar video' : 'Reproducir video';
      mute.textContent = media.muted ? '🔇' : '🔊';
      mute.title = media.muted ? 'Activar sonido' : 'Silenciar video';
    }

    function maybeInitializeController(state, item, index) {
      if (!isVideoSlide(item) || lastInitializedIndex === index) return;
      const shouldInitialize = role === 'presenter' || (role === 'stage' && !state?.presenterConnected);
      if (!shouldInitialize) return;
      lastInitializedIndex = index;
      emitMedia({
        command: 'restart',
        playing: item.autoplay !== false,
        muted: Boolean(item.muted)
      });
    }

    function render(state) {
      if (!manifest) {
        pendingState = state;
        return;
      }
      lastState = state || {};
      const index = currentIndex(role, state);
      const item = manifest.slides?.[index] || null;
      const changed = index !== activeIndex;
      activeIndex = index;
      activeItem = item;

      if (!isVideoSlide(item)) {
        hideVideo();
        if (controls) controls.hidden = true;
        if (changed) lastInitializedIndex = -1;
        return;
      }

      patchPoster(index, item);
      syncControls(state, item, index);
      maybeInitializeController(state, item, index);

      if (role === 'screen') applyVideoState(item, state, index);
      else hideVideo();
    }

    async function loadManifest() {
      const response = await fetchFn('/decks/' + encodeURIComponent(deckId) + '/manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Video slide manifest unavailable');
      manifest = await response.json();
      patchPoster(-1, null);
      if (pendingState) {
        const state = pendingState;
        pendingState = null;
        render(state);
      }
      return manifest;
    }

    mainSocket.on('presentation_state', render);
    mainSocket.on('overlay_update', (overlays) => {
      if (!lastState) return;
      render({ ...lastState, overlays: { ...(lastState.overlays || {}), ...(overlays || {}) } });
    });
    mainSocket.on('clear_overlays', () => {
      if (!lastState) return;
      render({ ...lastState, overlays: { ...(lastState.overlays || {}), videoMedia: null } });
    });

    loadManifest().catch((error) => console.warn('Unable to initialize video slides', error.message));

    return {
      role,
      deckId,
      sessionId,
      render,
      emitMedia,
      getManifest: () => manifest,
      getActiveItem: () => activeItem
    };
  }

  function autoMount() {
    if (!root.document || root.__immersaVideoSlidesMounted) return null;
    root.__immersaVideoSlidesMounted = true;
    return createRuntime();
  }

  if (root.document?.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', autoMount, { once: true });
  else autoMount();

  return {
    roleFromPath,
    isVideoSlide,
    posterPath,
    assetUrl,
    defaultMediaState,
    effectiveMediaState,
    currentIndex,
    createRuntime,
    autoMount
  };
});
