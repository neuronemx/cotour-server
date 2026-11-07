(function initializeSpeakerProfile() {
  const params = new URLSearchParams(window.location.search);
  const publicContext = window.IMMERSA_PUBLIC_OPEN || {};
  const deckId = params.get("deck") || publicContext.deck || "demo";
  const launcher = document.getElementById("speakerProfileLauncher");
  const panel = document.getElementById("speakerProfilePanel");
  const tab = document.getElementById("speakerProfileTab");
  const close = document.getElementById("speakerProfileClose");
  const publicTitle = document.getElementById("speakerProfilePublicTitle");
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
    const title = String(profile.publicTitle || "Speaker").trim() || "Speaker";
    publicTitle.textContent = title;
    tab.querySelector("span").textContent = title;
    launcher.setAttribute("aria-label", `Perfil de ${title}`);
    tab.setAttribute("aria-label", `Mostrar perfil de ${title}`);
    close.setAttribute("aria-label", `Cerrar perfil de ${title}`);
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
    panel.inert = false;
    close.focus();
  }

  function closePanel(restoreFocus = true) {
    launcher.classList.remove("is-active");
    tab.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
    panel.inert = true;
    if (restoreFocus) tab.focus();
  }

  panel.inert = true;
  tab.addEventListener("click", openPanel);
  close.addEventListener("click", closePanel);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && launcher.classList.contains("is-active")) closePanel(); });
  photo.addEventListener("error", () => { photo.hidden = true; photoFallback.hidden = false; });

  const originalCard = panel.querySelector('.speaker-profile-scroll');
  let carousel = null, track = null, counter = null, previous = null, next = null;
  let profiles = [], selectedId = '', multiple = false, generation = 0, running = false, lastRevision = null;
  function updatePosition() {
    if (!track || !profiles.length) return;
    const cards = Array.from(track.children);
    const current = cards.reduce((best, card, i) => Math.abs(card.offsetLeft - track.scrollLeft) < Math.abs(cards[best].offsetLeft - track.scrollLeft) ? i : best, 0);
    selectedId = profiles[current].id;
    counter.textContent = (current + 1) + ' de ' + profiles.length;
    previous.disabled = current === 0; next.disabled = current === profiles.length - 1;
  }
  function goTo(index, smooth = true) {
    if (!track || !track.children[index]) return;
    track.scrollTo({left:track.children[index].offsetLeft, behavior:smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'});
  }
  function move(delta) { goTo(Math.max(0, profiles.findIndex(p => p.id === selectedId) + delta)); }
  function createCarousel() {
    carousel = document.createElement('div'); carousel.className = 'speaker-profiles-carousel';
    track = document.createElement('div'); track.className = 'speaker-profiles-track'; track.tabIndex = 0;
    track.setAttribute('role','region'); track.setAttribute('aria-roledescription','carrusel'); track.setAttribute('aria-label','Perfiles de ponentes');
    const nav = document.createElement('div'); nav.className = 'speaker-profiles-nav';
    previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '←'; previous.setAttribute('aria-label','Ponente anterior');
    next = document.createElement('button'); next.type = 'button'; next.textContent = '→'; next.setAttribute('aria-label','Siguiente ponente');
    counter = document.createElement('span'); counter.setAttribute('aria-live','polite');
    previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
    track.addEventListener('scroll', updatePosition, {passive:true});
    track.addEventListener('keydown', event => {
      if (event.target !== track || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') goTo(0); else if (event.key === 'End') goTo(profiles.length - 1); else move(event.key === 'ArrowRight' ? 1 : -1);
    });
    nav.append(previous,counter,next); carousel.append(track,nav); panel.appendChild(carousel);
  }
  function apply(data) {
    if (!data) return;
    if (data.mode === 'multiple' && multiple && data.revision === lastRevision) return;
    multiple = data.mode === 'multiple';
    lastRevision = multiple ? data.revision : null;
    launcher.classList.toggle('is-multiple', multiple);
    originalCard.hidden = multiple;
    if (carousel) carousel.hidden = !multiple;
    if (multiple) {
      profiles = Array.isArray(data.profiles) ? data.profiles : [];
      if (!carousel) createCarousel();
      const scrollPositions = new Map(Array.from(track.children).map(card => [card.dataset.profileId, card.querySelector('.speaker-profile-scroll').scrollTop]));
      track.replaceChildren(...profiles.map(profile => {
        const card = window.ImmersaSpeakerCards.createCard(document, profile);
        card.querySelector('.speaker-profile-scroll').scrollTop = scrollPositions.get(profile.id) || 0;
        return card;
      }));
      track.classList.toggle('has-one', profiles.length === 1);
      panel.removeAttribute('aria-labelledby'); panel.setAttribute('aria-label','Perfiles de ponentes');
      tab.querySelector('span').textContent = 'Ponentes';
      tab.setAttribute('aria-label','Mostrar perfiles de ponentes'); close.setAttribute('aria-label','Cerrar perfiles de ponentes');
      launcher.setAttribute('aria-label','Perfiles de ponentes');
      const index = Math.max(0, profiles.findIndex(p => p.id === selectedId));
      selectedId = profiles[index]?.id || '';
      requestAnimationFrame(() => { goTo(index, false); updatePosition(); });
    } else {
      panel.setAttribute('aria-labelledby','speakerProfileName'); panel.removeAttribute('aria-label');
      if (data.available && data.profile) render(data.profile);
    }
    const available = multiple ? profiles.length > 0 : Boolean(data.available && data.profile);
    if (!available) closePanel(false);
    launcher.hidden = !available;
  }
  // Reuse Público's existing connection; never rejoin or reload the presentation.
  async function refresh() {
    generation++;
    if (running) return;
    running = true;
    let requested;
    do {
      requested = generation;
      try {
        const response = await fetch(`/api/decks/${encodeURIComponent(deckId)}/speaker-profile`, {cache:'no-store'});
        const data = response.ok ? await response.json() : null;
        if (requested === generation) apply(data);
      } catch (_) { /* Reconnect, visibility and periodic reconciliation retry safely. */ }
    } while (requested !== generation);
    running = false;
  }
  const audienceSocket = typeof socket !== 'undefined' ? socket : null;
  audienceSocket?.on('speaker-profiles:changed', data => { if (data?.deckId === deckId) refresh(); });
  audienceSocket?.on('connect', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('resize', () => { if (multiple) goTo(Math.max(0, profiles.findIndex(p => p.id === selectedId)), false); });
  setInterval(() => { if (multiple && !document.hidden) refresh(); }, 30000);
  refresh();
})();
