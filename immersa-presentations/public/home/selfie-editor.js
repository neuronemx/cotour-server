(function () {
  function createEditor(panel, globalCollection = false) {
  if (!panel) return;
  const list = panel.querySelector('[data-selfie-images]');
  const status = panel.querySelector('[role=status]');
  const input = panel.querySelector('input[type=file]');
  let deckId = globalCollection ? 'ping' : '', epoch = 0, config = null, busy = false;
  const message = text => { status.textContent = text; };
  function controls() {
    panel.querySelectorAll('input,select,button').forEach(node => { node.disabled = busy || !config; });
    panel.querySelector('[data-selfie-refresh]').disabled = busy || !deckId;
  }
  function render() {
    list.replaceChildren();
    panel.querySelector('[data-selfie-source]').textContent = globalCollection
      ? (config.provisional ? 'Aún se usan las imágenes provisionales. Sube aquí la colección de PING.' : config.images.length + ' imágenes de PING disponibles para todos los Decks.')
      : (config.custom ? config.images.length + ' imágenes propias. Este Deck las usará automáticamente.' : 'Este Deck usa la colección de PING. Al subir imágenes, usará las tuyas automáticamente.');
    panel.querySelector('[data-selfie-reset]').hidden = globalCollection || !config.custom;
    config.images.forEach(item => {
      const figure = document.createElement('figure'), image = document.createElement('img');
      image.src = item.url; image.alt = 'Imagen de la colección'; image.loading = 'lazy';
      figure.appendChild(image);
      if (config.custom) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Eliminar';
        button.addEventListener('click', () => request('DELETE', '/image', { revision: config.revision, url: item.url }));
        figure.appendChild(button);
      }
      list.appendChild(figure);
    });
    controls();
  }
  async function request(method = 'GET', suffix = '', body) {
    if (!deckId || busy) return;
    const mine = epoch; busy = true; controls(); message(method === 'GET' ? 'Cargando…' : 'Guardando…');
    try {
      const multipart = body instanceof FormData;
      const response = await fetch((globalCollection ? '/api/admin/selfie/ping' : '/api/decks/' + encodeURIComponent(deckId) + '/selfie') + suffix, {
        method, credentials: 'same-origin', cache: 'no-store',
        ...(body ? { body: multipart ? body : JSON.stringify(body), ...(multipart ? {} : { headers: { 'Content-Type': 'application/json' } }) } : {})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar.');
      if (mine !== epoch) return;
      config = data; render(); message(method === 'GET' ? '' : 'Guardado. La colección se usará en la próxima Selfie.');
      if (globalCollection && method !== 'GET') document.dispatchEvent(new CustomEvent('immersa:ping-collection-updated'));
    } catch (error) { if (mine === epoch) message(error.message); }
    finally { if (mine === epoch) { busy = false; input.value = ''; controls(); } }
  }
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    if (!files.length || !config || busy) return;
    if (files.length > 20 || files.some(file => file.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type))) {
      message('Selecciona hasta 20 imágenes PNG, JPG o WebP de máximo 5 MB cada una.'); input.value = ''; return;
    }
    const body = new FormData();
    body.append('revision', String(config.revision)); body.append('replace', 'false');
    files.forEach(file => body.append('images', file));
    request('POST', '', body);
  });
  panel.querySelector('[data-selfie-reset]').addEventListener('click', () => request('DELETE', '', { revision: config.revision }));
  panel.querySelector('[data-selfie-refresh]').addEventListener('click', () => request());
  function clear() { epoch++; busy = false; config = null; deckId = ''; list.replaceChildren(); message(''); input.value = ''; controls(); }
  if (!globalCollection) document.addEventListener('immersa:deck-detail-open', event => {
    clear(); deckId = event.detail?.deck?.missing ? '' : String(event.detail?.deck?.deckId || '');
    request();
  });
  if (!globalCollection) document.addEventListener('immersa:deck-detail-close', clear);
  if (!globalCollection) document.addEventListener('immersa:ping-collection-updated', () => { if (deckId && !config?.custom) request(); });
  controls();
  return { load: () => request() };
  }
  createEditor(document.getElementById('selfieEditor'));
  const admin = document.getElementById('pingSelfieAdmin');
  const globalEditor = createEditor(document.getElementById('pingSelfieEditor'), true);
  if (admin && globalEditor) {
    fetch('/api/account/plan', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(plan => { admin.hidden = plan?.admin !== true; })
      .catch(() => {});
    admin.addEventListener('toggle', () => { if (admin.open) globalEditor.load(); });
  }
})();
