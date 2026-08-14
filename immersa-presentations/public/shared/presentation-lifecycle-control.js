(function(root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaPresentationLifecycle = api;
})(typeof window !== "undefined" ? window : globalThis, function(root) {
  function create({ socket, host } = {}) {
    if (!socket || !host || !root.ImmersaSlideConfirm) return null;
    let state = { available: false, mode: "test" };
    let attachment = null;
    let control = null;
    let pending = false;

    function actionForState() {
      return state.mode === "live" ? "finish" : "start";
    }

    function restingLabel() {
      return state.mode === "live" ? "Finalizar" : "Iniciar";
    }

    function setLabel(label) {
      const node = control?.querySelector(".interaction-close-slider-label");
      if (node) node.textContent = label;
    }

    function setArming(arming) {
      if (!control || state.mode !== "live" || pending) return;
      control.classList.toggle("is-arming", Boolean(arming));
      setLabel("Finalizar");
    }

    function render() {
      host.hidden = state.available === false;
      host.dataset.presentationMode = state.mode || "test";
      host.replaceChildren();
      attachment = null;
      control = null;
      if (state.available === false) return;

      const action = actionForState();
      host.innerHTML = root.ImmersaSlideConfirm.markup({
        label: restingLabel(),
        className: "presentation-lifecycle-slider" + (state.mode === "live" ? " is-live" : ""),
        dataAttribute: "data-presentation-lifecycle-slide"
      });
      control = host.querySelector("[data-presentation-lifecycle-slide]");
      if (!control) return;
      control.setAttribute("aria-label", action === "finish" ? "Finalizar" : "Iniciar");
      control.title = action === "finish"
        ? "Desliza para finalizar"
        : "Desliza para iniciar";
      control.addEventListener("pointerdown", () => setArming(true));
      control.addEventListener("pointerup", () => {
        if (!pending) root.setTimeout?.(() => setArming(false), 0);
      });
      control.addEventListener("pointercancel", () => setArming(false));
      attachment = root.ImmersaSlideConfirm.attach(control, {
        isDisabled: () => pending,
        onComplete: () => {
          pending = true;
          setLabel(action === "finish" ? "Finalizar" : "Iniciar");
          socket.emit(`presentation:lifecycle:${action}`);
        }
      });
    }

    function handleState(next = {}) {
      state = {
        available: next.available !== false,
        mode: next.mode === "live" ? "live" : "test",
        presentationSessionId: next.presentationSessionId || null,
        startedAt: next.startedAt || null
      };
      pending = false;
      render();
    }

    function handleRejection(payload = {}) {
      pending = false;
      attachment?.reset?.();
      setArming(false);
      const message = payload.message
        || (payload.reason === "ACTIVE_INTERACTION"
          ? "Cierra la interacción activa antes de finalizar"
          : "No se pudo cambiar el estado de la presentación");
      root.alert?.(message);
      socket.emit("presentation:lifecycle:request");
    }

    socket.on("presentation:lifecycle:state", handleState);
    socket.on("presentation:lifecycle:rejected", handleRejection);
    socket.on?.("connect", () => socket.emit("presentation:lifecycle:request"));
    socket.emit("presentation:lifecycle:request");
    render();

    return {
      getState: () => ({ ...state }),
      destroy() {
        socket.off?.("presentation:lifecycle:state", handleState);
        socket.off?.("presentation:lifecycle:rejected", handleRejection);
        host.replaceChildren();
      }
    };
  }

  return { create };
});
