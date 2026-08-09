(async function initializeAccount() {
  const label = document.getElementById("accountName");
  const logout = document.getElementById("logoutButton");
  try {
    const response = await fetch("/api/auth/get-session");
    const session = response.ok ? await response.json() : null;
    if (!session?.user) {
      window.location.replace("/auth?returnTo=/home");
      return;
    }
    const display = String(session.user.name || session.user.email || "Mi cuenta").trim();
    if (label) label.textContent = display;
  } catch (_error) {
    if (label) label.textContent = "Mi cuenta";
  }

  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      await fetch("/api/account/demo/reset", { method: "POST" }).catch(() => null);
      await fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      window.location.assign("/auth");
    }
  });
})();
