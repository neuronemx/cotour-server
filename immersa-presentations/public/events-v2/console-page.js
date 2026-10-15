(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const names = { stage: 'Stage', speaker: 'Speaker', screen: 'Pantalla', audience: 'Público' };
  let client, live, poll, pollView, qna, qnaView, knowledge, knowledgeView, raffle, raffleView, emergency, accessState = { status: 'idle' }, lastTargets = null;
  function renderOperation(state) {
    const connected = accessState.status === 'ready', controls = ['STAGE', 'SPEAKER'].includes(state.kind) && state.purpose === 'live';
    $('operation').hidden = !connected;
    if (lastTargets !== state.targets) {
      lastTargets = state.targets; $('activity').replaceChildren();
      const empty = document.createElement('option'); empty.value = ''; empty.textContent = state.targets.length ? 'Selecciona una actividad' : 'No hay actividades disponibles'; $('activity').append(empty);
      for (const target of state.targets) {
        const option = document.createElement('option'); option.value = window.ImmersaEventLiveConsole.targetKey(target);
        option.textContent = target.title + ' · ' + target.stageTitle + (target.liveSessionId ? ' · En vivo' : ''); $('activity').append(option);
      }
    }
    $('activity').value = state.target ? window.ImmersaEventLiveConsole.targetKey(state.target) : '';
    $('activity').disabled = !connected || state.pending || ['SPEAKER', 'PLAYER'].includes(state.kind);
    $('refresh').disabled = !connected || state.pending;
    const errors = { CONTENT_NOT_PREPARED: 'La actividad aún no está preparada.', CONTENT_VERSION_CHANGED: 'El contenido cambió. Actualiza la actividad.',
      STAGE_ALREADY_LIVE: 'Ya hay una presentación en vivo en este escenario.', LIVE_COMMAND_DENIED: 'Este control no está disponible para tu acceso.',
      COMMAND_ACK_TIMEOUT: 'No pudimos confirmar la acción. Estamos comprobando el estado.' };
    $('live-status').textContent = state.code ? errors[state.code] || 'No se pudo completar la acción.'
      : state.status === 'live' ? 'Presentación en vivo' : state.status === 'joining' ? 'Conectando con la actividad…'
        : state.status === 'finished' ? 'Presentación finalizada' : state.target?.canStart ? 'Actividad seleccionada' : 'Esperando una presentación en vivo';
    $('position').hidden = !state.snapshot;
    $('live-position').textContent = state.snapshot ? 'Slide ' + (state.snapshot.slideIndex + 1) : '';
    $('preview-position').textContent = controls && state.snapshot
      ? 'Control: slide ' + (state.snapshot.presenterSlideIndex + 1) + ' de ' + state.snapshot.slideCount
        + (state.snapshot.transmissionPaused ? ' · Transmisión pausada' : '') : '';
    $('navigation').hidden = !controls || state.status !== 'live';
    for (const name of ['prev', 'next', 'go', 'pause']) $(name).disabled = !connected || state.pending || !state.snapshot;
    $('slide-number').disabled = !connected || state.pending || !state.snapshot;
    if (controls && state.snapshot) $('slide-number').max = String(state.snapshot.slideCount);
    $('pause').textContent = state.snapshot?.transmissionPaused ? 'Continuar transmisión' : 'Pausar transmisión';
    $('stage-lifecycle').hidden = state.kind !== 'STAGE';
    $('start').disabled = !connected || state.pending || !state.target?.canStart || state.status === 'live';
    $('finish').disabled = !connected || state.pending || state.status !== 'live';
    if ((!connected || state.status !== 'live') && $('finish-dialog').open) $('finish-dialog').close();
  }
  function renderAccess(state) {
    accessState = state;
    $('event-name').textContent = state.eventName || (state.status === 'denied' ? 'Acceso no disponible' : 'Verificando acceso…');
    const messages = { connecting: 'Conectando con el evento.', ready: 'Acceso confirmado.', retrying: 'Sin conexión. Volveremos a comprobar tu acceso.', denied: 'El enlace no está disponible o ya no tiene permiso.', closed: 'Conexión cerrada.' };
    $('access-status').textContent = messages[state.status] || 'Verificando acceso…';
    $('access-detail').textContent = state.context?.purpose === 'rehearsal' ? 'El ensayo todavía no está disponible.' : '';
    $('retry').hidden = state.status !== 'retrying';
    poll.updateAccess(state); qna.updateAccess(state); knowledge.updateAccess(state); raffle.updateAccess(state); live.updateAccess(state);
  }
  try {
    let link = window.ImmersaEventAccess.consumeLink(window.location, window.history);
    $('function').textContent = names[link.binding.view];
    client = window.ImmersaEventAccess.createClient({ binding: link.binding, fetch: window.fetch.bind(window), io: window.io,
      onState: renderAccess, onEvent: (name, value) => { live.receive(name, value); poll.receive(name, value); qna.receive(name, value); knowledge.receive(name, value); raffle.receive(name, value); } });
    live = window.ImmersaEventLiveConsole.createController({ access: client, onState: state => { renderOperation(state); poll?.updateLive(state); qna?.updateLive(state); knowledge?.updateLive(state); raffle?.updateLive(state); } });
    poll = window.ImmersaEventPollConsole.createController({ access: client, onState: state => { pollView?.render(state); emergency?.render(); } });
    pollView = window.ImmersaEventPollPage.createView({ document, controller: poll });
    qna = window.ImmersaEventQnaConsole.createController({ access: client, onState: state => { qnaView?.render(state); emergency?.render(); } });
    qnaView = window.ImmersaEventQnaPage.createView({ document, controller: qna });
    knowledge = window.ImmersaEventKnowledgeConsole.createController({ access: client, onState: state => { knowledgeView?.render(state); emergency?.render(); } });
    knowledgeView = window.ImmersaEventKnowledgePage.createView({ document, controller: knowledge });
    raffle = window.ImmersaEventRaffleConsole.createController({ access: client, onState: state => { raffleView?.render(state); emergency?.render(); } });
    raffleView = window.ImmersaEventRafflePage.createView({ document, controller: raffle });
    emergency = window.ImmersaEventEmergencyMenu.createView({ document, controllers: [poll, qna, knowledge, raffle] });
    client.start(link.token); link.token = null; link = null;
    $('activity').addEventListener('change', () => live.select($('activity').value));
    $('refresh').addEventListener('click', () => live.refresh());
    for (const action of ['prev', 'next', 'start']) $(action).addEventListener('click', () => live.operate(action));
    $('go').addEventListener('click', () => live.operate('go', { slideIndex: Number($('slide-number').value) - 1 }));
    $('pause').addEventListener('click', () => live.operate(live.getState().snapshot?.transmissionPaused ? 'play' : 'pause'));
    $('finish').addEventListener('click', () => { if (live.getState().kind === 'STAGE' && live.getState().status === 'live') $('finish-dialog').showModal(); });
    $('cancel-finish').addEventListener('click', () => $('finish-dialog').close());
    $('confirm-finish').addEventListener('click', () => { $('finish-dialog').close(); live.operate('finish'); });
    document.addEventListener('keydown', event => {
      if (live.getState().kind !== 'PLAYER' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || event.target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); live.operate(event.key === 'ArrowLeft' ? 'prev' : 'next'); }
    });
    $('retry').addEventListener('click', () => client.resume());
    window.addEventListener('online', () => client.resume());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') client.resume(); });
    window.addEventListener('pagehide', () => client.close());
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  } catch (_) {
    window.history.replaceState(null, '', window.location.pathname);
    $('event-name').textContent = 'Acceso no disponible'; $('access-status').textContent = 'No se pudo abrir el enlace.';
    $('operation').hidden = true;
  }
})();
