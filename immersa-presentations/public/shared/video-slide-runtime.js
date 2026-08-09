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

  function playbackMatches(playback, slideIndex) {
    return Boolean(playback) && Number(playback.slide_index) === Number(slideIndex);
  }

  function finiteMediaTime(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function playbackPosition(playback, slideIndex) {
    return playbackMatches(playback, slideIndex) ? finiteMediaTime(playback.current_time_seconds) : 0;
  }

  function playbackDuration(playback, slideIndex) {
    return playbackMatches(playback, slideIndex) ? finiteMediaTime(playback.duration_seconds) : 0;
  }

  function mediaControlPlaying(media, playback, slideIndex) {
    if (playbackMatches(playback, slideIndex) && typeof playback.playing === 'boolean') {
      return playback.playing;
    }
    return media?.playing !== false;
  }

  function formatMediaTime(value) {
    const total = Math.max(0, Math.floor(finiteMediaTime(value)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return hours + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function remainingMediaTime(currentTime, duration) {
    return '\u2212' + formatMediaTime(Math.max(0, finiteMediaTime(duration) - finiteMediaTime(currentTime)));
  }

  function currentIndex(role, state) {
    if (role === 'screen' || role === 'audience') return Number(state?.liveSlideIndex ?? state?.slideIndex ?? 0);
    return Number(state?.presenterSlideIndex ?? state?.slideIndex ?? 0);
  }

  function loadStyle(document) {
    if (!document || document.querySelector('link[data-video-slide-runtime]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/shared/video-slide-runtime.css?v=110';
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
    let screenForcedMuted = false;
    let playbackTimer = null;
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

    function playbackSnapshot(item, index) {
      const youtube = isYouTubeSlide(item);
      if (youtube) {
        const playerState = youtubePlayer?.getPlayerState?.();
        const playing = playerState === root.YT?.PlayerState?.PLAYING
          || playerState === root.YT?.PlayerState?.BUFFERING;
        return {
          slide_index: Number(index),
          provider: 'youtube',
          forced_muted: Boolean(screenForcedMuted),
          current_time_seconds: finiteMediaTime(youtubePlayer?.getCurrentTime?.()),
          duration_seconds: finiteMediaTime(youtubePlayer?.getDuration?.()),
          playing,
          muted: Boolean(youtubePlayer?.isMuted?.())
        };
      }
      return {
        slide_index: Number(index),
        provider: 'local',
        forced_muted: false,
        current_time_seconds: finiteMediaTime(video?.currentTime),
        duration_seconds: finiteMediaTime(video?.duration),
        playing: Boolean(video && !video.paused && !video.ended),
        muted: Boolean(video?.muted)
      };
    }

    function reportScreenPlayback(forcedMuted, item, index, revision = '', force = false) {
      if (role !== 'screen' || !isVideoSlide(item)) return;
      if (typeof forcedMuted === 'boolean') screenForcedMuted = forcedMuted;
      const payload = playbackSnapshot(item, index);
      const key = [
        payload.slide_index,
        payload.provider,
        payload.forced_muted,
        payload.playing,
        payload.muted,
        Math.round(payload.current_time_seconds * 4) / 4,
        Math.round(payload.duration_seconds * 4) / 4,
        revision
      ].join(':');
      if (!force && key === lastReportedPlayback) return;
      lastReportedPlayback = key;
      mainSocket.emit('media:playback_update', payload);
    }

    function startPlaybackTicker() {
      if (role !== 'screen' || playbackTimer) return;
      playbackTimer = root.setInterval?.(() => {
        if (isVideoSlide(activeItem)) reportScreenPlayback(undefined, activeItem, activeIndex);
      }, 500);
      playbackTimer?.unref?.();
    }

    function stopPlaybackTicker() {
      if (!playbackTimer) return;
      root.clearInterval?.(playbackTimer);
      playbackTimer = null;
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
        reportScreenPlayback(undefined, activeItem, activeIndex, '', true);
        if (role !== 'screen' || !activeItem) return;
        root.ImmersaLocalMedia?.handleEnded?.({ slideIndex: activeIndex, item: activeItem });
      });
      ['loadedmetadata', 'durationchange', 'play', 'pause', 'timeupdate', 'volumechange'].forEach((eventName) => {
        video.addEventListener(eventName, () => {
          if (role === 'screen' && activeItem) reportScreenPlayback(undefined, activeItem, activeIndex);
        });
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
                reportScreenPlayback(undefined, activeItem, activeIndex, '', true);
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

    function removeUnlock(resolved = false) {
      const button = unlockButton;
      const shouldRemove = ownsUnlockButton || Boolean(resolved);
      unlockButton = null;
      ownsUnlockButton = false;
      if (shouldRemove) button?.remove();
    }

    function announceMediaUnlocked() {
      const firstUnlock = !root.__immersaMediaUnlocked;
      root.__immersaMediaUnlocked = true;
      if (firstUnlock && typeof root.Event === 'function') {
        document.dispatchEvent?.(new root.Event('immersa:media-unlocked'));
      }
    }

    async function unlockActiveMedia() {
      // Keep every Screen sound behind one browser gesture. Other runtimes
      // (Trivias and games) use this signal to prime their audio immediately.
      announceMediaUnlocked();
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
        removeUnlock(true);
        return;
      }
      if (!video) return;
      try {
        video.muted = Boolean(effectiveMediaState(lastState, activeItem, activeIndex).muted);
        await video.play();
        removeUnlock(true);
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
          removeUnlock(true);
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
        if (revision !== lastAppliedRevision && (media.command === 'restart' || media.command === 'enter' || media.command === 'seek')) {
          const targetSeconds = media.command === 'seek'
            ? finiteMediaTime(media.position_seconds)
            : Math.max(0, Number(item.youtubeStartSeconds) || 0);
          player.seekTo(targetSeconds, true);
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
      if (revision !== lastAppliedRevision && (media.command === 'restart' || media.command === 'enter' || media.command === 'seek')) {
        const targetSeconds = media.command === 'seek' ? finiteMediaTime(media.position_seconds) : 0;
        try { player.currentTime = targetSeconds; } catch (_error) {}
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
      stopPlaybackTicker();
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
        '<div class="video-media-progress-row">',
          '<span class="video-media-time" data-video-current-time>0:00</span>',
          '<div class="video-media-progress-track" data-video-seek-track role="slider" tabindex="0" aria-label="Posición del video" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">',
            '<div class="video-media-progress-visual"><div class="video-media-progress-fill" data-video-progress-fill><span class="video-media-progress-handle"></span></div></div>',
          '</div>',
          '<span class="video-media-time is-remaining" data-video-remaining-time>\u22120:00</span>',
        '</div>',
        '<div class="video-media-controls-row">',
          '<div class="video-media-primary-controls">',
            '<button class="video-media-icon-button" type="button" data-video-action="restart" aria-label="Ir al inicio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5v14l-12 -7l12 -7"/><path d="M4 5l0 14"/></svg></button>',
            '<button class="video-media-icon-button" type="button" data-video-action="rewind" aria-label="Retroceder 10 segundos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9l-3 -3l3 -3"/><path d="M15.997 17.918a6.002 6.002 0 0 0 -.997 -11.918h-11"/><path d="M6 14v6"/><path d="M9 15.5v3a1.5 1.5 0 0 0 3 0v-3a1.5 1.5 0 0 0 -3 0"/></svg></button>',
            '<button class="video-media-play-button" type="button" data-video-action="toggle" aria-label="Reproducir"><svg data-video-play-icon viewBox="0 0 24 24" fill="none" stroke="#12101a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16l13 -8l-13 -8"/></svg></button>',
            '<button class="video-media-icon-button" type="button" data-video-action="forward" aria-label="Avanzar 10 segundos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 9l3 -3l-3 -3"/><path d="M8 17.918a5.997 5.997 0 0 1 -5 -5.918a6 6 0 0 1 6 -6h11"/><path d="M12 14v6"/><path d="M15 15.5v3a1.5 1.5 0 0 0 3 0v-3a1.5 1.5 0 0 0 -3 0"/></svg></button>',
          '</div>',
          '<button class="video-media-icon-button" type="button" data-video-action="mute" aria-label="Silenciar"><svg data-video-volume-icon viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/></svg></button>',
        '</div>'
      ].join('');
      controls.addEventListener('click', (event) => {
        const track = event.target.closest('[data-video-seek-track]');
        if (track && activeItem) {
          const duration = playbackDuration(screenPlayback, activeIndex);
          if (!duration) return;
          const rect = track.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const media = effectiveMediaState(lastState, activeItem, activeIndex);
          emitMedia({ command: 'seek', position_seconds: ratio * duration, playing: mediaControlPlaying(media, screenPlayback, activeIndex) });
          return;
        }
        const button = event.target.closest('[data-video-action]');
        if (!button || !activeItem) return;
        const media = effectiveMediaState(lastState, activeItem, activeIndex);
        const action = button.dataset.videoAction;
        const playing = mediaControlPlaying(media, screenPlayback, activeIndex);
        const position = playbackPosition(screenPlayback, activeIndex);
        const duration = playbackDuration(screenPlayback, activeIndex);
        if (action === 'toggle') emitMedia({ command: playing ? 'pause' : 'play', playing: !playing });
        if (action === 'restart') emitMedia({ command: 'restart', playing: true });
        if (action === 'rewind') emitMedia({ command: 'seek', position_seconds: Math.max(0, position - 10), playing });
        if (action === 'forward') emitMedia({ command: 'seek', position_seconds: duration ? Math.min(duration, position + 10) : position + 10, playing });
        if (action === 'mute') {
          const patch = muteControlPatch(media, screenPlayback, activeIndex);
          if (patch.muted === false && playbackForcedMuted(screenPlayback, activeIndex)) {
            screenPlayback = { ...screenPlayback, forced_muted: false };
          }
          emitMedia(patch);
        }
      });
      controls.addEventListener('keydown', (event) => {
        const track = event.target.closest('[data-video-seek-track]');
        if (!track || !activeItem || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const media = effectiveMediaState(lastState, activeItem, activeIndex);
        const position = playbackPosition(screenPlayback, activeIndex);
        const duration = playbackDuration(screenPlayback, activeIndex);
        const delta = event.key === 'ArrowLeft' ? -10 : 10;
        emitMedia({
          command: 'seek',
          position_seconds: Math.min(duration || Infinity, Math.max(0, position + delta)),
          playing: mediaControlPlaying(media, screenPlayback, activeIndex)
        });
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
      const playing = mediaControlPlaying(media, screenPlayback, index);
      const currentTime = playbackPosition(screenPlayback, index);
      const duration = playbackDuration(screenPlayback, index);
      const toggle = bar.querySelector('[data-video-action="toggle"]');
      const mute = bar.querySelector('[data-video-action="mute"]');
      const playIcon = bar.querySelector('[data-video-play-icon]');
      const volumeIcon = bar.querySelector('[data-video-volume-icon]');
      const currentTimeNode = bar.querySelector('[data-video-current-time]');
      const remainingTimeNode = bar.querySelector('[data-video-remaining-time]');
      const progressFill = bar.querySelector('[data-video-progress-fill]');
      const progressTrack = bar.querySelector('[data-video-seek-track]');
      playIcon.innerHTML = playing
        ? '<path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"/><path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"/>'
        : '<path d="M7 4v16l13 -8l-13 -8"/>';
      volumeIcon.innerHTML = muted
        ? '<path d="M15 8a5 5 0 0 1 1.912 4.934m-1.377 2.602a5 5 0 0 1 -.535 .464"/><path d="M17.7 5a9 9 0 0 1 2.362 11.086m-1.676 2.299a9 9 0 0 1 -.686 .615"/><path d="M9.069 5.054l.431 -.554a.8 .8 0 0 1 1.5 .5v2m0 4v8a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l1.294 -1.664"/><path d="M3 3l18 18"/>'
        : '<path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/>';
      toggle.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
      toggle.title = playing ? 'Pausar video' : 'Reproducir video';
      mute.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar');
      mute.title = muted ? 'Activar sonido' : 'Silenciar video';
      currentTimeNode.textContent = formatMediaTime(currentTime);
      remainingTimeNode.textContent = remainingMediaTime(currentTime, duration);
      progressFill.style.width = (duration ? Math.min(100, Math.max(0, currentTime / duration * 100)) : 0) + '%';
      progressTrack.setAttribute('aria-valuemax', String(Math.floor(duration)));
      progressTrack.setAttribute('aria-valuenow', String(Math.floor(currentTime)));
      progressTrack.setAttribute('aria-valuetext', formatMediaTime(currentTime) + ' de ' + formatMediaTime(duration));
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
        screenForcedMuted = false;
        lastReportedPlayback = '';
        hidePlayers();
        if (controls) controls.hidden = true;
        if (changed) lastInitializedIndex = -1;
        return;
      }

      patchPoster(index, item);
      syncControls(state, item, index);
      maybeInitializeController(state, item, index);

      if (role === 'screen' && isYouTubeSlide(item)) {
        if (changed) {
          screenForcedMuted = false;
          lastReportedPlayback = '';
        }
        startPlaybackTicker();
        hideVideo();
        applyYouTubeState(item, state, index);
      } else if (role === 'screen') {
        if (changed) {
          screenForcedMuted = false;
          lastReportedPlayback = '';
        }
        startPlaybackTicker();
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
    playbackMatches,
    playbackPosition,
    playbackDuration,
    mediaControlPlaying,
    formatMediaTime,
    remainingMediaTime,
    currentIndex,
    createRuntime,
    autoMount
  };
});
