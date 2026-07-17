(function (root) {
  const BUILD = 'v111';
  const MODE_NATIVE = 'native';
  const MODE_ADAPTER = 'input-adapter';

  function createTransientHandle(file) {
    return {
      kind: 'file',
      name: String(file?.name || 'video.mp4'),
      __immersaTransientHandle: true,
      async getFile() { return file; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; }
    };
  }

  function inputPicker(options = {}) {
    return new Promise((resolve) => {
      const input = root.document.createElement('input');
      input.type = 'file';
      input.accept = '.mp4,video/mp4';
      input.multiple = Boolean(options.multiple);
      input.hidden = true;

      const finish = (files) => {
        input.remove();
        resolve(Array.from(files || []).map(createTransientHandle));
      };

      input.addEventListener('change', () => finish(input.files), { once: true });
      input.addEventListener('cancel', () => finish([]), { once: true });
      root.document.body.appendChild(input);
      input.click();
    });
  }

  if (typeof root.showOpenFilePicker !== 'function') {
    root.showOpenFilePicker = inputPicker;
    root.__IMMERSA_MEDIA_PICKER_MODE = MODE_ADAPTER;
  } else {
    root.__IMMERSA_MEDIA_PICKER_MODE = MODE_NATIVE;
  }

  root.__IMMERSA_MEDIA_BUILD = BUILD;

  function addBuildMarker() {
    const header = root.document?.querySelector('.screen-media-modal header');
    if (!header || header.querySelector('[data-media-build]')) return;
    const marker = root.document.createElement('small');
    marker.dataset.mediaBuild = '1';
    marker.textContent = 'Persistencia ' + BUILD + ' · ' + (root.__IMMERSA_MEDIA_PICKER_MODE === MODE_NATIVE ? 'selector nativo' : 'selector compatible');
    marker.style.display = 'block';
    marker.style.marginTop = '5px';
    marker.style.color = '#7c3aed';
    marker.style.fontSize = '10px';
    marker.style.fontWeight = '850';
    marker.style.letterSpacing = '.04em';
    header.appendChild(marker);
  }

  if (root.document) {
    const observer = new MutationObserver(addBuildMarker);
    observer.observe(root.document.documentElement, { childList: true, subtree: true });
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', addBuildMarker, { once: true });
    else addBuildMarker();
  }
})(typeof window !== 'undefined' ? window : globalThis);
