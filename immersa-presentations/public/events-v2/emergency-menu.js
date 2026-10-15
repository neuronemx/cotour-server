(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImmersaEventEmergencyMenu = factory();
})(typeof window === 'object' ? window : this, function () {
  'use strict';
  function createView({ document, controllers }) {
    const panel = document.getElementById('interaction-emergency'), button = document.getElementById('interaction-emergency-action');
    let opened = false, index = 0, selected = null, confirming = false;
    const actions = () => controllers.flatMap(controller => controller.emergencyActions().map(item => ({ ...item, controller })));
    const key = item => item && JSON.stringify([controllers.indexOf(item.controller), item.action, item.input, item.title]);
    function render() {
      const list = actions();
      // Never retarget an already displayed action when a round/run changes.
      if (!list.length || (opened && selected && key(list[index]) !== selected)) opened = false;
      if (!opened) { selected = null; confirming = false; }
      panel.hidden = !opened;
      button.textContent = opened ? (confirming ? 'Confirmar: ' : '') + list[index].title : '';
    }
    function execute() {
      const item = actions()[index];
      if (!opened || key(item) !== selected) { opened = false; render(); return; }
      if (item.confirm && !confirming) { confirming = true; render(); return; }
      opened = false; render(); item.controller.operate(item.action, item.input);
    }
    button.addEventListener('click', execute);
    document.addEventListener('keydown', event => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.target?.isContentEditable
        || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)) return;
      const list = actions();
      if (event.key.toLowerCase() === 'e' && list.length) {
        opened = !opened; index = 0; confirming = false; selected = opened ? key(list[index]) : null; render();
      } else if (opened && event.key === 'Escape') { opened = false; render(); }
      else if (opened && ['ArrowUp', 'ArrowDown'].includes(event.key) && list.length) {
        index = (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        selected = key(list[index]); confirming = false; render();
      } else if (opened && event.key === 'Enter') execute(); else return;
      event.preventDefault();
    });
    render(); return Object.freeze({ render });
  }
  return Object.freeze({ createView });
});
