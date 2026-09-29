(function () {
  const tab = document.getElementById('deckTabLocales');
  const panel = document.getElementById('deckPanelLocales');
  const state = document.getElementById('deckLocaleState');
  const message = document.getElementById('deckLocaleMessage');
  const upload = document.getElementById('deckLocaleUpload');
  const file = document.getElementById('deckLocaleFile');
  const toggle = document.getElementById('deckLocaleToggle');
  const remove = document.getElementById('deckLocaleDelete');
  if (!tab || !panel) return;
  let deckId = '';
  let variant = null;
  let busy = false;
  function endpoint() { return '/api/decks/' + encodeURIComponent(deckId) + '/locales/en'; }
  function show(text, error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
  }
  function render() {
    state.textContent = variant ? (variant.active ? 'Listo · Activo' : variant.requiresCorrection ? 'Requiere corrección' : 'Desactivado') : 'No agregado';
    upload.textContent = variant ? 'Sustituir presentación English' : 'Agregar English';
    toggle.hidden = !variant;
    toggle.textContent = variant?.active ? 'Desactivar' : 'Activar';
    remove.hidden = !variant;
    [upload, toggle, remove].forEach((button) => { button.disabled = busy; });
  }
  async function jsonResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo actualizar English');
    return data;
  }
  async function refresh() {
    if (!deckId || tab.disabled) return;
    const selected = deckId;
    try {
      const response = await fetch('/api/decks/' + encodeURIComponent(selected) + '/locales', { cache: 'no-store' });
      const data = await jsonResponse(response);
      if (deckId !== selected) return;
      variant = data.en;
      render();
    } catch (error) { show(error.message, true); }
  }
  async function action(request, success) {
    if (busy || !deckId) return;
    busy = true;
    render();
    show('Guardando…');
    try {
      await jsonResponse(await fetch(endpoint(), request));
      await refresh();
      show(success);
    } catch (error) { show(error.message, true); }
    finally { busy = false; render(); }
  }
  document.addEventListener('immersa:deck-detail-open', (event) => {
    deckId = String(event.detail?.deck?.deckId || '');
    variant = null;
    const enabled = event.detail?.capabilities?.['multilanguage.manage'] === true
      && !event.detail?.deck?.missing && !event.detail?.deck?.immutable;
    tab.disabled = !enabled;
    tab.setAttribute('aria-disabled', String(!enabled));
    tab.title = enabled ? 'Gestionar idiomas del Deck' : 'Disponible en planes SPEAKER';
    show('');
    render();
    if (enabled) void refresh();
  });
  document.addEventListener('immersa:deck-detail-close', () => { deckId = ''; });
  upload.addEventListener('click', () => { if (!busy) file.click(); });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    if (!/\.(pptx|pdf)$/i.test(selected.name)) return show('Selecciona un PPTX o PDF.', true);
    const form = new FormData();
    form.append('pptx', selected);
    void action({ method: 'POST', body: form }, 'English está listo para el Público.');
  });
  toggle.addEventListener('click', () => void action({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !variant?.active }) }, variant?.active ? 'English desactivado.' : 'English activado.'));
  remove.addEventListener('click', () => {
    if (window.confirm('¿Eliminar la presentación English de este Deck?')) void action({ method: 'DELETE' }, 'English eliminado.');
  });
})();
