(function (root) {
  const WARNING = 'Archivo distinto al registrado en la presentación';
  let scheduled = false;

  function polishOverride(item) {
    const state = item.querySelector('.screen-media-item-state > b');
    if (state && state.textContent !== 'Listo') state.textContent = 'Listo';

    const copy = item.querySelector('.screen-media-copy');
    if (!copy) return;
    let warning = copy.querySelector('[data-media-file-warning]');
    if (!warning) {
      const existing = copy.querySelector('em');
      const detail = String(existing?.textContent || '').replace(/^Usando localmente:\s*/i, '').trim();
      warning = root.document.createElement('em');
      warning.dataset.mediaFileWarning = '1';
      warning.dataset.mediaFileDetail = detail;
      if (existing) existing.replaceWith(warning);
      else copy.appendChild(warning);
    }
    const detail = String(warning.dataset.mediaFileDetail || '').trim();
    const text = WARNING + (detail ? ' · ' + detail : '');
    if (warning.textContent !== text) warning.textContent = text;
  }

  function polishModal() {
    scheduled = false;
    const modal = root.document?.querySelector('.screen-media-modal');
    if (!modal) return;

    modal.querySelector('[data-pick]')?.remove();
    modal.querySelector('[data-multi-input]')?.remove();
    modal.querySelectorAll('[data-media-build]').forEach((node) => node.remove());

    const actions = modal.querySelector('.screen-media-actions');
    if (actions) actions.classList.add('is-single-picker');

    modal.querySelectorAll('[data-media-action="accept"]:not([data-media-auto-accept])').forEach((button) => {
      button.dataset.mediaAutoAccept = '1';
      button.click();
    });
    modal.querySelectorAll('.screen-media-item.is-ready_override').forEach(polishOverride);
  }

  function schedulePolish() {
    if (scheduled) return;
    scheduled = true;
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(polishModal);
    else root.setTimeout(polishModal, 0);
  }

  if (!root.document) return;
  const Observer = root.MutationObserver;
  if (typeof Observer === 'function') {
    const observer = new Observer(schedulePolish);
    observer.observe(root.document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', schedulePolish, { once: true });
  else schedulePolish();
})(typeof window !== 'undefined' ? window : globalThis);
