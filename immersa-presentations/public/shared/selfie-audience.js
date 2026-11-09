(function (root) {
  root.ImmersaSelfieAudience = {
    create({ socket, viewport, download, attachImageZoom }) {
      const overlay = document.createElement('section');
      overlay.className = 'selfie-audience';
      overlay.hidden = true;
      const canvas = document.createElement('div');
      canvas.className = 'selfie-audience-zoom';
      const image = document.createElement('img');
      image.draggable = false;
      canvas.appendChild(image);
      const resetZoom = attachImageZoom?.(canvas, image, { doubleTapScale: 2 });
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '↻';
      retry.setAttribute('aria-label', 'Volver a cargar imagen');
      retry.hidden = true;
      overlay.append(canvas, status, retry);
      viewport.appendChild(overlay);
      const localize = () => {
        overlay.setAttribute('aria-label', root.ImmersaI18n?.t('shell.selfie') || 'Tarjetas');
        image.alt = root.ImmersaI18n?.t('cards.assigned') || 'Tu tarjeta';
        download.title = root.ImmersaI18n?.t('cards.download') || 'Descargar tarjeta';
        download.setAttribute('aria-label', download.title);
      };
      localize();
      root.addEventListener('immersa:locale-change', localize);
      let url = '';
      let roundId = '';
      let loading = false;
      function clearDownload() {
        download.hidden = true;
        download.removeAttribute('href');
      }
      function load() {
        loading = true;
        resetZoom?.();
        clearDownload();
        image.hidden = true;
        status.hidden = false;
        status.textContent = '…';
        retry.hidden = true;
        image.src = url;
      }
      image.addEventListener('load', () => {
        if (!url) return;
        loading = false;
        image.style.setProperty('--card-aspect', (image.naturalWidth / image.naturalHeight) || 1);
        image.hidden = false;
        status.hidden = true;
        retry.hidden = true;
        const extension = new URL(image.src).pathname.match(/\.(png|jpe?g|webp|svg)$/i)?.[0] || '';
        download.href = image.src;
        download.download = 'immersa-tarjeta' + extension;
        download.hidden = false;
      });
      image.addEventListener('error', () => {
        if (!url) return;
        loading = false;
        clearDownload();
        image.hidden = true;
        status.hidden = false;
        status.textContent = '↻';
        retry.hidden = false;
      });
      retry.addEventListener('pointerdown', event => event.stopPropagation());
      retry.addEventListener('click', load);
      socket.on('selfie:state', state => {
        overlay.hidden = !state?.active;
        if (!state?.active) {
          resetZoom?.();
          url = '';
          roundId = '';
          loading = false;
          clearDownload();
          image.removeAttribute('src');
          return;
        }
        const nextUrl = state.image?.url || '';
        if (url === nextUrl && roundId === state.roundId && (loading || image.naturalWidth > 0)) return;
        url = nextUrl;
        roundId = state.roundId;
        if (url) load();
      });
      // Keep the assigned image visible during temporary disconnects.
      return { element: overlay };
    }
  };
})(window);
