(function (root) {
  "use strict";

  if (!root.document || root.__immersaInteractionPositionFix) return;
  root.__immersaInteractionPositionFix = true;

  const style = root.document.createElement("style");
  style.setAttribute("data-immersa-interaction-position-fix", "");
  style.textContent = [
    ".interaction-panel { position: fixed !important; }",
    ".stage-actions-card { position: relative !important; }"
  ].join("\n");
  root.document.head.appendChild(style);
})(typeof window !== "undefined" ? window : globalThis);
