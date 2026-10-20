(function (root) {
  'use strict';
  function createCard(document, profile) {
    const card = document.createElement('article');
    card.className = 'speaker-profile-card';
    card.dataset.profileId = profile.id;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', profile.displayName);
    // All markup is static. Profile content is assigned through textContent.
    card.innerHTML = '<div class="speaker-profile-scroll"><p class="speaker-profile-eyebrow" data-field="publicTitle"></p><div class="speaker-profile-avatar-ring"><div class="speaker-profile-avatar"><img alt="" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0ZM9 10a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM6.2 18.8A4 4 0 0 1 10 16h4a4 4 0 0 1 3.8 2.8"/></svg></div></div><h2 class="speaker-profile-name" data-field="displayName"></h2><p class="speaker-profile-role" data-field="roleTitle"></p><p class="speaker-profile-company" data-field="company"></p><div class="speaker-profile-divider"></div><section class="speaker-profile-bio-block"><p class="speaker-profile-eyebrow">Acerca de</p><p class="speaker-profile-bio" data-field="bio"></p></section><div class="speaker-profile-links"></div></div>';
    for (const field of ['publicTitle','displayName','roleTitle','company','bio']) {
      const node = card.querySelector('[data-field="' + field + '"]');
      node.textContent = String(profile[field] || (field === 'publicTitle' ? 'Speaker' : ''));
      node.hidden = !node.textContent;
    }
    card.querySelector('.speaker-profile-bio-block').hidden = !profile.bio;
    const image = card.querySelector('img'), fallback = card.querySelector('svg');
    if (profile.photoUrl && /^\/api\/decks\/[a-z0-9-]+\/speaker-photos\//i.test(profile.photoUrl)) {
      image.alt = 'Foto de ' + profile.displayName;
      image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
      image.src = profile.photoUrl; image.hidden = false; fallback.hidden = true;
    }
    const links = card.querySelector('.speaker-profile-links');
    for (const [field, label] of [['websiteUrl','Sitio web'],['linkedinUrl','LinkedIn'],['instagramUrl','Instagram']]) {
      if (!profile[field]) continue;
      let url; try { url = new URL(profile[field]); } catch (_) { continue; }
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      const link = document.createElement('a'); link.className = 'speaker-profile-link';
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = label === 'Sitio web' ? url.hostname.replace(/^www\./i, '') : label;
      links.appendChild(link);
    }
    links.hidden = !links.childElementCount;
    return card;
  }
  root.ImmersaSpeakerCards = {createCard};
  if (typeof module !== 'undefined') module.exports = {createCard};
})(typeof window === 'undefined' ? globalThis : window);
