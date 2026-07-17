(function (root) {
  if (!root.document || root.__immersaScreenMediaUnlockHost) return;
  root.__immersaScreenMediaUnlockHost = true;
  const host = root.document.getElementById('screen');
  if (!host) return;
  const moveUnlock = () => {
    root.document.querySelectorAll('[data-immersa-media-unlock]').forEach((button) => {
      if (button.parentElement !== host) host.appendChild(button);
    });
  };
  new MutationObserver(moveUnlock).observe(root.document.body, { childList: true, subtree: true });
  root.document.addEventListener('fullscreenchange', moveUnlock);
  moveUnlock();
})(window);
