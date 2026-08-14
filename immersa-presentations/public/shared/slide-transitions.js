(function slideTransitions(global) {
  const ALLOWED = new Set(["none", "dissolve", "swipe", "flash"]);
  const ACTIVE_CLASSES = [
    "immersa-slide-transition-dissolve",
    "immersa-slide-transition-swipe",
    "immersa-slide-transition-flash",
    "immersa-slide-transition-backward"
  ];

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

  global.ImmersaSlideTransitions = { apply, normalize, values: [...ALLOWED] };
})(window);
