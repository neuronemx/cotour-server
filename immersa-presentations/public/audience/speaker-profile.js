(function initializeSpeakerProfile() {
  const params = new URLSearchParams(window.location.search);
  const publicContext = window.IMMERSA_PUBLIC_OPEN || {};
  const deckId = params.get("deck") || publicContext.deck || "demo";
  const launcher = document.getElementById("speakerProfileLauncher");
  const panel = document.getElementById("speakerProfilePanel");
  const tab = document.getElementById("speakerProfileTab");
  const close = document.getElementById("speakerProfileClose");
  const photo = document.getElementById("speakerProfilePhoto");
  const photoFallback = document.getElementById("speakerProfilePhotoFallback");
  const name = document.getElementById("speakerProfileName");
  const role = document.getElementById("speakerProfileRole");
  const company = document.getElementById("speakerProfileCompany");
  const divider = document.getElementById("speakerProfileDivider");
  const bioBlock = document.getElementById("speakerProfileBioBlock");
  const bio = document.getElementById("speakerProfileBio");
  const links = document.getElementById("speakerProfileLinks");
  const website = document.getElementById("speakerProfileWebsite");
  const socials = document.getElementById("speakerProfileSocials");
  const linkedin = document.getElementById("speakerProfileLinkedin");
  const instagram = document.getElementById("speakerProfileInstagram");
  if (!launcher || !panel || !tab || !close) return;

  function setOptionalText(element, value) {
    const text = String(value || "").trim();
    element.textContent = text;
    element.hidden = !text;
    return Boolean(text);
  }

  function setLink(element, value, label) {
    const url = String(value || "").trim();
    element.hidden = !url;
    if (!url) {
      element.removeAttribute("href");
      return false;
    }
    element.href = url;
    if (label) element.querySelector("span").textContent = label;
    return true;
  }

  function displayDomain(value) {
    try { return new URL(value).hostname.replace(/^www\./i, ""); } catch (_error) { return "Sitio web"; }
  }

  function render(profile) {
    name.textContent = String(profile.displayName || "").trim();
    const hasRole = setOptionalText(role, profile.roleTitle);
    const companyName = String(profile.company || "").trim();
    company.querySelector("span").textContent = companyName;
    company.hidden = !companyName;
    const hasBio = setOptionalText(bio, profile.bio);
    bioBlock.hidden = !hasBio;
    divider.hidden = !(hasRole || companyName || hasBio);
    const hasWebsite = setLink(website, profile.websiteUrl, displayDomain(profile.websiteUrl));
    const hasLinkedin = setLink(linkedin, profile.linkedinUrl);
    const hasInstagram = setLink(instagram, profile.instagramUrl);
    socials.hidden = !(hasLinkedin || hasInstagram);
    links.hidden = !(hasWebsite || hasLinkedin || hasInstagram);
    const photoUrl = String(profile.photoUrl || "").trim();
    photo.hidden = !photoUrl;
    photoFallback.hidden = Boolean(photoUrl);
    photo.alt = photoUrl ? `Foto de ${name.textContent}` : "";
    if (photoUrl) photo.src = photoUrl;
    launcher.hidden = false;
  }

  function openPanel() {
    launcher.classList.add("is-active");
    tab.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-hidden", "false");
    close.focus();
  }

  function closePanel() {
    launcher.classList.remove("is-active");
    tab.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
    tab.focus();
  }

  tab.addEventListener("click", openPanel);
  close.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && launcher.classList.contains("is-active")) closePanel(); });
  photo.addEventListener("error", () => { photo.hidden = true; photoFallback.hidden = false; });

  fetch(`/api/decks/${encodeURIComponent(deckId)}/speaker-profile`, { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => { if (data?.available && data.profile) render(data.profile); })
    .catch(() => {});
})();
