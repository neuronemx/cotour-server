(function installDemoPlanBadge(global) {
  const labels = { FREE: "FREE", SPEAKER: "SPEAKER", SPEAKER_PRO: "SPEAKER PRO" };

  function update(root, slide, manifest) {
    if (!root) return;
    let badge = root.querySelector(":scope > .immersa-demo-plan-badge");
    const isPublishedDemo = manifest?.systemDemo?.role === "published";
    const label = labels[String(slide?.planLevel || "")];
    if (!isPublishedDemo || !label) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "immersa-demo-plan-badge";
      badge.setAttribute("aria-label", "Función disponible desde el plan");
      root.appendChild(badge);
    }
    badge.textContent = label;
    badge.dataset.plan = String(slide.planLevel);
  }

  global.ImmersaDemoPlanBadge = { update };
})(window);
