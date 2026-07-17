(function () {
  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function simplifyOption(option) {
    const text = String(option.textContent || "").trim();
    const match = text.match(/^(\d+)\s*[·.-]\s*(.+?)(\s+—\s+ya tiene video)?$/i);
    if (!match) return;

    const position = Number(match[1]);
    const title = normalize(match[2]);
    const suffix = match[3] || "";
    const generic = title === "pagina " + position
      || title === "page " + position
      || title === "slide " + position
      || title === String(position)
      || title === "slide-" + String(position).padStart(3, "0");

    if (generic) option.textContent = "Slide " + position + suffix;
  }

  function syncLabels(root = document) {
    root.querySelectorAll('.video-editor-form select[name="slide_id"] option').forEach(simplifyOption);
  }

  function boot() {
    syncLabels();
    new MutationObserver(() => syncLabels()).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();