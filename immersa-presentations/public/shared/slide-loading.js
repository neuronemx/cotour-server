(function () {
  const slide = document.getElementById("slide");
  const loading = document.getElementById("slideLoading");
  const message = document.getElementById("slideLoadingMessage");
  const retry = document.getElementById("slideLoadingRetry");
  if (!slide || !loading || !message || !retry) return;
  let revision = 0;

  async function ready() {
    const token = ++revision;
    const source = slide.getAttribute("src");
    if (!source || !slide.naturalWidth) return;
    try { await slide.decode?.(); } catch (_error) {}
    if (token !== revision || source !== slide.getAttribute("src") || !slide.naturalWidth) return;
    slide.classList.remove("slide-initial-pending");
    slide.setAttribute("aria-busy", "false");
    loading.hidden = true;
  }

  slide.addEventListener("load", ready);
  slide.addEventListener("error", () => {
    revision += 1;
    slide.classList.add("slide-initial-pending");
    slide.setAttribute("aria-busy", "false");
    loading.hidden = false;
    loading.classList.add("is-error");
    message.textContent = "No se pudo cargar el slide.";
    retry.hidden = false;
  });
  retry.addEventListener("click", () => {
    const source = slide.getAttribute("src");
    if (!source) return;
    revision += 1;
    loading.classList.remove("is-error");
    message.textContent = "Cargando presentación…";
    retry.hidden = true;
    slide.setAttribute("aria-busy", "true");
    slide.removeAttribute("src");
    slide.src = source;
  });
  if (slide.complete && slide.naturalWidth > 0) ready();
})();
