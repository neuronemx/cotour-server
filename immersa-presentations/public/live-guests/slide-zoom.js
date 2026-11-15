(function (root) {
  function create({ surface, image, view = root }) {
    const pointers = new Map();
    const listeners = [];
    let scale = 1, x = 0, y = 0, gesture, tap, lastTap;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const center = (a, b = a) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
    const active = () => !image.hidden && Boolean(image.getAttribute("src")) && !surface.classList.contains("has-public-content");
    function listen(node, name, fn, options) {
      node.addEventListener(name, fn, options);
      listeners.push(() => node.removeEventListener(name, fn, options));
    }
    function point(client) {
      const rect = surface.getBoundingClientRect();
      return { x: client.x - rect.left - rect.width / 2, y: client.y - rect.top - rect.height / 2 };
    }
    function apply(nextScale, nextX = 0, nextY = 0) {
      scale = clamp(nextScale, 1, 4);
      const rect = surface.getBoundingClientRect();
      const width = image.naturalWidth || rect.width;
      const height = image.naturalHeight || rect.height;
      const fit = Math.min(rect.width / (width || 1), rect.height / (height || 1));
      const maxX = Math.max(0, (width * fit * scale - rect.width) / 2);
      const maxY = Math.max(0, (height * fit * scale - rect.height) / 2);
      x = scale === 1 ? 0 : clamp(nextX, -maxX, maxX);
      y = scale === 1 ? 0 : clamp(nextY, -maxY, maxY);
      image.style.setProperty("--guest-zoom", String(scale));
      image.style.setProperty("--guest-pan-x", x + "px");
      image.style.setProperty("--guest-pan-y", y + "px");
    }
    function begin() {
      const [a, b = a] = pointers.values();
      gesture = a ? { scale, x, y, center: point(center(a, b)), distance: distance(a, b) } : null;
    }
    function zoomAt(nextScale, anchor) {
      const next = clamp(nextScale, 1, 4), ratio = next / scale;
      apply(next, anchor.x - (anchor.x - x) * ratio, anchor.y - (anchor.y - y) * ratio);
    }
    function reset() {
      const ids = [...pointers.keys()];
      pointers.clear(); gesture = tap = lastTap = null;
      for (const id of ids) if (surface.hasPointerCapture?.(id)) surface.releasePointerCapture(id);
      apply(1);
    }
    listen(surface, "pointerdown", event => {
      if (!active() || event.target !== image || event.button !== 0 || pointers.size >= 2) return;
      event.preventDefault(); event.stopPropagation();
      surface.setPointerCapture?.(event.pointerId);
      tap = pointers.size ? null : { start: event, moved: false };
      pointers.set(event.pointerId, event); begin();
    });
    listen(surface, "pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      if (!active()) return reset();
      event.preventDefault();
      if (tap && distance(tap.start, event) > 8) tap.moved = true;
      pointers.set(event.pointerId, event);
      const [a, b = a] = pointers.values(), middle = point(center(a, b));
      const next = gesture.distance > 0 ? clamp(gesture.scale * distance(a, b) / gesture.distance, 1, 4) : gesture.scale;
      const ratio = next / gesture.scale;
      apply(next, middle.x - (gesture.center.x - gesture.x) * ratio, middle.y - (gesture.center.y - gesture.y) * ratio);
    }, { passive: false });
    function end(event) {
      if (!pointers.has(event.pointerId)) return;
      const isTap = event.type === "pointerup" && pointers.size === 1 && tap && !tap.moved && distance(tap.start, event) <= 8;
      pointers.delete(event.pointerId);
      if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
      tap = null; begin();
      if (isTap && lastTap && event.timeStamp - lastTap.timeStamp < 280 && distance(lastTap, event) <= 32) {
        if (scale > 1) apply(1); else zoomAt(2, point(center(event)));
        lastTap = null;
      } else lastTap = isTap ? event : null;
    }
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) listen(surface, name, end);
    listen(surface, "wheel", event => {
      if (!active() || event.target !== image || pointers.size) return;
      event.preventDefault(); event.stopPropagation();
      const rect = surface.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoomAt(scale * Math.exp(-clamp(delta, -500, 500) * .002), point(center(event)));
    }, { passive: false });
    listen(image, "keydown", event => {
      if (!active() || !["+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "0") reset(); else zoomAt(scale * (event.key === "-" ? .8 : 1.25), { x: 0, y: 0 });
    });
    if (view.addEventListener) listen(view, "resize", reset);
    return { reset, destroy() { reset(); for (const remove of listeners) remove(); } };
  }
  root.ImmersaGuestSlideZoom = { create };
  if (typeof module === "object") module.exports = { create };
})(typeof window === "object" ? window : globalThis);
