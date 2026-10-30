(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventRehearsalTools = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const uuid = x => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x);
  const text = (x, max) => typeof x === 'string' && x.length <= max;
  const check = x => { if (!x) throw new Error('INVALID_REHEARSAL_TOOLS'); };
  function validate(view, prefix, origin) {
    const t = view.tools, p = t?.polls;
    check(uuid(view.runId) && t && Array.isArray(t.media) && t.media.length <= 200 && Array.isArray(t.playlists) && t.playlists.length <= 100);
    const ids = new Set();
    for (const r of t.media) {
      check(r && text(r.id, 120) && r.id && !ids.has(r.id) && text(r.name, 120) && ['audio', 'video'].includes(r.type)
        && typeof r.duration === 'number' && Number.isFinite(r.duration) && r.duration > 0 && r.duration <= 86400 && typeof r.url === 'string');
      const url = new URL(r.url, origin), start = prefix + '/media/' + view.runId + '/';
      check(url.origin === origin && url.pathname.startsWith(start) && /^[a-f0-9]{64}\/[a-zA-Z0-9_-]{1,120}$/.test(url.pathname.slice(start.length)) && !url.search && !url.hash);
      ids.add(r.id);
    }
    const lists = new Set();
    for (const list of t.playlists) {
      check(list && text(list.id, 120) && list.id && !lists.has(list.id) && text(list.name, 120) && ['audio', 'video'].includes(list.type)
        && Array.isArray(list.resourceIds) && list.resourceIds.length > 0 && list.resourceIds.length <= 200 && new Set(list.resourceIds).size === list.resourceIds.length
        && list.resourceIds.every(id => t.media.some(r => r.id === id && r.type === list.type))); lists.add(list.id);
    }
    check(p && Array.isArray(p.available) && p.available.length <= 500 && typeof p.responded === 'boolean' && typeof p.resultsVisible === 'boolean');
    check(p.available.every(x => x && text(x.id, 120) && x.id && text(x.title, 1000)) && new Set(p.available.map(x => x.id)).size === p.available.length);
    if (p.active) {
      const a = p.active;
      check(uuid(p.runId) && p.available.some(x => x.id === a.id) && text(a.prompt, 2000) && text(a.title, 1000)
        && Array.isArray(a.options) && a.options.length >= 2 && a.options.length <= 20 && new Set(a.options.map(x => x.id)).size === a.options.length
        && a.options.every(x => text(x.id, 120) && x.id && text(x.label, 500)) && a.en && text(a.en.prompt, 2000) && a.en.options && typeof a.en.options === 'object'
        && Object.values(a.en.options).every(x => text(x, 500)));
      if (p.resultsVisible) {
        check(p.results && [0, 1].includes(p.results.totalResponses) && Array.isArray(p.results.options) && p.results.options.length === a.options.length
          && p.results.options.every((x, i) => x.id === a.options[i].id && [0, 1].includes(x.count))
          && p.results.options.reduce((sum, x) => sum + x.count, 0) === p.results.totalResponses);
      } else check(p.results === null);
    } else check(p.runId === null && p.results === null && !p.responded && !p.resultsVisible);
    return t;
  }
  function create({ document, origin, sendPoll }) {
    const $ = id => document.getElementById(id);
    let view = null, pending = false, generation = 0;
    const playback = { audio: null, video: null };
    const button = (label, action, disabled = false) => {
      const b = document.createElement('button'); b.textContent = label; b.disabled = disabled || pending;
      b.addEventListener('click', action); return b;
    };
    function stop(type) {
      const element = $(type === 'video' ? 'rehearsal-video' : 'rehearsal-audio');
      playback[type] = null; element.pause(); element.removeAttribute('src'); element.load(); element.hidden = true;
    }
    function clear() {
      generation++; view = null;
      for (const type of ['audio', 'video']) stop(type);
      for (const id of ['poll-catalog', 'poll-preview', 'media-catalog']) $(id).replaceChildren();
      $('media-status').textContent = ''; $('tools').hidden = true; $('poll-preview').hidden = true;
    }
    function play(resource, list = null, index = 0) {
      if (!view || pending) return;
      const element = $(resource.type === 'video' ? 'rehearsal-video' : 'rehearsal-audio'), epoch = generation;
      stop(resource.type); playback[resource.type] = { resource, list, index, epoch };
      element.src = new URL(resource.url, origin).href; element.loop = !list && $('media-loop').checked;
      element.hidden = false; $('media-status').textContent = resource.name;
      try { Promise.resolve(element.play()).catch(() => {
        if (epoch === generation && playback[resource.type]?.resource === resource) $('media-status').textContent = 'Pulsa reproducir en el control del medio para continuar.';
      }); } catch (_) { $('media-status').textContent = 'Pulsa reproducir en el control del medio para continuar.'; }
    }
    function renderPoll() {
      const p = view.tools.polls, language = view.language;
      const translated = (es, en) => language === 'en' && en ? en : es;
      $('poll-catalog').replaceChildren(...p.available.map(item => button(item.title, () => sendPoll({ command: 'launch', interactionId: item.id }), !!p.active || !!view.tools.knowledge?.executionId || !!view.tools.raffle?.controller)));
      if (!p.available.length) { const empty = document.createElement('p'); empty.textContent = 'Esta versión no tiene Encuestas.'; $('poll-catalog').replaceChildren(empty); }
      const preview = $('poll-preview'); preview.replaceChildren(); preview.hidden = !p.active;
      if (!p.active) return;
      const heading = document.createElement('h3'); heading.textContent = translated(p.active.prompt, p.active.en.prompt); preview.append(heading);
      const options = document.createElement('div'); options.className = 'poll-options';
      for (const option of p.active.options) {
        const label = translated(option.label, p.active.en.options[option.id]);
        const result = p.results?.options.find(x => x.id === option.id);
        options.append(button(label + (p.resultsVisible ? ' · ' + result.count : ''), () => sendPoll({ command: 'respond', pollRunId: p.runId, optionId: option.id }), p.responded));
      }
      preview.append(options);
      const hint = document.createElement('p'); hint.className = 'sample-hint';
      hint.textContent = p.responded ? 'Respuesta de prueba registrada sólo en este ensayo.' : 'Elige una opción para probar una respuesta. No se registra participación real.'; preview.append(hint);
      preview.append(button(p.resultsVisible ? 'Ocultar resultados' : 'Mostrar resultados', () => sendPoll({ command: p.resultsVisible ? 'hide' : 'show', pollRunId: p.runId })),
        button('Cerrar Encuesta', () => sendPoll({ command: 'close', pollRunId: p.runId })));
    }
    function renderMedia() {
      const t = view.tools, container = $('media-catalog');
      container.replaceChildren(...t.media.map(r => button((r.type === 'audio' ? 'Audio: ' : 'Video: ') + r.name, () => play(r))),
        ...t.playlists.map(list => button('Lista: ' + list.name, () => play(t.media.find(r => r.id === list.resourceIds[0]), list))));
      if (!t.media.length) { const empty = document.createElement('p'); empty.textContent = 'Esta versión no tiene medios seleccionados.'; container.append(empty); }
    }
    function update(next, prefix) {
      validate(next, prefix, origin);
      if (view?.runId !== next.runId) clear();
      view = next; $('tools').hidden = false; renderPoll(); renderMedia();
    }
    for (const type of ['audio', 'video']) {
      const element = $(type === 'video' ? 'rehearsal-video' : 'rehearsal-audio');
      element.addEventListener('ended', () => {
        const old = playback[type]; if (!old || !view || old.epoch !== generation) return;
        const list = old.list, next = list && (list.resourceIds[old.index + 1] ? old.index + 1 : $('media-loop').checked ? 0 : -1);
        if (list && next >= 0) play(view.tools.media.find(r => r.id === list.resourceIds[next]), list, next);
        else stop(type);
      });
      element.addEventListener('error', () => { if (!playback[type]) return; stop(type); $('media-status').textContent = 'No se pudo cargar el medio. Vuelve a conectar para comprobar el acceso.'; });
      $('stop-' + type).addEventListener('click', () => stop(type));
    }
    $('media-loop').addEventListener('change', () => {
      for (const type of ['audio', 'video']) $(type === 'video' ? 'rehearsal-video' : 'rehearsal-audio').loop = !playback[type]?.list && $('media-loop').checked;
    });
    return { clear, update, setPending(value) { pending = value; if (view) { renderPoll(); renderMedia(); } }, validate };
  }
  return { create, validate };
});
