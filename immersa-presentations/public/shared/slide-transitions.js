(function slideTransitions(global) {
  const ALLOWED = new Set(["none", "dissolve", "swipe", "flash"]);
  const ACTIVE_CLASSES = [
    "immersa-slide-transition-dissolve",
    "immersa-slide-transition-swipe",
    "immersa-slide-transition-flash",
    "immersa-slide-transition-backward"
  ];
  const loads = new Map();
  const swaps = new WeakMap();

  function normalize(value) {
    const transition = String(value || "").trim().toLowerCase();
    return ALLOWED.has(transition) ? transition : "dissolve";
  }

  function apply(slide, value, direction = 1) {
    if (!slide) return;
    ACTIVE_CLASSES.forEach((className) => slide.classList.remove(className));
    const transition = normalize(value);
    if (transition === "none") return;
    void slide.offsetWidth;
    slide.classList.add("immersa-slide-transition-" + transition);
    if (direction < 0) slide.classList.add("immersa-slide-transition-backward");
  }

  function loadSource(src) {
    const source = String(src || "");
    if (!source) return Promise.reject(new Error("Missing slide source"));
    if (loads.has(source)) return loads.get(source);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = async () => {
        try { await image.decode?.(); } catch (_error) {}
        resolve(source);
      };
      image.onerror = () => reject(new Error("Unable to preload slide"));
      image.src = source;
      if (image.complete && image.naturalWidth > 0) image.onload();
    }).catch((error) => {
      loads.delete(source);
      throw error;
    });
    loads.set(source, promise);
    return promise;
  }

  function preload(sources = []) {
    return Promise.allSettled(sources.filter(Boolean).map(loadSource));
  }

  async function swap(slide, src, value, direction = 1) {
    if (!slide || !src) return false;
    const token = (swaps.get(slide) || 0) + 1;
    swaps.set(slide, token);
    try { await loadSource(src); } catch (_error) {}
    if (swaps.get(slide) !== token) return false;
    slide.src = src;
    apply(slide, value, direction);
    return true;
  }

  global.ImmersaSlideTransitions = { apply, swap, preload, normalize, values: [...ALLOWED] };
})(window);
