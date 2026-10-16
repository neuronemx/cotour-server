(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventPollPage = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function createView({ document, controller, getLanguage=()=>'es' }) {
    const $ = id => document.getElementById(id);
    let state = controller.getState(), selected = null, selectedRun = null, optionSignature = null, inputs = [];
    function render(value) {
      state = value;
      const usable = state.status === 'ready' && Boolean(state.snapshot), control = ['STAGE', 'SPEAKER'].includes(state.kind);
      const snapshot = state.snapshot, active = snapshot?.active, english=getLanguage()==='en';
      const translated=(es,en)=>english&&typeof en==='string'&&en.trim()?en:es||'';
      $('poll-panel').hidden = !usable && state.status !== 'loading' && state.status !== 'unavailable';
      $('poll-controls').hidden = !control || !usable;
      const catalogValue = $('poll-catalog').value;
      $('poll-results').replaceChildren(); $('poll-catalog').replaceChildren();
      const errors = { POLL_DUPLICATE_RESPONSE: 'Tu respuesta ya está registrada.', POLL_NOT_ACTIVE: 'La encuesta cambió o terminó.',
        POLL_ALREADY_ACTIVE: 'Ya hay una encuesta abierta.', INTERACTION_BUSY: 'Hay otra interacción activa.',
        COMMAND_ACK_TIMEOUT: 'Estamos comprobando el estado de la acción.', POLL_CONTENT_NOT_PREPARED: 'Las encuestas aún no están preparadas.' };
      $('poll-status').textContent = state.code ? errors[state.code] || 'No se pudo completar la acción.'
        : !usable ? 'Comprobando encuestas…' : snapshot.response ? 'Respuesta registrada.' : active ? 'Encuesta abierta' : 'No hay encuesta abierta';
      $('poll-submit').textContent=english?'Submit answer':'Enviar respuesta';
      $('poll-question').textContent = translated(active?.prompt,active?.en?.prompt);
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
      const signature = usable && active && state.kind === 'PARTICIPANT' ? JSON.stringify([snapshot.pollRunId, active.options, english, active.en]) : null;
      if (optionSignature !== signature) {
        optionSignature = signature; inputs = []; $('poll-options').replaceChildren();
      if (signature) {
        for (const row of active.options) {
          const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
          input.type = 'radio'; input.name = 'event-poll-choice'; input.value = row.id; input.checked = selected === row.id;
          input.disabled = state.pending || Boolean(snapshot.response); text.textContent = translated(row.label,active.en?.options?.[row.id]);
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
          text.textContent = translated(row.label,active?.en?.options?.[row.id]) + ' · ' + row.count + ' (' + row.percentage + '%)';
          bar.max = 100; bar.value = row.percentage; bar.setAttribute('aria-label', translated(row.label,active?.en?.options?.[row.id])); line.append(text, bar); $('poll-results').append(line);
        }
      }
    }
    $('poll-launch').addEventListener('click', () => controller.operate('launch', { interactionId: $('poll-catalog').value }));
    for (const action of ['show', 'hide', 'close']) $('poll-' + action).addEventListener('click', () => controller.operate(action));
    $('poll-submit').addEventListener('click', () => controller.operate('submit', { optionId: selected }));
    render(state); return Object.freeze({ render });
  }
  return Object.freeze({ createView });
});
