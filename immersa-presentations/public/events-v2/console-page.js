(function () {
  'use strict';
  const title = document.getElementById('event-name');
  const status = document.getElementById('access-status');
  const detail = document.getElementById('access-detail');
  const retry = document.getElementById('retry');
  const names = { stage: 'Stage', speaker: 'Speaker', screen: 'Pantalla', audience: 'Público' };
  let client;
  function render(state) {
    // textContent deliberately handles event names as text, never HTML.
    title.textContent = state.eventName || (state.status === 'denied' ? 'Acceso no disponible' : 'Verificando acceso…');
    const messages = { connecting: 'Conectando con el evento.', ready: 'Acceso confirmado.', retrying: 'Sin conexión. Volveremos a comprobar tu acceso.', denied: 'El enlace no está disponible o ya no tiene permiso.', closed: 'Conexión cerrada.' };
    status.textContent = messages[state.status] || 'Verificando acceso…';
    detail.textContent = state.status === 'ready' ? 'La conexión está lista. La operación de contenidos aún no está disponible.' : '';
    retry.hidden = state.status !== 'retrying';
  }
  try {
    let link = window.ImmersaEventAccess.consumeLink(window.location, window.history);
    document.getElementById('function').textContent = names[link.binding.view];
    client = window.ImmersaEventAccess.createClient({ binding: link.binding, fetch: window.fetch.bind(window), io: window.io, onState: render });
    client.start(link.token); link.token = null; link = null;
    retry.addEventListener('click', () => client.resume());
    window.addEventListener('online', () => client.resume());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') client.resume(); });
    window.addEventListener('pagehide', () => client.close());
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  } catch (_) {
    window.history.replaceState(null, '', window.location.pathname);
    render({ status: 'denied' });
  }
})();
