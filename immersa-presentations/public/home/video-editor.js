(function () {
  let currentDeck = null;
  let config = null;
  let modal = null;
  let bodyNode = null;
  let statusNode = null;
  let editingSlideId = null;

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
  }

  function niceTitle(value) {
    return String(value || "Presentación").replace(/[-_]+/g, " ").trim() || "Presentación";
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (!bytes) return "Tamaño no registrado";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, index)).toFixed(index > 1 ? 1 : 0) + " " + units[index];
  }

  function slideId(slide, index) {
    return String(slide?.id || "slide-" + String(index + 1).padStart(3, "0"));
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop video-editor-backdrop";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = '<section class="video-editor-modal" role="dialog" aria-modal="true" aria-labelledby="videoEditorTitle"><button class="video-editor-close" type="button" aria-label="Cerrar videos">×</button><div class="video-editor-scroll"><header class="video-editor-header"><span class="video-editor-kicker">Multimedia local</span><h2 id="videoEditorTitle">Videos</h2><p id="videoEditorDeckTitle"></p></header><div class="video-editor-status" aria-live="polite"></div><div class="video-editor-body"></div></div></section>';
    document.body.appendChild(modal);
    bodyNode = modal.querySelector(".video-editor-body");
    statusNode = modal.querySelector(".video-editor-status");
    modal.querySelector(".video-editor-close").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    return modal;
  }

  function setStatus(message, type = "") {
    statusNode.textContent = message || "";
    statusNode.className = "video-editor-status" + (type ? " " + type : "");
  }

  async function loadConfig(deck) {
    const response = await fetch("/api/decks/" + encodeURIComponent(deck.deckId) + "/interactions", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo cargar la configuración del deck.");
    config = {
      interactions: Array.isArray(data.interactions) ? data.interactions : [],
      hidden_slide_ids: Array.isArray(data.hidden_slide_ids) ? data.hidden_slide_ids : [],
      videos: Array.isArray(data.videos) ? data.videos : [],
      slides: Array.isArray(data.slides) ? data.slides : []
    };
  }

  async function saveVideos(videos) {
    const response = await fetch("/api/decks/" + encodeURIComponent(currentDeck.deckId) + "/interactions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interactions: config.interactions,
        hidden_slide_ids: config.hidden_slide_ids,
        videos
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo guardar la configuración de videos.");
    config.videos = Array.isArray(data.videos) ? data.videos : [];
  }

  function behaviorLabel(video) {
    const start = video?.playback?.autoplay === false ? "Play manual" : "Play automático";
    const behavior = video?.playback?.end_behavior === "next"
      ? "avanza al terminar"
      : video?.playback?.end_behavior === "loop"
        ? "loop hasta Siguiente"
        : "permanece en la slide";
    return start + " · " + behavior;
  }

  function renderList() {
    editingSlideId = null;
    bodyNode.innerHTML = "";
    const top = document.createElement("div");
    top.className = "video-editor-toolbar";
    top.innerHTML = '<div><strong>Videos del deck</strong><span>Se reproducirán desde archivos locales preparados en Screen.</span></div>';
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary-action video-editor-add";
    add.textContent = "Agregar video";
    add.addEventListener("click", () => renderForm());
    top.appendChild(add);
    bodyNode.appendChild(top);

    if (!config.videos.length) {
      const empty = document.createElement("div");
      empty.className = "video-editor-empty";
      empty.innerHTML = '<strong>Este deck todavía no tiene videos.</strong><p>Asigna un MP4 a una slide. Immersa guardará su identidad y Screen vinculará después el archivo local.</p>';
      bodyNode.appendChild(empty);
      return;
    }

    const stack = document.createElement("div");
    stack.className = "video-editor-list";
    config.videos.forEach((video) => {
      const index = config.slides.findIndex((slide, slideIndex) => slideId(slide, slideIndex) === video.slide_id);
      const item = document.createElement("article");
      item.className = "video-editor-item" + (config.hidden_slide_ids.includes(video.slide_id) ? " is-hidden" : "");
      item.innerHTML = '<div class="video-editor-item-index">' + (index >= 0 ? index + 1 : "—") + '</div><div class="video-editor-item-copy"><strong>' + escapeHtml(video.file?.name || "Video") + '</strong><span>Slide ' + (index >= 0 ? index + 1 : "no encontrada") + ' · ' + escapeHtml(formatBytes(video.file?.size)) + '</span><small>' + escapeHtml(behaviorLabel(video)) + (config.hidden_slide_ids.includes(video.slide_id) ? " · apagado" : "") + '</small></div><div class="video-editor-item-actions"></div>';
      const actions = item.querySelector(".video-editor-item-actions");
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Editar";
      edit.addEventListener("click", () => renderForm(video));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Eliminar";
      remove.addEventListener("click", async () => {
        if (!window.confirm("¿Eliminar la configuración de este video? La slide original permanecerá en el deck.")) return;
        try {
          setStatus("Guardando…");
          await saveVideos(config.videos.filter((itemVideo) => itemVideo.slide_id !== video.slide_id));
          setStatus("Video eliminado.", "success");
          renderList();
        } catch (error) {
          setStatus(error.message, "error");
        }
      });
      actions.append(edit, remove);
      stack.appendChild(item);
    });
    bodyNode.appendChild(stack);
  }

  function renderForm(existing = null) {
    editingSlideId = existing?.slide_id || null;
    bodyNode.innerHTML = "";
    const form = document.createElement("form");
    form.className = "video-editor-form";
    const options = config.slides.map((slide, index) => {
      const id = slideId(slide, index);
      const assigned = config.videos.some((video) => video.slide_id === id && id !== editingSlideId);
      return '<option value="' + escapeHtml(id) + '"' + (assigned ? " disabled" : "") + '>' + (index + 1) + ' · ' + escapeHtml(slide?.title || id) + (assigned ? " — ya tiene video" : "") + '</option>';
    }).join("");
    form.innerHTML = '<div class="video-editor-form-heading"><span>Video local</span><h3>' + (existing ? "Editar video" : "Agregar video") + '</h3><p>El archivo no se sube. Guardamos su identidad para validarlo en la computadora Screen.</p></div><label><span>Slide</span><select name="slide_id" required>' + options + '</select></label><label class="video-editor-file"><span>Archivo MP4 esperado</span><input name="file" type="file" accept=".mp4,video/mp4"' + (existing ? "" : " required") + '><small data-file-summary>' + (existing ? escapeHtml(existing.file?.name || "Archivo registrado") + " · " + escapeHtml(formatBytes(existing.file?.size)) : "Selecciona el mismo MP4 que se utilizará en Screen.") + '</small></label><fieldset><legend>Inicio</legend><label class="video-editor-radio"><input type="radio" name="autoplay" value="true" checked><span>Play automático <small>Recomendado</small></span></label><label class="video-editor-radio"><input type="radio" name="autoplay" value="false"><span>Esperar Play de Speaker o Stage</span></label></fieldset><fieldset><legend>Al terminar</legend><label class="video-editor-radio"><input type="radio" name="end_behavior" value="next"><span>Avanzar automáticamente</span></label><label class="video-editor-radio"><input type="radio" name="end_behavior" value="stay" checked><span>Permanecer en esta slide</span></label><label class="video-editor-radio"><input type="radio" name="end_behavior" value="loop"><span>Repetir hasta recibir Siguiente</span></label></fieldset><div class="modal-actions"><button type="button" class="secondary-action" data-cancel>Cancelar</button><button type="submit" class="primary-action">Guardar video</button></div>';
    bodyNode.appendChild(form);

    const slideSelect = form.elements.slide_id;
    if (existing) slideSelect.value = existing.slide_id;
    form.querySelector('input[name="autoplay"][value="' + String(existing?.playback?.autoplay !== false) + '"]').checked = true;
    form.querySelector('input[name="end_behavior"][value="' + (existing?.playback?.end_behavior || "stay") + '"]').checked = true;
    const fileInput = form.elements.file;
    const summary = form.querySelector("[data-file-summary]");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      summary.textContent = file ? file.name + " · " + formatBytes(file.size) : "Ningún archivo seleccionado";
    });
    form.querySelector("[data-cancel]").addEventListener("click", renderList);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = fileInput.files[0];
      if (!existing && !file) return setStatus("Selecciona un archivo MP4.", "error");
      if (file && !/\.mp4$/i.test(file.name)) return setStatus("El archivo debe ser MP4.", "error");
      const video = {
        id: existing?.id || "vid_" + Date.now().toString(36),
        slide_id: slideSelect.value,
        file: file ? { name: file.name, size: file.size, type: file.type || "video/mp4", last_modified: file.lastModified || null } : existing.file,
        playback: {
          autoplay: form.elements.autoplay.value === "true",
          end_behavior: form.elements.end_behavior.value,
          muted: false
        }
      };
      const next = config.videos.filter((item) => item.slide_id !== editingSlideId && item.slide_id !== video.slide_id);
      next.push(video);
      try {
        setStatus("Guardando…");
        await saveVideos(next);
        setStatus("Video guardado.", "success");
        renderList();
      } catch (error) {
        setStatus(error.message, "error");
      }
    });
  }

  function openModal(deck) {
    if (!deck?.deckId) return;
    ensureModal();
    currentDeck = deck;
    config = null;
    modal.querySelector("#videoEditorDeckTitle").textContent = niceTitle(deck.title || deck.deckId);
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    bodyNode.innerHTML = "";
    setStatus("Cargando…");
    loadConfig(deck).then(() => {
      setStatus("");
      renderList();
    }).catch((error) => {
      setStatus(error.message, "error");
    });
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    currentDeck = null;
    config = null;
    editingSlideId = null;
    if (document.getElementById("deckDetailModal")?.hidden) document.body.classList.remove("modal-open");
  }

  function appendVideosButton(deck) {
    const actions = document.getElementById("detailActions");
    if (!actions || actions.querySelector(".role-videos")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-role-action role-videos";
    button.textContent = "Videos";
    button.title = "Asignar y configurar videos locales de este deck";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openModal(deck);
    });
    actions.appendChild(button);
  }

  function patchDetailActions() {
    const original = window.renderDetailActions;
    if (typeof original !== "function" || original.__videosPatched) return;
    window.renderDetailActions = function patchedRenderDetailActions(deck) {
      original(deck);
      appendVideosButton(deck);
    };
    window.renderDetailActions.__videosPatched = true;
  }

  patchDetailActions();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal && !modal.hidden) closeModal();
  });
})();
