(function () {
  const trigger = document.getElementById('detailLanguage');
  const modal = document.getElementById('deckLanguageModal');
  const close = document.getElementById('deckLanguageClose');
  const note = document.getElementById('deckLanguageNote');
  const message = document.getElementById('deckLocaleMessage');
  const upload = document.getElementById('deckLocaleUpload');
  const file = document.getElementById('deckLocaleFile');
  const toggle = document.getElementById('deckLocaleToggle');
  const remove = document.getElementById('deckLocaleDelete');
  if (!trigger || !modal) return;

  let deckId = '';
  let variant = null;
  let enabled = false;
  let busy = false;

  function endpoint() { return '/api/decks/' + encodeURIComponent(deckId) + '/locales/en'; }
  function show(text, error = false) {
    message.textContent = text;
    message.classList.toggle('is-error', error);
    message.classList.toggle('is-success', Boolean(text) && !error);
  }
  function render() {
    upload.textContent = variant ? 'Reemplazar' : 'Subir versión Inglés';
    toggle.hidden = !variant;
    toggle.textContent = variant?.active ? 'Desactivar' : 'Activar';
    remove.hidden = !variant;
    note.hidden = Boolean(variant);
    [upload, toggle, remove].forEach((button) => { button.disabled = busy; });
  }
  function openModal() {
    if (!enabled || !deckId) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    show('');
    render();
    void refresh();
    window.setTimeout(() => close?.focus(), 20);
  }
  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    if (!document.getElementById('deckDetailModal')?.hidden) trigger.focus();
  }
  async function jsonResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la versión en Inglés');
    return data;
  }
  async function refresh() {
    if (!deckId || !enabled) return;
    const selected = deckId;
    try {
      const response = await fetch('/api/decks/' + encodeURIComponent(selected) + '/locales', { cache: 'no-store' });
      const data = await jsonResponse(response);
      if (deckId !== selected) return;
      variant = data.en;
      render();
      document.dispatchEvent(new CustomEvent('immersa:deck-locale-updated', { detail: { deckId, variant } }));
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
    enabled = event.detail?.capabilities?.['multilanguage.manage'] === true
      && !event.detail?.deck?.missing && !event.detail?.deck?.immutable && !event.detail?.deck?.systemDemo;
    show('');
    render();
  });
  document.addEventListener('immersa:deck-detail-close', () => {
    closeModal();
    deckId = '';
    enabled = false;
  });
  trigger.addEventListener('click', openModal);
  close.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });
  upload.addEventListener('click', () => { if (!busy) file.click(); });
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (!selected) return;
    if (!/\.(pptx|pdf)$/i.test(selected.name)) return show('Selecciona un PPTX o PDF.', true);
    const form = new FormData();
    form.append('pptx', selected);
    void action(
      { method: 'POST', body: form },
      'Versión en Inglés cargada. Recuerda también incluir los textos en Inglés en Encuestas y Trivias.'
    );
  });
  toggle.addEventListener('click', () => void action(
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !variant?.active }) },
    variant?.active ? 'Versión en Inglés desactivada.' : 'Versión en Inglés activada.'
  ));
  remove.addEventListener('click', () => {
    if (window.confirm('¿Eliminar la versión en Inglés de este Deck?')) void action({ method: 'DELETE' }, 'Versión en Inglés eliminada.');
  });
})();
