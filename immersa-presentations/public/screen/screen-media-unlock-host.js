(function (root) {
  if (!root.document || root.__immersaScreenMediaUnlockHost) return;
  root.__immersaScreenMediaUnlockHost = true;
  const host = root.document.getElementById('screen');
  if (!host) return;
  const control = root.document.getElementById('screenMediaUnlock');
  root.document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-immersa-media-unlock], [data-pong-audio-unlock], [data-breakout-audio-unlock]');
    if (!button || !control) return;
    control.dataset.activated = '1';
    control.hidden = true;
    root.__immersaMediaUnlocked = true;
    root.document.dispatchEvent(new Event('immersa:media-unlocked'));
  }, true);
  const moveUnlock = () => {
    root.document.querySelectorAll('[data-immersa-media-unlock]').forEach((button) => {
      if (button.parentElement !== host) host.appendChild(button);
    });
  };
  new MutationObserver(moveUnlock).observe(root.document.body, { childList: true, subtree: true });
  root.document.addEventListener('fullscreenchange', moveUnlock);
  moveUnlock();
})(window);
