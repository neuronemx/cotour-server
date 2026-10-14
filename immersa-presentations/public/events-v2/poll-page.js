(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventPollPage = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function createView({ document, controller }) {
    const $ = id => document.getElementById(id);
    let state = controller.getState(), selected = null, selectedRun = null, menuOpen = false, menuIndex = 0, optionSignature = null, inputs = [];
    function menu() {
      const actions = controller.emergencyActions();
      if (!actions.length) menuOpen = false;
      menuIndex = Math.min(menuIndex, Math.max(0, actions.length - 1));
      $('poll-emergency').hidden = !menuOpen;
      $('poll-emergency-action').textContent = menuOpen ? actions[menuIndex].title : '';
    }
    function render(value) {
      state = value;
      const usable = state.status === 'ready' && Boolean(state.snapshot), control = ['STAGE', 'SPEAKER'].includes(state.kind);
      const snapshot = state.snapshot, active = snapshot?.active;
      $('poll-panel').hidden = !usable && state.status !== 'loading' && state.status !== 'unavailable';
      $('poll-controls').hidden = !control || !usable;
      const catalogValue = $('poll-catalog').value;
      $('poll-results').replaceChildren(); $('poll-catalog').replaceChildren();
      const errors = { POLL_DUPLICATE_RESPONSE: 'Tu respuesta ya está registrada.', POLL_NOT_ACTIVE: 'La encuesta cambió o terminó.',
        POLL_ALREADY_ACTIVE: 'Ya hay una encuesta abierta.', INTERACTION_BUSY: 'Hay otra interacción activa.',
        COMMAND_ACK_TIMEOUT: 'Estamos comprobando el estado de la acción.', POLL_CONTENT_NOT_PREPARED: 'Las encuestas aún no están preparadas.' };
      $('poll-status').textContent = state.code ? errors[state.code] || 'No se pudo completar la acción.'
        : !usable ? 'Comprobando encuestas…' : snapshot.response ? 'Respuesta registrada.' : active ? 'Encuesta abierta' : 'No hay encuesta abierta';
      $('poll-question').textContent = active?.prompt || '';
      if (selectedRun !== snapshot?.pollRunId) { selected = null; selectedRun = snapshot?.pollRunId || null; }
      if (snapshot?.response) selected = snapshot.response.optionId;
      if (usable && control) {
        for (const row of snapshot.available) {
          const option = document.createElement('option'); option.value = row.id; option.textContent = row.title; $('poll-catalog').append(option);
        }
        $('poll-catalog').value = snapshot.available.some(row => row.id === catalogValue) ? catalogValue : snapshot.available[0]?.id || '';
        $('poll-catalog').disabled = state.pending || Boolean(active);
      }
      $('poll-launch').disabled = !usable || state.pending || Boolean(active) || !snapshot?.available?.length;
      for (const id of ['poll-show', 'poll-hide', 'poll-close']) $(id).disabled = !usable || state.pending || !active;
      $('poll-submit').hidden = state.kind !== 'PARTICIPANT' || !active || !usable;
      $('poll-submit').disabled = state.pending || Boolean(snapshot?.response) || !selected;
      const signature = usable && active && state.kind === 'PARTICIPANT' ? JSON.stringify([snapshot.pollRunId, active.options]) : null;
      if (optionSignature !== signature) {
        optionSignature = signature; inputs = []; $('poll-options').replaceChildren();
      if (signature) {
        for (const row of active.options) {
          const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
          input.type = 'radio'; input.name = 'event-poll-choice'; input.value = row.id; input.checked = selected === row.id;
          input.disabled = state.pending || Boolean(snapshot.response); text.textContent = row.label;
          input.addEventListener('change', () => { selected = row.id; render(state); }); inputs.push(input);
          label.append(input, text); $('poll-options').append(label);
        }
      }
      }
      for (const input of inputs) { input.checked = selected === input.value; input.disabled = state.pending || Boolean(snapshot?.response); }
      if (usable && snapshot.results && state.kind !== 'PARTICIPANT') {
        const total = document.createElement('p'); total.textContent = 'Respuestas: ' + snapshot.results.totalResponses; $('poll-results').append(total);
        for (const row of snapshot.results.options) {
          const line = document.createElement('div'), text = document.createElement('p'), bar = document.createElement('progress');
          text.textContent = row.label + ' · ' + row.count + ' (' + row.percentage + '%)';
          bar.max = 100; bar.value = row.percentage; bar.setAttribute('aria-label', row.label); line.append(text, bar); $('poll-results').append(line);
        }
      }
      menu();
    }
    $('poll-launch').addEventListener('click', () => controller.operate('launch', { interactionId: $('poll-catalog').value }));
    for (const action of ['show', 'hide', 'close']) $('poll-' + action).addEventListener('click', () => controller.operate(action));
    $('poll-submit').addEventListener('click', () => controller.operate('submit', { optionId: selected }));
    function execute() {
      const item = controller.emergencyActions()[menuIndex]; menuOpen = false; menu();
      if (item) controller.operate(item.action, item.input);
    }
    $('poll-emergency-action').addEventListener('click', execute);
    document.addEventListener('keydown', event => {
      if (state.kind !== 'PLAYER' || state.status !== 'ready' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
        || event.target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
      if (event.key.toLowerCase() === 'e' && controller.emergencyActions().length) { menuOpen = !menuOpen; menuIndex = 0; menu(); event.preventDefault(); return; }
      if (!menuOpen) return;
      const actions = controller.emergencyActions();
      if (event.key === 'Escape') { menuOpen = false; menu(); }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { menuIndex = (menuIndex + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length; menu(); }
      else if (event.key === 'Enter') execute(); else return;
      event.preventDefault();
    });
    render(state); return Object.freeze({ render });
  }
  return Object.freeze({ createView });
});
