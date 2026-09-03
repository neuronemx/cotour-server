(async function initializeAccount() {
  const label = document.getElementById("accountName");
  const avatar = document.getElementById("accountAvatar");
  const avatarImage = document.getElementById("accountAvatarImage");
  const avatarFallback = document.getElementById("accountAvatarFallback");
  const identity = document.getElementById("planAccountIdentity");
  const logout = document.getElementById("logoutButton");

  function showAvatar(display, imageUrl = "") {
    const initial = String(display || "M").trim().charAt(0).toUpperCase() || "M";
    if (avatarFallback) {
      avatarFallback.textContent = initial;
      avatarFallback.hidden = Boolean(imageUrl);
    } else if (avatar) {
      avatar.textContent = initial;
    }
    if (!avatarImage) return;
    avatarImage.hidden = !imageUrl;
    if (imageUrl) avatarImage.src = imageUrl;
    else avatarImage.removeAttribute("src");
  }

  avatarImage?.addEventListener("error", () => showAvatar(label?.textContent || "M"));

  async function uploadedProfilePhoto() {
    try {
      const response = await fetch("/api/account/profile", { cache: "no-store" });
      const profile = response.ok ? await response.json() : null;
      return profile?.hasUploadedPhoto ? String(profile.photoUrl || "").trim() : "";
    } catch (_error) {
      return "";
    }
  }

  try {
    const response = await fetch("/api/auth/get-session");
    const session = response.ok ? await response.json() : null;
    if (!session?.user) {
      window.location.replace("/auth?returnTo=/home");
      return;
    }
    const display = String(session.user.name || session.user.email || "Mi cuenta").trim();
    if (label) label.textContent = display;
    const googleImage = String(session.user.image || "").trim();
    showAvatar(display, googleImage || await uploadedProfilePhoto());
    if (identity) identity.textContent = session.user.name && session.user.email
      ? `${session.user.name} · ${session.user.email}`
      : display;
  } catch (_error) {
    if (label) label.textContent = "Mi cuenta";
    showAvatar("M");
    if (identity) identity.textContent = "Mi cuenta";
  }

  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      window.location.assign("/auth");
    }
  });
})();
