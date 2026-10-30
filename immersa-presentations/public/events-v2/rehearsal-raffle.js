(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventRehearsalRaffle = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  const uuid = x => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x);
  const text = (x, max) => typeof x === 'string' && x.length <= max;
  const token = x => text(x, 96) && x.trim().length > 0;
  const integer = x => Number.isSafeInteger(x) && x >= 0 && x <= 20;
  const check = x => { if (!x) throw new Error('INVALID_REHEARSAL_RAFFLE'); };
  function validate(view, prefix) {
    const r = view.tools?.raffle;
    check(uuid(view.runId) && r && r.maxSamples === 20 && Array.isArray(r.available) && r.available.length <= 500
      && Array.isArray(r.samples) && r.samples.length <= 20 && r.samples.every(s => uuid(s.id) && text(s.name, 120) && s.name.trim())
      && new Set(r.samples.map(s => s.id)).size === r.samples.length && integer(r.previousWinnerCount)
      && Array.isArray(r.winners) && r.winners.length <= 20 && Number.isSafeInteger(r.serverNow)
      && (r.raffleRunId === null || uuid(r.raffleRunId)));
    const winner = w => check(w && text(w.name, 120) && text(w.label, 500) && Number.isSafeInteger(w.ticketNumber) && w.ticketNumber >= 1 && w.ticketNumber <= 20);
    const option = (o, executionId) => {
      check(o && token(o.id) && text(o.label, 500));
      if (o.image) {
        const start = prefix + '/raffle-images/' + view.runId + '/';
        check(typeof o.image.url === 'string' && o.image.url.startsWith(start)
          && new RegExp('^[a-f0-9]{64}/' + executionId + '/[a-f0-9-]{36}$', 'i').test(o.image.url.slice(start.length))
          && ['width', 'height'].every(k => Number.isSafeInteger(o.image[k]) && o.image[k] > 0 && o.image[k] <= 4096));
      }
    };
    for (const d of r.available) {
      check(d && token(d.id) && text(d.title, 240) && ['free', 'poll', 'visual_key'].includes(d.mode)
        && Array.isArray(d.keyOptions) && d.keyOptions.length === (d.mode === 'visual_key' ? 4 : 0));
      d.keyOptions.forEach(o => option(o, 'catalog'));
    }
    check(new Set(r.available.map(d => d.id)).size === r.available.length);
    check(r.draftDefinitionId === null || r.available.some(d => d.id === r.draftDefinitionId && d.keyOptions.some(o => o.id === r.draftOptionId)));
    r.winners.forEach(winner);
    if (!r.controller) { check(r.controller === null && r.screen === null && r.nextDeadlineAt === null); return r; }
    const c = r.controller, s = r.screen;
    check(c && s && c.id === r.raffleRunId && s.id === c.id && c.mode === s.mode && c.state === s.state
      && ['collecting', 'entries_closed', 'drawing', 'winner'].includes(c.state) && text(c.title, 240) && text(c.prompt, 2000)
      && r.available.some(d => d.mode === c.mode) && [2, 3, 4].includes(c.ticketDigits)
      && integer(c.entryCount) && integer(c.eligibleCount) && integer(c.matchingSelectionCount)
      && Array.isArray(c.entries) && c.entries.length === c.entryCount && Array.isArray(c.selections) && c.selections.length <= 20
      && c.entries.every(e => r.samples.some(p => p.id === e.sampleId) && text(e.name, 120) && Number.isSafeInteger(e.ticketNumber) && e.ticketNumber >= 1 && e.ticketNumber <= 20)
      && c.selections.every(e => r.samples.some(p => p.id === e.sampleId) && c.options.some(o => o.id === e.optionId))
      && Array.isArray(c.options) && c.options.length <= 20 && Array.isArray(s.options) && s.options.length <= 20
      && s.entryKey === undefined && s.entries === undefined && s.pendingWinner === undefined && c.pendingWinner === undefined);
    c.options.forEach(o => option(o, c.id)); s.options.forEach(o => option(o, c.id));
    if (s.displayOption) { check(c.mode === 'visual_key' && c.state === 'collecting'); option(s.displayOption, c.id); }
    if (c.state === 'winner') { winner(c.winner); winner(s.winner); check(s.hasWinner === true); }
    else check(c.winner === null && s.winner === undefined && s.hasWinner === false);
    check(c.state === 'drawing' ? Number.isSafeInteger(r.nextDeadlineAt) && Number.isFinite(s.countdownRemainingMs) && s.countdownRemainingMs >= 0 && s.countdownRemainingMs <= 5000
      : r.nextDeadlineAt === null && s.countdownRemainingMs === null);
    return r;
  }
  function create({ document, send }) {
    const $ = id => document.getElementById(id);
    let view, raffle, pending = false, buttons = [], timer, identity, offset = 0;
    const line = (parent, text, tag = 'p') => { const element = document.createElement(tag); element.textContent = text; parent.append(element); return element; };
    function button(label, action, disabled = false) {
      const b = document.createElement('button'); b.textContent = label;
      b.addEventListener('click', () => { if (!pending && view && !b.disabled) action(); }); buttons.push([b, disabled]); return b;
    }
    function controls() {
      for (const [b, disabled] of buttons) b.disabled = pending || disabled;
      const c = raffle?.controller, collecting = c?.state === 'collecting', selected = $('raffle-person').value || '';
      $('raffle-person').disabled = pending || !collecting;
      $('raffle-name').disabled = pending || !collecting || !!selected;
      $('raffle-option').disabled = pending || !collecting || c?.mode === 'free';
      const entered = c?.entries.some(e => e.sampleId === selected), selection = c?.selections.find(e => e.sampleId === selected);
      $('raffle-enter').disabled = pending || !collecting || (!selected && raffle.samples.length >= 20)
        || (c.mode === 'visual_key' ? selection?.optionId === $('raffle-option').value : entered);
    }
    function clear() {
      clearTimeout(timer); view = raffle = null; identity = null; buttons = [];
      for (const id of ['raffle-catalog', 'raffle-controls', 'raffle-entries', 'raffle-winners', 'raffle-preview', 'raffle-person', 'raffle-option']) $(id).replaceChildren();
      $('raffle-tools').hidden = $('raffle-form').hidden = $('raffle-preview').hidden = true;
      $('raffle-name').value = ''; $('raffle-person').value = ''; $('raffle-status').textContent = $('raffle-clock').textContent = ''; controls();
    }
    function command(command, input = {}) { return send({ command, raffleRunId: raffle.raffleRunId, ...input }); }
    function image(parent, option) {
      if (!option?.image) return;
      const img = document.createElement('img'); img.src = option.image.url; img.alt = option.label; img.className = 'raffle-image';
      img.addEventListener('error', () => { img.hidden = true; }); parent.append(img);
    }
    function form() {
      const c = raffle.controller, oldPerson = $('raffle-person').value || '', oldOption = $('raffle-option').value || '';
      const choices = [{ id: '', name: 'Nueva persona de prueba' }, ...raffle.samples];
      $('raffle-person').replaceChildren(...choices.map(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; return o; }));
      $('raffle-person').value = raffle.samples.some(s => s.id === oldPerson) ? oldPerson : '';
      const sample = raffle.samples.find(s => s.id === $('raffle-person').value); if (sample) $('raffle-name').value = sample.name;
      $('raffle-form').hidden = c?.state !== 'collecting'; $('raffle-option-label').hidden = $('raffle-option').hidden = !c || c.mode === 'free';
      $('raffle-option').replaceChildren(...(c?.options || []).map(o => { const e = document.createElement('option'); e.value = o.id; e.textContent = o.label; return e; }));
      $('raffle-option').value = c?.options.some(o => o.id === oldOption) ? oldOption : c?.options[0]?.id || '';
    }
    function render() {
      buttons = []; const r = raffle, c = r.controller, busy = !!c || !!view.tools.polls.active || !!view.tools.knowledge.executionId;
      const catalog = $('raffle-catalog'); catalog.replaceChildren();
      for (const d of r.available) {
        const card = document.createElement('article'); card.append(button('Sorteo: ' + d.title, () => send({ command: 'open', definitionId: d.id }), busy));
        if (d.mode === 'visual_key') {
          line(card, 'Clave visual para practicar:');
          for (const o of d.keyOptions) {
            card.append(button(o.label + (r.draftDefinitionId === d.id && r.draftOptionId === o.id ? ' ✓' : ''), () => send({ command: 'configure_key', definitionId: d.id, optionId: o.id }), busy)); image(card, o);
          }
        }
        catalog.append(card);
      }
      if (!r.available.length) line(catalog, 'Esta versión no tiene Sorteos.');
      const preview = $('raffle-preview'), control = $('raffle-controls'), entries = $('raffle-entries'), winners = $('raffle-winners');
      preview.replaceChildren(); control.replaceChildren(); entries.replaceChildren(); winners.replaceChildren(); preview.hidden = !c;
      if (c) {
        line(preview, c.title, 'h3');
        const labels = { collecting: c.prompt, entries_closed: 'Participación de prueba cerrada.', drawing: 'Buscando ganador de prueba…', winner: 'Ganador de prueba' };
        line(preview, labels[c.state]);
        if (r.screen.displayOption) { line(preview, r.screen.displayOption.label); image(preview, r.screen.displayOption); }
        if (c.state === 'winner') line(preview, r.screen.winner.name + ' · Boleto ' + String(r.screen.winner.ticketNumber).padStart(c.ticketDigits, '0'));
        const count = c.mode === 'visual_key' && c.state === 'collecting' ? c.matchingSelectionCount : c.entryCount;
        line(control, 'Participaciones de prueba: ' + count + ' · Elegibles: ' + c.eligibleCount);
        if (c.state === 'collecting') control.append(button('Cerrar participación de prueba', () => command('close_entries'), count === 0));
        if (c.state === 'entries_closed') control.append(button('Sortear en el ensayo', () => command('draw'), c.eligibleCount === 0));
        if (c.state === 'drawing') control.append(button('Revelar ganador de prueba', () => command('reveal')));
        control.append(button('Cerrar sorteo de prueba', () => command('close')));
        for (const e of c.entries) line(entries, e.name + ' · Boleto ' + String(e.ticketNumber).padStart(c.ticketDigits, '0'));
        if (c.mode === 'visual_key' && c.state === 'collecting') for (const s of c.selections) line(entries,
          r.samples.find(p => p.id === s.sampleId).name + ' · Selección: ' + c.options.find(o => o.id === s.optionId).label);
        if (c.pollResults) for (const o of c.pollResults.options) line(entries, o.label + ': ' + o.count);
      }
      if (r.previousWinnerCount) {
        line(winners, 'Ganadores anteriores de prueba: ' + r.previousWinnerCount);
        for (const w of r.winners) line(winners, w.name);
        if (!c || c.state === 'entries_closed') winners.append(button('Reiniciar ganadores de prueba', () => command('reset_winners')));
      }
      $('raffle-tools').hidden = false; form(); controls();
    }
    function update(next, prefix) {
      const r = validate(next, prefix); if (identity !== next.runId) { clear(); identity = next.runId; }
      clearTimeout(timer); view = next; raffle = r; offset = r.serverNow - Date.now(); render();
      function clock() {
        if (!view) return;
        $('raffle-clock').textContent = r.nextDeadlineAt === null ? '' : 'Ganador en ' + Math.max(0, Math.ceil((r.nextDeadlineAt - Date.now() - offset) / 1000)) + ' s';
        if (r.nextDeadlineAt !== null) { timer = setTimeout(clock, 250); timer?.unref?.(); }
      }
      clock();
    }
    $('raffle-person').addEventListener('change', () => {
      const sample = raffle?.samples.find(s => s.id === $('raffle-person').value); $('raffle-name').value = sample?.name || ''; controls();
    });
    $('raffle-option').addEventListener('change', controls);
    $('raffle-enter').addEventListener('click', async () => {
      if (!view || pending || $('raffle-enter').disabled) return;
      const name = $('raffle-name').value.trim(); if (!name || name.length > 120) { $('raffle-status').textContent = 'Escribe un nombre de prueba de hasta 120 caracteres.'; return; }
      const epoch = identity, ok = await command('enter', { sampleId: $('raffle-person').value || null, name,
        ...(raffle.controller.mode === 'free' ? {} : { optionId: $('raffle-option').value }) });
      if (ok && epoch === identity) { if (!$('raffle-person').value) $('raffle-name').value = ''; $('raffle-status').textContent = 'Participación registrada sólo en este ensayo.'; }
    });
    return { update, clear, setPending(value) { pending = value; controls(); } };
  }
  return { create, validate };
});
