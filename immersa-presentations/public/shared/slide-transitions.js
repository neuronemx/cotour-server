(function slideTransitions(global) {
  const ALLOWED = new Set(["none", "dissolve", "wipe", "flash"]);
  const ACTIVE_CLASSES = [
    "immersa-slide-transition-dissolve",
    "immersa-slide-transition-wipe",
    "immersa-slide-transition-flash",
    "immersa-slide-transition-backward"
  ];
  const loads = new Map();
  const swaps = new WeakMap();

  function normalize(value) {
    const transition = String(value || "").trim().toLowerCase();
    if (transition === "swipe") return "wipe";
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

  function clearOutgoing(slide) {
    slide?.parentElement?.querySelectorAll(".immersa-slide-outgoing").forEach((item) => item.remove());
  }

  function outgoingLayer(slide) {
    const layer = slide.cloneNode(false);
    layer.removeAttribute("id");
    layer.removeAttribute("aria-describedby");
    layer.setAttribute("aria-hidden", "true");
    ACTIVE_CLASSES.forEach((className) => layer.classList.remove(className));
    layer.classList.add("immersa-slide-outgoing");
    const computed = global.getComputedStyle?.(slide);
    if (computed) {
      layer.style.objectFit = computed.objectFit;
      layer.style.objectPosition = computed.objectPosition;
      layer.style.transform = computed.transform;
      layer.style.transformOrigin = computed.transformOrigin;
    }
    return layer;
  }

  async function swap(slide, src, value, direction = 1) {
    if (!slide || !src) return false;
    const token = (swaps.get(slide) || 0) + 1;
    swaps.set(slide, token);
    try { await loadSource(src); } catch (_error) {}
    if (swaps.get(slide) !== token) return false;

    const transition = normalize(value);
    clearOutgoing(slide);
    if (transition === "none" || global.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      slide.src = src;
      apply(slide, "none", direction);
      return true;
    }

    const layer = outgoingLayer(slide);
    slide.parentElement?.insertBefore(layer, slide);
    slide.src = src;
    apply(slide, transition, direction);
    const cleanup = () => {
      if (swaps.get(slide) === token) ACTIVE_CLASSES.forEach((className) => slide.classList.remove(className));
      layer.remove();
    };
    slide.addEventListener("animationend", cleanup, { once: true });
    global.setTimeout(cleanup, 700);
    return true;
  }

  global.ImmersaSlideTransitions = { apply, swap, preload, normalize, values: [...ALLOWED] };
})(window);
