window.ImmersaLiveShopScreen = function (socket) {
  const root = document.getElementById("liveShopScreen");
  const unlock = document.getElementById("liveShopUnlock");
  if (!root || !unlock) return;
  const card = root.querySelector(".live-shop-celebration");
  const count = root.querySelector("[data-shop-count]");
  const label = root.querySelector("[data-shop-celebration-label]");
  const title = root.querySelector("[data-shop-celebration-title]");
  const name = root.querySelector("[data-shop-celebration-name]");
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let audio = null;
  let output = null;
  let timer = null;
  let state = null;

  function syncUnlock() {
    unlock.hidden = !state?.sound || !AudioContext || audio?.state === "running";
  }

  unlock.addEventListener("click", async () => {
    try {
      if (!audio) {
        audio = new AudioContext();
        output = audio.createGain();
        output.gain.value = state?.sound ? 1 : 0;
        output.connect(audio.destination);
        audio.addEventListener("statechange", syncUnlock);
      }
      await audio.resume();
    } catch (_error) {}
    syncUnlock();
  });

  function chime(milestone) {
    if (audio?.state !== "running") return;
    const notes = milestone ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77];
    notes.forEach((hz, index) => {
      const start = audio.currentTime + index * 0.115;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = hz;
      oscillator.connect(gain);
      gain.connect(output);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.13, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      oscillator.start(start);
      oscillator.stop(start + 0.36);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }

  function clear() {
    clearTimeout(timer);
    timer = null;
    card.hidden = true;
  }

  socket.on("live-shop:state", next => {
    state = next;
    root.hidden = !next.active && next.count === 0;
    count.textContent = next.count + (next.count === 1 ? " compra simulada" : " compras simuladas");
    if (output) output.gain.value = next.sound && next.celebrations ? 1 : 0;
    if (!next.celebrations) clear();
    syncUnlock();
  });
  socket.on("live-shop:celebration", item => {
    if (!state?.celebrations) return;
    clear();
    card.classList.toggle("is-milestone", Boolean(item.milestone));
    label.textContent = item.milestone ? "HITO · LIVE SHOP" : "LIVE SHOP";
    title.textContent = item.milestone
      ? item.milestone + " compras simuladas"
      : item.name ? "¡Gracias, " + item.name + "!" : "¡Gracias por tu compra!";
    name.textContent = item.milestone && item.name ? "¡Gracias, " + item.name + "!" : "";
    name.hidden = !name.textContent;
    card.hidden = false;
    if (item.sound && state.sound) chime(item.milestone);
    timer = setTimeout(clear, item.duration);
  });
  socket.on("live-shop:clear", clear);
  socket.on("disconnect", () => {
    clear();
    state = null;
    root.hidden = true;
    if (output) output.gain.value = 0;
    syncUnlock();
  });
};
