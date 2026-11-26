window.ImmersaLiveShopSpeaker = function (socket) {
  const toggle = document.getElementById("liveShopSpeakerToggle");
  const panel = document.getElementById("liveShopSpeakerPanel");
  if (!toggle || !panel) return;
  const get = name => panel.querySelector("[data-shop-" + name + "]");
  const milestones = [...panel.querySelectorAll("[data-shop-milestone]")];
  const commands = [...panel.querySelectorAll("button, input")].filter(button => button !== get("close"));
  let state = null;
  let busy = false;

  function render() {
    if (!state) return;
    toggle.classList.toggle("is-active", state.active);
    toggle.setAttribute("aria-label", "LIVE SHOP " + (state.active ? "activado" : "desactivado"));
    get("activate").textContent = state.active ? "Desactivar Shop" : "Activar Shop";
    get("state").textContent = state.active ? "Shop visible en Público" : "Shop oculto en Público";
    if (!busy) {
      get("celebrations").checked = state.celebrations;
      get("sound").checked = state.sound;
    }
    get("count").textContent = String(state.count);
    commands.forEach(button => { button.disabled = busy || !socket.connected; });
    milestones.forEach(button => { button.disabled ||= Number(button.dataset.shopMilestone) <= state.count; });
  }

  function setOpen(open, focus = false) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (focus) (open ? get("activate") : toggle).focus();
  }

  async function send(action, value) {
    if (busy || !socket.connected || !state) return;
    busy = true;
    get("notice").textContent = "";
    render();
    try {
      const result = await socket.timeout(5000).emitWithAck("live-shop:control", { action, value });
      if (!result?.ok) get("notice").textContent = result?.message || "No se pudo actualizar LIVE SHOP.";
    } catch (_error) {
      get("notice").textContent = "LIVE SHOP no respondió. Intenta de nuevo.";
    } finally {
      busy = false;
      render();
    }
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden, true));
  get("close").addEventListener("click", () => setOpen(false, true));
  get("activate").addEventListener("click", () => send("toggle", !state.active));
  get("celebrations").addEventListener("change", event => send("celebrations", event.target.checked));
  get("sound").addEventListener("change", event => send("sound", event.target.checked));
  get("test").addEventListener("click", () => send("test"));
  get("reset").addEventListener("click", () => send("reset"));
  milestones.forEach(button => button.addEventListener("click", () => send("milestone", Number(button.dataset.shopMilestone))));
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || panel.hidden) return;
    setOpen(false, true);
  });
  document.addEventListener("pointerdown", event => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  socket.on("live-shop:state", next => {
    state = next;
    render();
  });
  socket.on("live-shop:authorized", () => { toggle.hidden = false; });
  socket.on("disconnect", () => {
    toggle.hidden = true;
    setOpen(false);
  });
};
