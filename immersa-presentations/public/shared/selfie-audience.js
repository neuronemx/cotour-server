(function (root) {
  root.ImmersaSelfieAudience = {
    create({ socket }) {
      const overlay = document.createElement('section');
      overlay.className = 'selfie-audience';
      overlay.hidden = true;
      const image = document.createElement('img');
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '↻';
      retry.setAttribute('aria-label', 'Volver a cargar imagen');
      retry.hidden = true;
      overlay.append(image, status, retry);
      document.body.appendChild(overlay);
      const localize = () => {
        overlay.setAttribute('aria-label', root.ImmersaI18n?.t('shell.selfie') || 'Tarjetas');
        image.alt = root.ImmersaI18n?.t('cards.assigned') || 'Tu tarjeta';
      };
      localize();
      root.addEventListener('immersa:locale-change', localize);
      let url = '';
      let roundId = '';
      let loading = false;
      function load() {
        loading = true;
        image.hidden = true;
        status.hidden = false;
        status.textContent = '…';
        retry.hidden = true;
        image.src = url;
      }
      image.addEventListener('load', () => {
        loading = false;
        image.hidden = false;
        status.hidden = true;
        retry.hidden = true;
      });
      image.addEventListener('error', () => {
        loading = false;
        image.hidden = true;
        status.hidden = false;
        status.textContent = '↻';
        retry.hidden = false;
      });
      retry.addEventListener('click', load);
      socket.on('selfie:state', state => {
        overlay.hidden = !state?.active;
        document.body.classList.toggle('selfie-active', Boolean(state?.active));
        if (!state?.active) { url = ''; roundId = ''; image.removeAttribute('src'); return; }
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
