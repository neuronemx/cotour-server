(function (root) {
  function create(options = {}) {
    const socket = options.socket;
    const button = options.button;
    const modal = options.modal;
    const form = options.form;
    const input = options.input;
    const cancelButton = options.cancelButton;
    const linkButton = options.linkButton;
    const getPublicUrl = options.getPublicUrl || (() => "");
    const labelMode = options.labelMode || "text";
    const inactiveLabel = options.inactiveLabel || "Texto en vivo";
    const activeLabel = options.activeLabel || "Apagar texto";
    let visible = false;

    if (!socket || !button || !modal || !form || !input) return null;

    function renderButton() {
      button.classList.toggle("is-live", visible);
      button.classList.toggle("active", visible);
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", visible ? activeLabel : inactiveLabel);
      button.title = visible ? activeLabel : inactiveLabel;
      if (labelMode === "text") button.textContent = visible ? activeLabel : inactiveLabel;
    }

    function open() {
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      root.requestAnimationFrame?.(() => input.focus());
    }

    function close() {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
    }

    function clear() {
      input.value = "";
      socket.emit("clear_message");
    }

    function sync(overlays = {}) {
      visible = Boolean(overlays.messageVisible && overlays.messageText);
      if (visible) input.value = String(overlays.messageText || "");
      renderButton();
    }

    button.addEventListener("click", () => {
      if (visible) clear();
      else open();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      socket.emit("overlay_update", {
        overlays: {
          messageVisible: true,
          messageText: text
        }
      });
      close();
    });

    cancelButton?.addEventListener("click", close);
    linkButton?.addEventListener("click", () => {
      const url = getPublicUrl();
      if (!url) return;
      input.value = url;
      input.focus();
    });
    modal.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-live-text]")) close();
    });
    root.document?.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("is-open")) close();
    });

    renderButton();
    return { sync, open, close, clear };
  }

  root.ImmersaLiveTextControl = { create };
})(window);
