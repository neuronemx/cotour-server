(function () {
  'use strict';
  const panel = document.getElementById('deckSpeakersEditor'), tab = document.getElementById('deckTabSpeakers');
  if (!panel || !tab) return;
  const list = panel.querySelector('[data-speakers-list]'), status = panel.querySelector('[data-speakers-status]');
  const enabled = panel.querySelector('[name="enabled"]'), form = panel.querySelector('form');
  const photo = panel.querySelector('[name="photo"]'), preview = panel.querySelector('[data-speakers-photo]');
  const heading = panel.querySelector('[data-speakers-heading]'), fields = ['displayName','publicTitle','roleTitle','company','bio','websiteUrl','linkedinUrl','instagramUrl'];
  let allowed = false, deckId = '', config = null, selectedId = null, busy = false, epoch = 0, readEpoch = 0;
  const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
  const base = () => '/api/decks/' + encodeURIComponent(deckId) + '/speakers';
  async function api(url, options = {}) {
    const response = await fetch(url, {cache:'no-store', credentials:'same-origin', ...options});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || 'No se pudieron cargar los perfiles.'); error.code = data.code; throw error; }
    return data;
  }
  function controls() {
    panel.querySelectorAll('button, input, select, textarea').forEach(node => { node.disabled = busy || !config; });
    photo.disabled = busy || !config || !selectedId;
    panel.querySelector('[data-speakers-refresh]').disabled = busy || !deckId;
    list.querySelectorAll('[data-boundary="true"]').forEach(node => { node.disabled = true; });
    panel.setAttribute('aria-busy', String(busy));
  }
  function resetForm(id = null) {
    selectedId = id;
    const profile = config?.profiles.find(p => p.id === id);
    form.reset();
    for (const field of fields) form.elements[field].value = profile?.[field] || (field === 'publicTitle' ? 'Speaker' : '');
    photo.value = ''; preview.hidden = !profile?.photoUrl;
    if (profile?.photoUrl) { preview.src = profile.photoUrl; preview.alt = 'Foto de ' + profile.displayName; } else preview.removeAttribute('src');
    heading.textContent = profile ? 'Editar ponente' : 'Nuevo ponente';
    panel.querySelector('[data-speakers-photo-hint]').textContent = profile ? 'Cambiar foto (PNG, JPG o WebP, hasta 5 MB).' : 'Guarda el perfil para agregar su foto. Se creará apagado.';
    controls();
  }
  function button(text, label, action) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.setAttribute('aria-label', label); node.addEventListener('click', action); return node;
  }
  function render() {
    enabled.checked = config.enabled;
    const currentTitle = form.elements.publicTitle.value;
    form.elements.publicTitle.replaceChildren(...config.publicTitles.map(title => { const option = document.createElement('option'); option.value = title; option.textContent = title; return option; }));
    form.elements.publicTitle.value = config.publicTitles.includes(currentTitle) ? currentTitle : 'Speaker';
    list.replaceChildren();
    if (!config.profiles.length) { const empty = document.createElement('p'); empty.textContent = 'Todavía no hay ponentes. Agrega los que necesites.'; list.appendChild(empty); }
    config.profiles.forEach((profile, index) => {
      const row = document.createElement('div'); row.className = 'deck-speaker-row';
      const title = document.createElement('div'), name = document.createElement('strong'), detail = document.createElement('span');
      name.textContent = profile.displayName; detail.textContent = profile.publicTitle + (profile.roleTitle ? ' · ' + profile.roleTitle : ''); title.append(name, detail);
      const toggle = button(profile.active ? 'Encendido' : 'Apagado', 'Mostrar ' + profile.displayName, () => mutate('/' + profile.id + '/active', 'PUT', {active:!profile.active}));
      toggle.setAttribute('role','switch'); toggle.setAttribute('aria-checked',String(profile.active));
      const edit = button('Editar','Editar ' + profile.displayName, () => { resetForm(profile.id); form.elements.displayName.focus(); });
      const up = button('↑','Subir ' + profile.displayName, () => reorder(index,-1));
      const down = button('↓','Bajar ' + profile.displayName, () => reorder(index,1));
      up.dataset.boundary = String(index === 0); down.dataset.boundary = String(index === config.profiles.length - 1);
      row.append(title,toggle,edit,up,down); list.appendChild(row);
    });
    panel.querySelector('[data-speakers-summary]').textContent = config.enabled
      ? (config.profiles.filter(p => p.active).length + ' perfiles visibles. Si todos están apagados, Público ocultará la pestaña Ponentes.')
      : 'Este Deck muestra tu perfil personal. Activa esta opción para usar su propia lista de ponentes.';
    controls();
  }
  async function load() {
    if (!allowed || !deckId || busy) return;
    const mine = epoch, request = ++readEpoch;
    message('Cargando ponentes…');
    try {
      const data = await api(base());
      if (mine !== epoch || request !== readEpoch) return;
      config = data; render();
      message('Lista actualizada. Los cambios guardados se envían a Público automáticamente.');
    } catch (error) { if (mine === epoch && request === readEpoch) message(error.message, true); }
    controls();
  }
  async function mutate(suffix, method, body, after) {
    if (busy || !config) return;
    const mine = epoch; ++readEpoch; busy = true; controls(); message('Guardando…');
    try {
      const data = await api(base() + suffix, {method, headers:{'Content-Type':'application/json'}, body:JSON.stringify({...body, expectedRevision:config.revision})});
      if (mine !== epoch) return;
      config = data; render(); if (after) after(data);
      message('Guardado. Público se actualiza automáticamente, sin recargar la presentación.');
    } catch (error) {
      if (mine === epoch) {
        message(error.code === 'PROFILE_REVISION_CONFLICT' ? error.message + ' Usa “Actualizar lista”; tus campos permanecen aquí.' : error.message, true);
        enabled.checked = config.enabled;
      }
    } finally { if (mine === epoch) { busy = false; controls(); } }
  }
  function reorder(index, delta) {
    const ids = config.profiles.map(p => p.id), other = index + delta;
    if (other < 0 || other >= ids.length) return;
    [ids[index],ids[other]] = [ids[other],ids[index]]; mutate('/order','PUT',{profileIds:ids});
  }
  enabled.addEventListener('change', () => mutate('/settings','PUT',{enabled:enabled.checked}));
  panel.querySelector('[data-speakers-refresh]').addEventListener('click', load);
  panel.querySelector('[data-speakers-new]').addEventListener('click', () => { resetForm(); form.elements.displayName.focus(); });
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!config || !form.reportValidity()) return;
    const body = Object.fromEntries(fields.map(field => [field, form.elements[field].value]));
    body.active = selectedId ? config.profiles.find(p => p.id === selectedId)?.active === true : false;
    const before = new Set(config.profiles.map(p => p.id));
    mutate(selectedId ? '/' + selectedId : '', selectedId ? 'PUT' : 'POST', body, data => {
      const id = selectedId || data.profiles.find(p => !before.has(p.id))?.id;
      resetForm(id);
    });
  });
  photo.addEventListener('change', async () => {
    const file = photo.files?.[0]; if (!file || busy || !selectedId || !config) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { message('Usa una foto PNG, JPG o WebP de hasta 5 MB.',true); photo.value = ''; return; }
    const mine = epoch; ++readEpoch; busy = true; controls(); message('Guardando foto…');
    const body = new FormData(); body.append('photo',file); body.append('expectedRevision',String(config.revision));
    try {
      const data = await api(base() + '/' + selectedId + '/photo',{method:'POST',body});
      if (mine !== epoch) return;
      config = data; render(); const profile = data.profiles.find(p => p.id === selectedId);
      preview.src = profile.photoUrl; preview.alt = 'Foto de ' + profile.displayName; preview.hidden = false;
      message('Foto guardada. Público se actualiza automáticamente.');
    } catch (error) { if (mine === epoch) message(error.message, true); }
    finally { if (mine === epoch) { busy = false; photo.value = ''; controls(); } }
  });
  preview.addEventListener('error', () => { preview.hidden = true; });
  document.addEventListener('immersa:deck-detail-open', event => {
    epoch++; readEpoch++; busy = false; config = null; selectedId = null;
    deckId = event.detail?.deck?.missing ? '' : String(event.detail?.deck?.deckId || '');
    list.replaceChildren(); form.reset(); preview.hidden = true; controls();
    heading.textContent = 'Nuevo ponente';
    panel.querySelector('[data-speakers-photo-hint]').textContent = 'Guarda el perfil para agregar su foto. Se creará apagado.';
    if (allowed && deckId) load();
  });
  document.addEventListener('immersa:deck-detail-close', () => { epoch++; readEpoch++; deckId = ''; config = null; busy = false; form.reset(); });
  controls();
  api('/api/deck-speaker-profiles/capability').then(data => {
    allowed = data.enabled === true; tab.hidden = !allowed; tab.disabled = !allowed; tab.setAttribute('aria-disabled',String(!allowed));
    if (allowed && deckId) load();
  }).catch(() => {});
})();
