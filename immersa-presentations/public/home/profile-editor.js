(function initializeProfileEditor() {
  const modal = document.getElementById("profileModal");
  const openButton = document.getElementById("profileButton");
  const closeButton = document.getElementById("profileClose");
  const cancelButton = document.getElementById("profileCancel");
  const form = document.getElementById("profileForm");
  const saveButton = document.getElementById("profileSave");
  const status = document.getElementById("profileStatus");
  const accountName = document.getElementById("accountName");
  const fields = {
    displayName: document.getElementById("profileDisplayName"),
    roleTitle: document.getElementById("profileRoleTitle"),
    company: document.getElementById("profileCompany"),
    bio: document.getElementById("profileBio"),
    websiteUrl: document.getElementById("profileWebsite"),
    linkedinUrl: document.getElementById("profileLinkedin"),
    instagramUrl: document.getElementById("profileInstagram")
  };
  const counter = document.getElementById("profileBioCounter");
  const photoInput = document.getElementById("profilePhotoInput");
  const photoSelect = document.getElementById("profilePhotoSelect");
  const photoRemove = document.getElementById("profilePhotoRemove");
  const avatarImage = document.getElementById("profileAvatarImage");
  const avatarFallback = document.getElementById("profileAvatarFallback");
  let currentProfile = null;
  let selectedPhoto = null;
  let removePhoto = false;
  let previewObjectUrl = "";

  if (!modal || !form || !openButton) return;

  function setStatus(message = "", kind = "") {
    status.textContent = message;
    status.className = "profile-status" + (kind ? ` is-${kind}` : "");
  }

  function updateCounter() {
    counter.textContent = `${fields.bio.value.length}/600`;
  }

  function revokePreview() {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = "";
  }

  function showPhoto(url) {
    const value = String(url || "").trim();
    avatarImage.hidden = !value;
    avatarFallback.hidden = Boolean(value);
    if (value) avatarImage.src = value;
    else avatarImage.removeAttribute("src");
  }

  function applyProfile(profile) {
    currentProfile = profile || {};
    Object.entries(fields).forEach(([key, input]) => { input.value = String(currentProfile[key] || ""); });
    if (accountName && currentProfile.displayName) accountName.textContent = currentProfile.displayName;
    selectedPhoto = null;
    removePhoto = false;
    revokePreview();
    showPhoto(currentProfile.photoUrl);
    photoRemove.hidden = !currentProfile.hasUploadedPhoto;
    photoSelect.textContent = currentProfile.photoUrl ? "Cambiar foto" : "Seleccionar foto";
    updateCounter();
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo guardar el perfil.");
    return data;
  }

  async function loadProfile({ silent = false } = {}) {
    if (!silent) setStatus("Cargando perfil…");
    const response = await fetch("/api/account/profile", { cache: "no-store" });
    const data = await readJson(response);
    applyProfile(data.profile);
    if (!silent) setStatus();
    return data.profile;
  }

  async function openProfile() {
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("profile-modal-open");
    try {
      await loadProfile();
      fields.displayName.focus();
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  function closeProfile() {
    if (saveButton.disabled) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("profile-modal-open");
    revokePreview();
    selectedPhoto = null;
    removePhoto = false;
    setStatus();
    openButton.focus();
  }

  function profilePayload() {
    return Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
  }

  async function saveTextProfile() {
    const response = await fetch("/api/account/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profilePayload())
    });
    return (await readJson(response)).profile;
  }

  async function savePhoto(profile) {
    if (selectedPhoto) {
      const body = new FormData();
      body.append("photo", selectedPhoto);
      const response = await fetch("/api/account/profile/photo", { method: "POST", body });
      return (await readJson(response)).profile;
    }
    if (removePhoto && profile.hasUploadedPhoto) {
      const response = await fetch("/api/account/profile/photo", { method: "DELETE" });
      return (await readJson(response)).profile;
    }
    return profile;
  }

  async function submitProfile(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    saveButton.disabled = true;
    cancelButton.disabled = true;
    closeButton.disabled = true;
    setStatus("Guardando perfil…");
    try {
      let profile = await saveTextProfile();
      profile = await savePhoto(profile);
      applyProfile(profile);
      setStatus("¡Tu perfil está listo! Esta información aparecerá para Público en todos tus Decks.", "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      saveButton.disabled = false;
      cancelButton.disabled = false;
      closeButton.disabled = false;
    }
  }

  function selectPhoto() { photoInput.click(); }

  function previewPhoto() {
    const file = photoInput.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      photoInput.value = "";
      return setStatus("La foto debe pesar máximo 5 MB.", "error");
    }
    if (file.type && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      photoInput.value = "";
      return setStatus("La foto debe ser PNG, JPG o WebP.", "error");
    }
    selectedPhoto = file;
    removePhoto = false;
    revokePreview();
    previewObjectUrl = URL.createObjectURL(file);
    showPhoto(previewObjectUrl);
    photoSelect.textContent = "Cambiar foto";
    photoRemove.hidden = false;
    setStatus();
  }

  function clearPhoto() {
    selectedPhoto = null;
    removePhoto = Boolean(currentProfile?.hasUploadedPhoto);
    photoInput.value = "";
    revokePreview();
    showPhoto(removePhoto ? "" : currentProfile?.photoUrl);
    photoRemove.hidden = true;
    photoSelect.textContent = "Seleccionar foto";
  }

  openButton.addEventListener("click", openProfile);
  closeButton.addEventListener("click", closeProfile);
  cancelButton.addEventListener("click", closeProfile);
  form.addEventListener("submit", submitProfile);
  fields.bio.addEventListener("input", updateCounter);
  photoSelect.addEventListener("click", selectPhoto);
  photoInput.addEventListener("change", previewPhoto);
  photoRemove.addEventListener("click", clearPhoto);
  modal.addEventListener("click", (event) => { if (event.target === modal) closeProfile(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.hidden) closeProfile(); });
  avatarImage.addEventListener("error", () => showPhoto(""));
  loadProfile({ silent: true }).catch(() => {});
})();
