(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImmersaSlideConfirm = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const COMPLETE_THRESHOLD = 0.82;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function shouldLoadRaffleUxAdjustments(pathname) { return !/^\/(?:speaker|presenter)(?:\/|$)/.test(String(pathname || "")); }

  function loadRaffleUxAdjustments() {
    if (!root.document || !shouldLoadRaffleUxAdjustments(root.location?.pathname || "") || root.ImmersaRaffleUxAdjustments || root.__immersaRaffleUxAdjustmentsLoading) return;
    root.__immersaRaffleUxAdjustmentsLoading = true;
    const script = root.document.createElement("script");
    script.src = "/shared/raffle-ux-adjustments.js";
    script.defer = true;
    root.document.head.appendChild(script);
  }

  function markup({ label, className = "", disabled = false, dataAttribute = "data-slide-confirm" } = {}) {
    const classes = ["interaction-close-slider", className, disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
    const disabledState = disabled ? ' aria-disabled="true"' : "";
    return '<div class="' + escapeHtml(classes) + '" ' + dataAttribute + ' role="button" aria-label="' + escapeHtml(label) + '" tabindex="0"' + disabledState + ' style="--close-progress:0;--close-x:0px"><span class="interaction-close-slider-track"></span><span class="interaction-close-slider-label">' + escapeHtml(label) + '</span><span class="interaction-close-slider-knob" aria-hidden="true">›</span></div>';
  }

  function reset(control) {
    if (!control) return;
    control.style.setProperty("--close-progress", "0");
    control.style.setProperty("--close-x", "0px");
    control.classList.remove("is-complete", "is-pending");
    delete control.dataset.slideCompleted;
  }

  function setPending(control, pending = true) {
    if (!control) return;
    control.classList.toggle("is-pending", Boolean(pending));
    control.classList.toggle("is-disabled", Boolean(pending));
    control.setAttribute("aria-disabled", String(Boolean(pending)));
    if (pending) control.dataset.slideCompleted = "true";
    else delete control.dataset.slideCompleted;
  }

  function attach(control, { onComplete, isDisabled = () => false } = {}) {
    if (!control) return null;
    let dragging = false;
    let startX = 0;
    let maxX = 1;
    let progress = 0;
    let completed = false;

    function disabled() {
      return completed || control.classList.contains("is-disabled") || control.getAttribute("aria-disabled") === "true" || Boolean(isDisabled());
    }

    function update(clientX) {
      progress = Math.max(0, Math.min(1, (clientX - startX) / maxX));
      control.style.setProperty("--close-progress", String(progress));
      control.style.setProperty("--close-x", Math.round(progress * maxX) + "px");
      control.classList.toggle("is-complete", progress >= COMPLETE_THRESHOLD);
    }

    function complete() {
      if (disabled()) {
        reset(control);
        return false;
      }
      completed = true;
      setPending(control, true);
      onComplete?.(control);
      return true;
    }

    function finish(event) {
      if (!dragging) return;
      dragging = false;
      control.releasePointerCapture?.(event?.pointerId);
      if (progress >= COMPLETE_THRESHOLD) complete();
      else reset(control);
    }

    control.addEventListener("pointerdown", (event) => {
      if (disabled()) return;
      if (event.button !== undefined && event.button !== 0) return;
      const rect = control.getBoundingClientRect();
      const knob = control.querySelector(".interaction-close-slider-knob");
      maxX = Math.max(1, rect.width - (knob?.offsetWidth || 38) - 8);
      startX = event.clientX;
      dragging = true;
      control.setPointerCapture?.(event.pointerId);
      update(event.clientX);
      event.preventDefault?.();
    });
    control.addEventListener("pointermove", (event) => { if (dragging) update(event.clientX); });
    control.addEventListener("pointerup", finish);
    control.addEventListener("pointercancel", (event) => { finish(event); reset(control); });
    control.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      complete();
    });

    return { reset: () => { completed = false; reset(control); }, setPending: (pending) => setPending(control, pending) };
  }

  loadRaffleUxAdjustments();
  return { COMPLETE_THRESHOLD, markup, attach, reset, setPending, shouldLoadRaffleUxAdjustments };
});
