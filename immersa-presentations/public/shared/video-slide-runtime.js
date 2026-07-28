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

  function isYouTubeSlide(item) {
    return String(item?.videoProvider || '').toLowerCase() === 'youtube'
      && /^[a-z0-9_-]{11}$/i.test(String(item?.youtubeVideoId || ''));
  }

  function posterPath(item) {
    return String(item?.poster || item?.thumb || item?.fallback || '').trim();
  }

  function assetUrl(deckId, value) {
    const path = String(value || '').trim();
    if (!path) return '';
    if (/^(?:https?:)?\/\//i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('/')) return path;
    return '/decks/' + encodeURIComponent(deckId) + '/' + path.replace(/^\/+/, '');
  }

  function loadYouTubeApi(document) {
    if (root.YT?.Player) return Promise.resolve(root.YT);
    if (root.__immersaYouTubeApiPromise) return root.__immersaYouTubeApiPromise;
    root.__immersaYouTubeApiPromise = new Promise((resolve, reject) => {
      const previousReady = root.onYouTubeIframeAPIReady;
      let settled = false;
      const finish = () => {
        if (settled || !root.YT?.Player) return;
        settled = true;
        resolve(root.YT);
      };
      root.onYouTubeIframeAPIReady = function () {
        if (typeof previousReady === 'function') previousReady();
        finish();
      };
      let script = document.querySelector('script[data-immersa-youtube-api]');
      if (!script) {
        script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.dataset.immersaYoutubeApi = '1';
        document.head.appendChild(script);
      }
      script.addEventListener?.('load', finish, { once: true });
      script.addEventListener?.('error', () => {
        if (settled) return;
        settled = true;
        reject(new Error('YouTube player unavailable'));
      }, { once: true });
    });
    return root.__immersaYouTubeApiPromise;
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

  function playbackForcedMuted(playback, slideIndex) {
    return Boolean(playback?.forced_muted)
      && Number(playback?.slide_index) === Number(slideIndex);
  }

  function mediaControlMuted(media, playback, slideIndex) {
    return Boolean(media?.muted) || playbackForcedMuted(playback, slideIndex);
  }

  function muteControlPatch(media, playback, slideIndex) {
    const muted = mediaControlMuted(media, playback, slideIndex);
    return { command: muted ? 'unmute' : 'mute', muted: !muted };
  }

  function currentIndex(role, state) {
    if (role === 'screen' || role === 'audience') return Number(state?.liveSlideIndex ?? state?.slideIndex ?? 0);
    return Number(state?.presenterSlideIndex ?? state?.slideIndex ?? 0);
  }

  function loadStyle(document) {
    if (!document || document.querySelector('link[data-video-slide-runtime]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/shared/video-slide-runtime.css?v=108';
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
    let youtubeHost = null;
    let youtubePlayer = null;
    let youtubePlayerPromise = null;
    let youtubePendingState = null;
    let youtubeLoadedIndex = -1;
    let controls = null;
    let unlockButton = null;
    let ownsUnlockButton = false;
    let screenPlayback = null;
    let lastReportedPlayback = '';
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

    function reportScreenPlayback(forcedMuted, item, index, revision = '') {
      if (role !== 'screen' || !isYouTubeSlide(item)) return;
      const key = String(index) + ':' + String(Boolean(forcedMuted)) + ':' + String(revision);
      if (key === lastReportedPlayback) return;
      lastReportedPlayback = key;
      mainSocket.emit('media:playback_update', {
        slide_index: Number(index),
        provider: 'youtube',
        forced_muted: Boolean(forcedMuted)
      });
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
      video.addEventListener('ended', () => {
        if (role !== 'screen' || !activeItem) return;
        root.ImmersaLocalMedia?.handleEnded?.({ slideIndex: activeIndex, item: activeItem });
      });
      host.appendChild(video);
      return video;
    }

    function requestAdvance(item, index) {
      if (String(item?.endBehavior || '') !== 'next') return;
      if (root.ImmersaLocalMedia?.handleEnded) {
        root.ImmersaLocalMedia.handleEnded({ slideIndex: index, item });
        return;
      }
      mainSocket.emit('media:advance_request', { slideIndex: Number(index), nextSlideIndex: Number(index) + 1 });
    }

    function youtubePlayerVars(item) {
      const origin = String(location.origin || root.location?.origin || '');
      return {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        enablejsapi: 1,
        fs: 0,
        iv_load_policy: 3,
        playsinline: 1,
        rel: 0,
        ...(origin && origin !== 'null' ? { origin } : {})
      };
    }

    function ensureYouTube(item, index) {
      const host = hostElement();
      if (!host) return Promise.resolve(null);
      if (!youtubeHost) {
        youtubeHost = document.createElement('div');
        youtubeHost.className = 'immersa-youtube-slide';
        youtubeHost.dataset.youtubeSlide = '1';
        youtubeHost.hidden = false;
        const target = document.createElement('div');
        target.dataset.youtubeTarget = '1';
        youtubeHost.appendChild(target);
        host.appendChild(youtubeHost);
        youtubePlayerPromise = loadYouTubeApi(document).then((YT) => new Promise((resolve) => {
          youtubePlayer = new YT.Player(target, {
            width: '100%',
            height: '100%',
            videoId: String(item.youtubeVideoId),
            playerVars: youtubePlayerVars(item),
            events: {
              onReady: (event) => resolve(event.target),
              onStateChange: (event) => {
                if (event.data !== root.YT?.PlayerState?.ENDED || !isYouTubeSlide(activeItem)) return;
                if (activeItem.loop) {
                  event.target.seekTo(Math.max(0, Number(activeItem.youtubeStartSeconds) || 0), true);
                  event.target.playVideo();
                } else {
                  requestAdvance(activeItem, activeIndex);
                }
              },
              onError: showYouTubeError
            }
          });
        })).then((player) => {
          if (youtubePendingState) {
            const pending = youtubePendingState;
            youtubePendingState = null;
            applyYouTubeState(pending.item, pending.state, pending.index);
          }
          return player;
        }).catch((error) => {
          console.warn('Unable to initialize YouTube video', error.message);
          showYouTubeError();
          return null;
        });
      }
      if (youtubeLoadedIndex !== index && youtubePlayer) {
        youtubeLoadedIndex = index;
        lastAppliedRevision = null;
        youtubePlayer.cueVideoById({
          videoId: String(item.youtubeVideoId),
          startSeconds: Math.max(0, Number(item.youtubeStartSeconds) || 0)
        });
      }
      return youtubePlayerPromise || Promise.resolve(youtubePlayer);
    }

    function removeUnlock() {
      const button = unlockButton;
      const shouldRemove = ownsUnlockButton;
      unlockButton = null;
      ownsUnlockButton = false;
      if (shouldRemove) button?.remove();
    }

    async function unlockActiveMedia() {
      if (isYouTubeSlide(activeItem)) {
        const player = await ensureYouTube(activeItem, activeIndex);
        if (!player) return;
        const media = effectiveMediaState(lastState, activeItem, activeIndex);
        if (media.muted) player.mute();
        else {
          player.unMute();
          reportScreenPlayback(false, activeItem, activeIndex, media.revision);
        }
        player.playVideo();
        removeUnlock();
        return;
      }
      if (!video) return;
      try {
        video.muted = Boolean(effectiveMediaState(lastState, activeItem, activeIndex).muted);
        await video.play();
        removeUnlock();
      } catch (_error) {
        if (unlockButton) unlockButton.textContent = 'Toca de nuevo para reproducir';
      }
    }

    function bindUnlock(button) {
      if (!button || button.dataset.videoMediaUnlockBound === '1') return;
      button.dataset.videoMediaUnlockBound = '1';
      button.addEventListener('click', unlockActiveMedia);
    }

    function ensureUnlock() {
      if (role !== 'screen') return null;
      const sharedButton = document.querySelector('[data-immersa-media-unlock]:not([hidden])');
      if (sharedButton) {
        if (unlockButton && unlockButton !== sharedButton && ownsUnlockButton) unlockButton.remove();
        unlockButton = sharedButton;
        ownsUnlockButton = false;
        bindUnlock(unlockButton);
        return unlockButton;
      }
      if (unlockButton && document.documentElement?.contains && !document.documentElement.contains(unlockButton)) {
        unlockButton = null;
        ownsUnlockButton = false;
      }
      if (unlockButton) return unlockButton;
      unlockButton = document.createElement('button');
      ownsUnlockButton = true;
      unlockButton.type = 'button';
      unlockButton.className = 'immersa-media-unlock';
      unlockButton.dataset.immersaMediaUnlock = '1';
      unlockButton.textContent = '🔊 Activar sonido';
      bindUnlock(unlockButton);
      document.body.appendChild(unlockButton);
      return unlockButton;
    }

    function showYouTubeError() {
      ensureUnlock();
      if (!unlockButton) return;
      unlockButton.textContent = 'YouTube no está disponible';
      unlockButton.disabled = true;
    }

    function playYouTubeWithAutoplayFallback(player, item, index, media) {
      if (media.muted) {
        player.mute();
        player.playVideo();
        reportScreenPlayback(false, item, index, media.revision);
        return;
      }
      player.unMute();
      player.playVideo();
      root.setTimeout?.(() => {
        if (activeIndex !== index || activeItem !== item) return;
        const latest = effectiveMediaState(lastState, item, index);
        if (!latest.playing) return;
        const playerState = player.getPlayerState?.();
        const playing = playerState === root.YT?.PlayerState?.PLAYING;
        const buffering = playerState === root.YT?.PlayerState?.BUFFERING;
        const stillMuted = Boolean(player.isMuted?.());
        if ((playing || buffering) && !stillMuted) {
          reportScreenPlayback(false, item, index, latest.revision);
          removeUnlock();
          return;
        }
        if ((playing || buffering) && stillMuted) {
          reportScreenPlayback(true, item, index, latest.revision);
          ensureUnlock();
          return;
        }
        player.mute();
        player.playVideo();
        reportScreenPlayback(true, item, index, latest.revision);
        ensureUnlock();
      }, 700);
    }

    function applyYouTubeState(item, state, index) {
      const image = slideElement();
      const media = effectiveMediaState(state, item, index);
      youtubePendingState = { item, state, index };
      if (image) image.style.visibility = 'hidden';
      if (youtubeHost) youtubeHost.hidden = false;
      ensureYouTube(item, index).then((player) => {
        if (!player || activeIndex !== index || !isYouTubeSlide(activeItem)) return;
        youtubePendingState = null;
        if (youtubeHost) youtubeHost.hidden = false;
        if (youtubeLoadedIndex !== index) {
          youtubeLoadedIndex = index;
          lastAppliedRevision = null;
          player.cueVideoById({
            videoId: String(item.youtubeVideoId),
            startSeconds: Math.max(0, Number(item.youtubeStartSeconds) || 0)
          });
        }
        const revision = String(media.revision ?? '0');
        if (revision !== lastAppliedRevision && (media.command === 'restart' || media.command === 'enter')) {
          player.seekTo(Math.max(0, Number(item.youtubeStartSeconds) || 0), true);
        }
        lastAppliedRevision = revision;
        if (media.playing) {
          playYouTubeWithAutoplayFallback(player, item, index, media);
        } else {
          player.pauseVideo();
          removeUnlock();
        }
      });
    }

    function applyVideoState(item, state, index) {
      const player = ensureVideo();
      if (!player) return;
      const image = slideElement();
      const localSource = role === 'screen' ? root.ImmersaLocalMedia?.getUrl?.(item.slide_id || item.id) : '';
      const source = localSource || assetUrl(deckId, item.src);
      const poster = assetUrl(deckId, posterPath(item));
      const media = effectiveMediaState(state, item, index);
      if (!source) {
        hideVideo();
        return;
      }
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
    }

    function hideYouTube() {
      youtubePendingState = null;
      youtubePlayer?.pauseVideo?.();
      if (youtubeHost) youtubeHost.hidden = true;
    }

    function hidePlayers() {
      hideVideo();
      hideYouTube();
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
        if (action === 'mute') {
          const patch = muteControlPatch(media, screenPlayback, activeIndex);
          if (patch.muted === false && playbackForcedMuted(screenPlayback, activeIndex)) {
            screenPlayback = { ...screenPlayback, forced_muted: false };
          }
          emitMedia(patch);
        }
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
      const muted = mediaControlMuted(media, screenPlayback, index);
      const toggle = bar.querySelector('[data-video-action="toggle"]');
      const mute = bar.querySelector('[data-video-action="mute"]');
      toggle.textContent = media.playing ? '❚❚' : '▶';
      toggle.title = media.playing ? 'Pausar video' : 'Reproducir video';
      mute.textContent = muted ? '🔇' : '🔊';
      mute.title = muted ? 'Activar sonido' : 'Silenciar video';
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
        hidePlayers();
        if (controls) controls.hidden = true;
        if (changed) lastInitializedIndex = -1;
        return;
      }

      patchPoster(index, item);
      syncControls(state, item, index);
      maybeInitializeController(state, item, index);

      if (role === 'screen' && isYouTubeSlide(item)) {
        hideVideo();
        applyYouTubeState(item, state, index);
      } else if (role === 'screen') {
        hideYouTube();
        applyVideoState(item, state, index);
      } else {
        hidePlayers();
      }
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
    mainSocket.on('media:playback', (playback) => {
      screenPlayback = playback || null;
      if (lastState) render(lastState);
    });
    if (role === 'screen') root.ImmersaLocalMedia?.subscribe?.(() => { if (lastState) render(lastState); });

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
    isYouTubeSlide,
    posterPath,
    assetUrl,
    loadYouTubeApi,
    defaultMediaState,
    effectiveMediaState,
    playbackForcedMuted,
    mediaControlMuted,
    muteControlPatch,
    currentIndex,
    createRuntime,
    autoMount
  };
});
