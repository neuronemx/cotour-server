(() => {
  const host = document.querySelector('#audiovisualDeckEditor');
  if (!host) return;

  let deck = null;
  let resources = [];
  let selected = [];
  let type = 'audio';
  let query = '';
  let preview = null;
  let activeAudioButton = null;
  let saving = false;

  const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
  const time = (seconds) => {
    const value = Math.round(Number(seconds) || 0);
    return Math.floor(value / 60) + ':' + String(value % 60).padStart(2, '0');
  };
  const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
  const stopIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10"></rect></svg>';

  function stopPreview() {
    if (preview) {
      preview.pause();
      preview.removeAttribute('src');
      preview.load?.();
      preview.remove();
      preview = null;
    }
    if (activeAudioButton) {
      activeAudioButton.innerHTML = playIcon;
      activeAudioButton.setAttribute('aria-label', 'Reproducir audio');
      activeAudioButton = null;
    }
    host.querySelectorAll('.av-video-previewing').forEach((card) => {
      card.classList.remove('av-video-previewing');
      const image = card.querySelector('img');
      if (image) image.hidden = false;
    });
  }

  function resourceFor(id) {
    return resources.find((resource) => resource.id === id);
  }

  function duration(resource, target) {
    const media = document.createElement(resource.type);
    media.preload = 'metadata';
    media.src = resource.media_url;
    media.addEventListener('loadedmetadata', () => {
      target.textContent = time(media.duration);
      media.removeAttribute('src');
      media.load();
    }, { once: true });
    media.addEventListener('error', () => { target.textContent = ''; }, { once: true });
  }

  function counter() {
    const target = host.querySelector('[data-selection-count]');
    if (target) target.textContent = selected.length + ' seleccionado' + (selected.length === 1 ? '' : 's');
  }

  function toggleSelection(button) {
    const id = button.dataset.select;
    const wasSelected = selected.includes(id);
    selected = wasSelected ? selected.filter((item) => item !== id) : [...selected, id];
    button.classList.toggle('is-selected', !wasSelected);
    button.innerHTML = !wasSelected ? '✓' : '';
    button.setAttribute('aria-pressed', String(!wasSelected));
    const card = button.closest('.av-audio-row, .av-video-card');
    if (card) card.classList.toggle('is-selected', !wasSelected);
    counter();
  }

  function startAudio(button) {
    const resource = resourceFor(button.dataset.preview);
    if (!resource) return;
    if (activeAudioButton === button) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = resource.media_url;
    audio.addEventListener('ended', stopPreview, { once: true });
    audio.addEventListener('error', stopPreview, { once: true });
    preview = audio;
    activeAudioButton = button;
    button.innerHTML = stopIcon;
    button.setAttribute('aria-label', 'Detener audio');
    audio.play().catch(stopPreview);
  }

  function startVideoPreview(card) {
    const resource = resourceFor(card.dataset.resource);
    if (!resource || card.matches(':has([data-select]:hover)')) return;
    stopPreview();
    const figure = card.querySelector('figure');
    const image = figure?.querySelector('img');
    if (!figure || !image) return;
    const video = document.createElement('video');
    video.className = 'av-video-preview';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = resource.media_url;
    video.setAttribute('aria-hidden', 'true');
    figure.appendChild(video);
    preview = video;
    video.addEventListener('loadeddata', () => {
      if (preview !== video) return;
      image.hidden = true;
      card.classList.add('av-video-previewing');
    }, { once: true });
    video.addEventListener('error', stopPreview, { once: true });
    video.play().catch(stopPreview);
  }

  function render() {
    const list = resources.filter((resource) =>
      resource.type === type && resource.name.toLowerCase().includes(query.toLowerCase())
    );
    const cards = list.map((resource) => {
      const isSelected = selected.includes(resource.id);
      if (type === 'audio') {
        return '<article class="av-audio-row' + (isSelected ? ' is-selected' : '') + '">' +
          '<i aria-hidden="true">♫</i>' +
          '<div><b>' + escapeHtml(resource.name) + '</b><small data-duration="' + resource.id + '"></small></div>' +
          '<button class="av-preview-button" data-preview="' + resource.id + '" aria-label="Reproducir audio">' + playIcon + '</button>' +
          '<button class="av-select-button' + (isSelected ? ' is-selected' : '') + '" data-select="' + resource.id + '" aria-label="Seleccionar ' + escapeHtml(resource.name) + '" aria-pressed="' + isSelected + '">' + (isSelected ? '✓' : '') + '</button>' +
        '</article>';
      }
      return '<article class="av-video-card' + (isSelected ? ' is-selected' : '') + '" data-resource="' + resource.id + '">' +
        '<figure><img src="' + escapeHtml(resource.thumbnail_url) + '" alt=""><small data-duration="' + resource.id + '"></small>' +
        '<button class="av-select-button' + (isSelected ? ' is-selected' : '') + '" data-select="' + resource.id + '" aria-label="Seleccionar ' + escapeHtml(resource.name) + '" aria-pressed="' + isSelected + '">' + (isSelected ? '✓' : '') + '</button></figure>' +
        '<b>' + escapeHtml(resource.name) + '</b>' +
      '</article>';
    }).join('');

    host.innerHTML =
      '<section class="av2">' +
        '<header class="av-library-header"><h2>Librería</h2><div class="av2-tabs" role="tablist">' +
          '<button data-tab="audio" class="' + (type === 'audio' ? 'is-active' : '') + '" role="tab" aria-selected="' + (type === 'audio') + '">Audio</button>' +
          '<button data-tab="video" class="' + (type === 'video' ? 'is-active' : '') + '" role="tab" aria-selected="' + (type === 'video') + '">Video</button>' +
        '</div></header>' +
        '<label class="av2-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="5"></circle><path d="m15 15 4 4"></path></svg><input data-search value="' + escapeHtml(query) + '" placeholder="Buscar en la librería" autocomplete="off"></label>' +
        '<main class="av2-list ' + type + '">' + (cards || '<p class="av-empty">No encontramos recursos.</p>') + '</main>' +
        '<footer><span data-selection-count></span><button data-save>Guardar cambios</button></footer>' +
      '</section>';

    counter();
    host.querySelectorAll('[data-duration]').forEach((node) => {
      const resource = resourceFor(node.dataset.duration);
      if (resource) duration(resource, node);
    });
    host.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        if (type === button.dataset.tab) return;
        stopPreview();
        type = button.dataset.tab;
        query = '';
        render();
      });
    });
    const search = host.querySelector('[data-search]');
    search.addEventListener('input', (event) => {
      query = event.target.value;
      render();
      const next = host.querySelector('[data-search]');
      next.focus();
      next.setSelectionRange(query.length, query.length);
    });
    host.querySelectorAll('[data-select]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSelection(button);
    }));
    host.querySelectorAll('[data-preview]').forEach((button) => button.addEventListener('click', () => startAudio(button)));
    host.querySelectorAll('.av-video-card').forEach((card) => {
      card.addEventListener('pointerenter', () => startVideoPreview(card));
      card.addEventListener('pointerleave', stopPreview);
    });
    host.querySelector('[data-save]').addEventListener('click', save);
  }

  async function save() {
    if (saving || !deck) return;
    saving = true;
    stopPreview();
    const button = host.querySelector('[data-save]');
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      const response = await fetch('/api/decks/' + encodeURIComponent(deck.deckId) + '/interactions');
      if (!response.ok) throw new Error('No se pudo leer la configuración');
      const current = await response.json();
      const update = await fetch('/api/decks/' + encodeURIComponent(deck.deckId) + '/interactions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...current, audiovisual: selected })
      });
      if (!update.ok) throw new Error('No se pudo guardar');
      button.textContent = 'Guardado ✓';
      window.setTimeout(() => document.querySelector('[data-deck-tab="links"]')?.click(), 250);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Intentar de nuevo';
      saving = false;
    }
  }

  async function load() {
    if (!deck) return;
    stopPreview();
    host.innerHTML = '<div class="av-loading">Cargando librería…</div>';
    try {
      const [catalogResponse, deckResponse] = await Promise.all([
        fetch('/api/audiovisual-library'),
        fetch('/api/decks/' + encodeURIComponent(deck.deckId) + '/interactions')
      ]);
      if (!catalogResponse.ok || !deckResponse.ok) throw new Error('No se pudo cargar');
      const catalog = await catalogResponse.json();
      const configuration = await deckResponse.json();
      resources = catalog.resources || [];
      selected = configuration.audiovisual || [];
      type = 'audio';
      query = '';
      saving = false;
      render();
    } catch (error) {
      host.innerHTML = '<div class="av-loading">No pudimos cargar la librería. Inténtalo de nuevo.</div>';
    }
  }

  document.addEventListener('immersa:deck-detail-open', (event) => {
    deck = event.detail?.deck || null;
    load();
  });
  document.addEventListener('immersa:deck-detail-close', () => {
    stopPreview();
    deck = null;
  });
})();