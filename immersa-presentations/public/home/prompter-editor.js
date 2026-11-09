(function () {
  const panel = document.getElementById("deckPrompter");
  const toggle = document.getElementById("detailVideoAction");
  const esField = document.getElementById("deckPrompterText");
  const enField = document.getElementById("deckPrompterEnglish");
  const enWrapper = document.getElementById("deckPrompterEnglishField");
  const status = document.getElementById("deckPrompterStatus");
  const count = document.getElementById("deckPrompterCount");
  const save = document.getElementById("deckPrompterSave");
  const clear = document.getElementById("deckPrompterDelete");
  const drafts = new Map();
  let deck;
  let slide;
  let notes = null;
  let canManageEnglish = false;
  let busy = false;
  let openVersion = 0;
  let deckVersion = 0;

  const words = value => value.trim().split(/\s+/).filter(Boolean).length;
  const endpoint = deckId => "/api/decks/" + encodeURIComponent(deckId) + "/interactions";

  function updateCount() {
    count.textContent = words(esField.value) + " palabras ES"
      + (enWrapper.hidden ? "" : " · " + words(enField.value) + " palabras EN");
  }

  function syncEnglish() {
    enWrapper.hidden = !(canManageEnglish && Number(deck?.locales?.en?.slides || 0) > 0);
    updateCount();
  }

  function syncControls() {
    esField.disabled = enField.disabled = save.disabled = clear.disabled = busy || !notes;
  }

  function renderSlide() {
    if (!slide) return;
    const saved = drafts.get(slide.slideId) ?? notes?.[slide.slideId];
    esField.value = typeof saved === "object" && saved ? saved.es || "" : saved || "";
    enField.value = typeof saved === "object" && saved ? saved.en || "" : "";
    status.textContent = notes ? (drafts.has(slide.slideId) ? "Cambios sin guardar." : "") : "Cargando…";
    updateCount();
    syncControls();
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function reset() {
    openVersion++;
    deckVersion++;
    notes = null;
    slide = null;
    busy = false;
    drafts.clear();
    setOpen(false);
  }

  async function readConfiguration(deckId) {
    const response = await fetch(endpoint(deckId), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo cargar el Apuntador.");
    return data;
  }

  async function toggleEditor(request) {
    const version = ++openVersion;
    if (!panel.hidden) return setOpen(false);
    slide = request;
    setOpen(true);
    syncEnglish();
    renderSlide();
    if (notes) return esField.focus({ preventScroll: true });
    try {
      const loaded = await readConfiguration(deck.deckId);
      if (version !== openVersion) return;
      notes = loaded.prompter || {};
      renderSlide();
      esField.focus({ preventScroll: true });
    } catch (error) {
      if (version === openVersion) status.textContent = error.message;
    }
  }

  async function persist(remove) {
    if (!notes || !deck || !slide || busy) return;
    const version = deckVersion;
    const { deckId } = deck;
    const { slideId } = slide;
    const es = remove ? "" : esField.value.trim();
    const bilingual = !enWrapper.hidden;
    const en = remove ? "" : enField.value.trim();
    busy = true;
    syncControls();
    status.textContent = "Guardando…";
    try {
      const config = await readConfiguration(deckId);
      const latest = config.prompter || {};
      const english = bilingual ? en : latest[slideId]?.en || "";
      if (!es && !english) delete latest[slideId];
      else latest[slideId] = english || bilingual ? { es, en: english } : es;
      const response = await fetch(endpoint(deckId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactions: config.interactions || [], prompter: latest })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo guardar el Apuntador.");
      if (version !== deckVersion) return;
      notes = result.prompter || latest;
      drafts.delete(slideId);
      if (slide?.slideId === slideId) {
        renderSlide();
        status.textContent = remove ? "Apuntador borrado." : "Apuntador guardado.";
      }
    } catch (error) {
      if (version === deckVersion && slide?.slideId === slideId) status.textContent = error.message;
    } finally {
      if (version === deckVersion) {
        busy = false;
        syncControls();
      }
    }
  }

  function rememberDraft() {
    drafts.set(slide.slideId, { es: esField.value, en: enField.value });
    status.textContent = "Cambios sin guardar.";
    updateCount();
  }

  document.addEventListener("immersa:deck-detail-open", event => {
    reset();
    deck = event.detail?.deck || null;
    canManageEnglish = event.detail?.capabilities?.["multilanguage.manage"] === true;
    syncEnglish();
  });
  document.addEventListener("immersa:deck-detail-close", reset);
  document.addEventListener("immersa:deck-locale-updated", event => {
    if (String(deck?.deckId) !== String(event.detail?.deckId)) return;
    deck.locales = { ...(deck.locales || {}), en: event.detail.variant };
    syncEnglish();
  });
  document.addEventListener("immersa:deck-prompter-slide-request", event => toggleEditor(event.detail));
  document.addEventListener("immersa:deck-prompter-slide-change", event => {
    if (panel.hidden || slide?.slideId === event.detail.slideId) return;
    slide = event.detail;
    renderSlide();
  });
  esField.addEventListener("input", rememberDraft);
  enField.addEventListener("input", rememberDraft);
  save.addEventListener("click", () => persist(false));
  clear.addEventListener("click", () => persist(true));
})();
