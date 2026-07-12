(function (root) {
  "use strict";

  if (!root.document) return;

  if (!root.__immersaInteractionPositionFix) {
    root.__immersaInteractionPositionFix = true;
    const style = root.document.createElement("style");
    style.setAttribute("data-immersa-interaction-position-fix", "");
    style.textContent = [
      ".interaction-panel { position: fixed !important; }",
      ".stage-actions-card { position: relative !important; }"
    ].join("\n");
    root.document.head.appendChild(style);
  }

  if (!root.document.querySelector('link[href="/shared/interactions-home-recovery.css"]')) {
    const link = root.document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/shared/interactions-home-recovery.css";
    root.document.head.appendChild(link);
  }
})(typeof window !== "undefined" ? window : globalThis);
