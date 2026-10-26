(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let access, binding, snapshot, revision = 0, ready = false, pending = false, generation = 0;
  let requestController, tools, qnaTools;
  function clear() {
    tools?.clear();
    qnaTools?.clear();
    $('rehearsal').hidden = true; $('slide').hidden = true; $('slide').removeAttribute('src');
    $('notes').textContent = ''; $('position').textContent = '';
  }
  function controls() {
    tools?.setPending(!ready || pending);
    qnaTools?.setPending(!ready || pending);
    for (const id of ['prev', 'next', 'language', 'reset']) $(id).disabled = !ready || pending;
    if (snapshot) { $('prev').disabled ||= snapshot.slideIndex === 0; $('next').disabled ||= snapshot.slideIndex + 1 >= snapshot.slideCount; }
  }
  const messages = { REHEARSAL_VERSION_CHANGED: 'Producción cambió la versión. Reinicia el ensayo para revisar el contenido aprobado.',
    REHEARSAL_REVISION_CONFLICT: 'El ensayo cambió en otra pestaña. Pulsa Volver a conectar para actualizarlo.',
    CONTENT_NOT_PREPARED: 'Producción debe preparar, aprobar y asociar la versión antes del ensayo.',
    REHEARSAL_EXPIRED: 'El ensayo venció. Pulsa Volver a conectar para abrirlo de nuevo.',
    REHEARSAL_BUSY: 'No se pudo abrir el ensayo en este momento. Inténtalo de nuevo.',
    REHEARSAL_POLL_ACTIVE: 'Cierra la Encuesta actual antes de abrir otra.',
    REHEARSAL_SAMPLE_ALREADY_USED: 'La respuesta de prueba ya se usó. Cierra y vuelve a abrir la Encuesta para repetirla.',
    REHEARSAL_QNA_CLOSED: 'La recepción de preguntas de prueba está cerrada.',
    REHEARSAL_QNA_COOLDOWN: 'Espera unos segundos antes de enviar otra pregunta de prueba.',
    REHEARSAL_QNA_LIMIT: 'La ronda admite hasta 20 preguntas de prueba. Inicia una nueva ronda para continuar.' };
  async function operate(action = 'snapshot', extra = {}) {
    if (!ready || pending) return;
    const epoch = generation; pending = true; controls();
    const controller = requestController = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const path = '/api/events-v2/rehearsal/' + binding.eventId + '/' + binding.grantId;
      const response = await fetch(path, { method: action === 'snapshot' ? 'GET' : 'POST', credentials: 'same-origin',
        cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        ...(action === 'snapshot' ? {} : { body: JSON.stringify({ action, expectedRevision: revision, ...extra }) }) });
      const value = await response.json();
      if (epoch !== generation || !ready) return;
      if (!response.ok) {
        if (Number.isSafeInteger(value.currentRevision)) revision = value.currentRevision;
        throw Object.assign(new Error(value.code), { code: value.code, status: response.status });
      }
      const image = new URL(value.image?.url, window.location.origin);
      if (value.mode !== 'rehearsal' || value.eventId !== binding.eventId || value.activityId !== access.getState().context?.activityId
        || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.slideIndex) || !Number.isSafeInteger(value.slideCount)
        || value.slideIndex < 0 || value.slideIndex >= value.slideCount || typeof value.notes !== 'string'
        || image.origin !== window.location.origin || !image.pathname.startsWith(path + '/slides/') || image.search || image.hash) throw new Error('Invalid rehearsal');
      snapshot = value; revision = value.revision;
      tools.update(value, path);
      qnaTools.update(value);
      $('title').textContent = value.title; $('position').textContent = 'Slide ' + (value.slideIndex + 1) + ' de ' + value.slideCount;
      $('notes').textContent = value.notes || 'Este slide no tiene apuntador.';
      $('language-label').hidden = !value.englishEnabled; $('language').value = value.language;
      $('slide').src = image.href; $('slide').hidden = false; $('rehearsal').hidden = false;
      $('status').textContent = 'Ensayo privado listo.'; $('reset').hidden = false; $('retry').hidden = true;
      return true;
    } catch (error) {
      if (epoch !== generation) return;
      clear(); snapshot = null;
      $('status').textContent = messages[error.code] || 'No se pudo comprobar el acceso al ensayo. Vuelve a conectar.';
      $('retry').hidden = false; $('reset').hidden = !ready;
      if ([401, 403, 404].includes(error.status)) { ready = false; $('reset').hidden = true; }
    } finally { clearTimeout(timer); if (epoch === generation) { pending = false; controls(); } }
  }
  try {
    const link = window.ImmersaEventAccess.consumeLink(window.location, window.history); binding = link.binding;
    if (binding.view !== 'rehearsal') throw new Error('Wrong access');
    tools = window.ImmersaEventRehearsalTools.create({ document, origin: window.location.origin,
      sendPoll: input => operate('poll', { runId: snapshot?.runId, ...input }) });
    qnaTools = window.ImmersaEventRehearsalQna.create({ document,
      send: input => operate('qna', { runId: snapshot?.runId, ...input }) });
    access = window.ImmersaEventAccess.createClient({ binding, fetch: window.fetch.bind(window), io: window.io, onState(state) {
      generation++; requestController?.abort(); pending = false;
      ready = state.status === 'ready' && state.context?.purpose === 'rehearsal';
      $('event-name').textContent = state.eventName || 'Ensayo privado';
      if (!ready) {
        clear(); $('reset').hidden = true; $('retry').hidden = state.status !== 'retrying';
        $('status').textContent = state.status === 'denied' ? 'El enlace no está disponible o ya no tiene permiso.' : 'Comprobando conexión y acceso…'; controls();
      } else operate();
    } });
    for (const id of ['prev', 'next', 'reset']) $(id).addEventListener('click', () => operate(id));
    $('language').addEventListener('change', () => operate('language', { language: $('language').value }));
    $('retry').addEventListener('click', () => access.resume());
    $('slide').addEventListener('error', () => { clear(); $('status').textContent = 'No se pudo cargar el slide. Vuelve a conectar.'; $('retry').hidden = false; });
    document.addEventListener('keydown', e => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target?.tagName) || e.target?.isContentEditable) return;
      if (ready && snapshot && ['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); operate(e.key === 'ArrowLeft' ? 'prev' : 'next'); }
    });
    window.addEventListener('online', () => access.resume());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') access.resume(); });
    window.addEventListener('pagehide', () => { generation++; ready = false; requestController?.abort(); clear(); access.close(); });
    window.addEventListener('pageshow', e => { if (e.persisted) window.location.reload(); });
    access.start(link.token); link.token = null;
  } catch (_) { clear(); $('status').textContent = 'No se pudo abrir el enlace de ensayo.'; }
})();
