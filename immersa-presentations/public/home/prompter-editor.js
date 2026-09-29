(function () {
  const modal = document.getElementById('prompterModal');
  const esField = document.getElementById('prompterModalText');
  const enField = document.getElementById('prompterModalEnglish');
  const enWrapper = document.getElementById('prompterModalEnglishField');
  const status = document.getElementById('prompterModalStatus');
  const count = document.getElementById('prompterModalCount');
  let deck;
  let data;
  let slide;
  let bilingual = false;
  const words = (value) => String(value || '').trim().split(/\s+/).filter(Boolean).length;
  function updateCount() { count.textContent = words(esField.value) + ' palabras ES' + (bilingual ? ' · ' + words(enField.value) + ' palabras EN' : ''); }
  function close() { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); }
  async function open(request) {
    deck = request.deck;
    slide = request;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('prompterModalSlide').textContent = 'Slide ' + (slide.slideIndex + 1);
    const response = await fetch('/api/decks/' + encodeURIComponent(deck.deckId) + '/interactions');
    data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el Apuntador.');
    const saved = data.prompter?.[slide.slideId];
    esField.value = typeof saved === 'object' && saved ? saved.es || '' : saved || '';
    enField.value = typeof saved === 'object' && saved ? saved.en || '' : '';
    enWrapper.hidden = !bilingual;
    status.textContent = '';
    updateCount();
    esField.focus();
  }
  async function persist(remove) {
    if (!data || !deck || !slide) return;
    const prompter = { ...(data.prompter || {}) };
    const old = prompter[slide.slideId];
    const previousEnglish = typeof old === 'object' && old ? String(old.en || '') : '';
    const es = remove ? '' : esField.value.trim();
    const en = bilingual ? (remove ? '' : enField.value.trim()) : previousEnglish;
    if (!es && !en) delete prompter[slide.slideId];
    else prompter[slide.slideId] = en || bilingual ? { es, en } : es;
    const response = await fetch('/api/decks/' + encodeURIComponent(deck.deckId) + '/interactions', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interactions: data.interactions || [], prompter })
    });
    const result = await response.json();
    if (!response.ok) return void (status.textContent = result.error || 'No se pudo guardar.');
    data = result;
    if (remove) { esField.value = ''; if (bilingual) enField.value = ''; status.textContent = 'Apuntador borrado.'; updateCount(); }
    else close();
  }
  document.addEventListener('immersa:deck-detail-open', (event) => {
    bilingual = event.detail?.capabilities?.['multilanguage.manage'] === true;
  });
  document.addEventListener('immersa:deck-prompter-slide-request', (event) => open(event.detail).catch((error) => { status.textContent = error.message; }));
  esField?.addEventListener('input', updateCount);
  enField?.addEventListener('input', updateCount);
  document.getElementById('prompterModalSave')?.addEventListener('click', () => persist(false));
  document.getElementById('prompterModalDelete')?.addEventListener('click', () => persist(true));
  document.getElementById('prompterModalClose')?.addEventListener('click', close);
  modal?.addEventListener('click', (event) => { if (event.target === modal) close(); });
})();
