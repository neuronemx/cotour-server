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

  function formatDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return "Duración pendiente";
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    const clock = hours
      ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0")
      : minutes + ":" + String(remainder).padStart(2, "0");
    return "Duración " + clock;
  }

  function slideId(slide, index) {
    return String(slide?.id || "slide-" + String(index + 1).padStart(3, "0"));
  }

  function thumbnailStorageKey(video) {
    return "immersa:video-thumbnail:" + String(currentDeck?.deckId || "") + ":" + String(video?.id || "");
  }

  function storedThumbnail(video) {
    const serverPreview = String(video?.preview?.url || "").trim();
    if (serverPreview) return serverPreview;
    if (!currentDeck?.deckId || !video?.id) return "";
    try {
      const value = window.localStorage.getItem(thumbnailStorageKey(video)) || "";
      return /^data:image\/(?:jpeg|png|webp);base64,/i.test(value) ? value : "";
    } catch (_error) {
      return "";
    }
  }

  function removeThumbnail(video) {
    if (!video?.id) return;
    try {
      window.localStorage.removeItem(thumbnailStorageKey(video));
    } catch (_error) {}
  }

  function captureFirstFrame(file) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const objectUrl = URL.createObjectURL(file);
      let finished = false;
      let durationSeconds = null;
      const timeout = window.setTimeout(() => finish(""), 6000);

      function finish(value) {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
        resolve({ thumbnail: value || "", durationSeconds });
      }

      function drawFrame() {
        try {
          const sourceWidth = video.videoWidth || 320;
          const sourceHeight = video.videoHeight || 180;
          const canvas = document.createElement("canvas");
          canvas.width = 320;
          canvas.height = 180;
          const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
          const width = sourceWidth * scale;
          const height = sourceHeight * scale;
          canvas.getContext("2d").drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
          finish(canvas.toDataURL("image/jpeg", .76));
        } catch (_error) {
          finish("");
        }
      }

      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.addEventListener("error", () => finish(""), { once: true });
      video.addEventListener("loadedmetadata", () => {
        durationSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      }, { once: true });
      video.addEventListener("seeked", drawFrame, { once: true });
      video.addEventListener("loadeddata", () => {
        durationSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationSeconds;
        const target = Number.isFinite(video.duration) && video.duration > .12 ? Math.min(.12, video.duration / 2) : 0;
        if (target > 0) video.currentTime = target;
        else drawFrame();
      }, { once: true });
      video.src = objectUrl;
      video.load();
    });
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
    top.innerHTML = '<p>Videos en este deck</p>';
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary-action video-editor-add";
    add.textContent = "Agregar video";
    add.addEventListener("click", () => renderForm());
    bodyNode.appendChild(top);

    if (!config.videos.length) {
      const empty = document.createElement("div");
      empty.className = "video-editor-empty";
      empty.innerHTML = '<strong>Este deck todavía no tiene videos.</strong><p>Asigna un MP4 a una slide. Immersa guardará su identidad y Screen vinculará después el archivo local.</p>';
      bodyNode.appendChild(empty);
    } else {
      const stack = document.createElement("div");
      stack.className = "video-editor-list";
      const orderedVideos = [...config.videos].sort((a, b) => {
        const aIndex = config.slides.findIndex((slide, slideIndex) => slideId(slide, slideIndex) === a.slide_id);
        const bIndex = config.slides.findIndex((slide, slideIndex) => slideId(slide, slideIndex) === b.slide_id);
        return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
      });
      orderedVideos.forEach((video) => {
        const index = config.slides.findIndex((slide, slideIndex) => slideId(slide, slideIndex) === video.slide_id);
        const thumbnail = storedThumbnail(video);
        const item = document.createElement("article");
        item.className = "video-editor-item" + (thumbnail ? " has-thumbnail" : "") + (config.hidden_slide_ids.includes(video.slide_id) ? " is-hidden" : "");
        item.innerHTML = '<div class="video-editor-item-copy"><strong>' + escapeHtml(video.file?.name || "Video") + '</strong><span>Slide ' + (index >= 0 ? index + 1 : "no encontrada") + " · " + escapeHtml(formatDuration(video.duration_seconds)) + " · " + escapeHtml(formatBytes(video.file?.size)) + '</span><small>' + escapeHtml(behaviorLabel(video)) + (config.hidden_slide_ids.includes(video.slide_id) ? " · apagado" : "") + '</small></div><div class="video-editor-item-actions"></div>';
        if (thumbnail) {
          const image = document.createElement("img");
          image.className = "video-editor-item-thumbnail";
          image.src = thumbnail;
          image.alt = "Primer frame de " + (video.file?.name || "video");
          image.draggable = false;
          item.prepend(image);
        }
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
            removeThumbnail(video);
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

    bodyNode.appendChild(add);
  }

  function renderForm(existing = null) {
    editingSlideId = existing?.slide_id || null;
    bodyNode.innerHTML = "";
    const form = document.createElement("form");
    form.className = "video-editor-form";
    const options = config.slides.map((slide, index) => {
      const id = slideId(slide, index);
      const assigned = config.videos.some((video) => video.slide_id === id && id !== editingSlideId);
      return '<option value="' + escapeHtml(id) + '"' + (assigned ? " disabled" : "") + ">" + (index + 1) + " · " + escapeHtml(slide?.title || id) + (assigned ? " — ya tiene video" : "") + "</option>";
    }).join("");
    const linkedFile = existing
      ? '<div class="video-editor-linked-file" data-linked-file><span class="video-editor-file-preview"><span class="video-editor-file-badge" data-file-badge aria-hidden="true">MP4</span><img data-file-preview alt="" hidden></span><div class="video-editor-linked-copy"><span>Archivo vinculado</span><strong data-file-name>' + escapeHtml(existing.file?.name || "Archivo registrado") + '</strong><small data-file-size>' + escapeHtml(formatBytes(existing.file?.size)) + '</small></div><button class="secondary-action video-editor-file-action" type="button" data-select-file>Reemplazar MP4</button></div>'
      : '<div class="video-editor-linked-file is-empty" data-linked-file><span class="video-editor-file-preview"><span class="video-editor-file-badge" data-file-badge aria-hidden="true">MP4</span><img data-file-preview alt="" hidden></span><div class="video-editor-linked-copy"><span>Archivo MP4</span><strong data-file-name>Ningún archivo seleccionado</strong><small data-file-size>Selecciona el archivo que se utilizará en Screen.</small></div><button class="secondary-action video-editor-file-action" type="button" data-select-file>Seleccionar MP4</button></div>';
    form.innerHTML = '<div class="video-editor-form-heading"><h3>' + (existing ? "Configuración Multimedia" : "Agregar video") + '</h3><p>El archivo no se sube; Screen lo validará localmente antes de presentar.</p></div><label><span>Slide</span><select name="slide_id" required>' + options + '</select></label><div class="video-editor-file">' + linkedFile + '<input class="video-editor-native-file" name="file" type="file" accept=".mp4,video/mp4" aria-label="Seleccionar archivo MP4"></div><fieldset><legend>Inicio</legend><label class="video-editor-radio"><input type="radio" name="autoplay" value="true" checked><span>Play automático <small>Recomendado</small></span></label><label class="video-editor-radio"><input type="radio" name="autoplay" value="false"><span>Esperar Play de Speaker o Stage</span></label></fieldset><fieldset><legend>Al terminar</legend><label class="video-editor-radio"><input type="radio" name="end_behavior" value="next"><span>Avanzar automáticamente</span></label><label class="video-editor-radio"><input type="radio" name="end_behavior" value="stay" checked><span>Permanecer en esta slide</span></label><label class="video-editor-radio"><input type="radio" name="end_behavior" value="loop"><span>Repetir hasta recibir Siguiente</span></label></fieldset><div class="modal-actions"><button type="button" class="secondary-action" data-cancel>Cancelar</button><button type="submit" class="primary-action">' + (existing ? "Guardar configuración" : "Guardar video") + '</button></div>';
    bodyNode.appendChild(form);

    const slideSelect = form.elements.slide_id;
    if (existing) slideSelect.value = existing.slide_id;
    form.querySelector('input[name="autoplay"][value="' + String(existing?.playback?.autoplay !== false) + '"]').checked = true;
    form.querySelector('input[name="end_behavior"][value="' + (existing?.playback?.end_behavior || "stay") + '"]').checked = true;
    const fileInput = form.elements.file;
    const linkedNode = form.querySelector("[data-linked-file]");
    const nameNode = form.querySelector("[data-file-name]");
    const sizeNode = form.querySelector("[data-file-size]");
    const previewNode = form.querySelector("[data-file-preview]");
    const badgeNode = form.querySelector("[data-file-badge]");
    let selectedThumbnail = existing ? storedThumbnail(existing) : "";
    let selectedDuration = Number(existing?.duration_seconds) || null;
    let thumbnailPromise = null;

    function showThumbnail(value) {
      selectedThumbnail = value || "";
      previewNode.hidden = !selectedThumbnail;
      badgeNode.hidden = Boolean(selectedThumbnail);
      if (selectedThumbnail) {
        previewNode.src = selectedThumbnail;
        previewNode.alt = "Primer frame del video seleccionado";
      } else {
        previewNode.removeAttribute("src");
        previewNode.alt = "";
      }
    }

    showThumbnail(selectedThumbnail);
    form.querySelector("[data-select-file]").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      linkedNode.classList.remove("is-empty");
      nameNode.textContent = file.name;
      sizeNode.textContent = formatBytes(file.size) + " · capturando primer frame…";
      form.querySelector("[data-select-file]").textContent = "Cambiar MP4";
      thumbnailPromise = captureFirstFrame(file).then((preview) => {
        const selected = fileInput.files[0];
        if (!selected || selected.name !== file.name || selected.size !== file.size || selected.lastModified !== file.lastModified) return "";
        selectedDuration = preview.durationSeconds;
        showThumbnail(preview.thumbnail);
        sizeNode.textContent = formatBytes(file.size) + " · " + formatDuration(selectedDuration) + (preview.thumbnail ? " · thumbnail listo" : " · seleccionado");
        return preview.thumbnail;
      });
    });
    form.querySelector("[data-cancel]").addEventListener("click", renderList);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const file = fileInput.files[0];
      if (!existing && !file) return setStatus("Selecciona un archivo MP4.", "error");
      if (file && !/\.mp4$/i.test(file.name)) return setStatus("El archivo debe ser MP4.", "error");
      try {
        setStatus("Guardando…");
        if (thumbnailPromise) await thumbnailPromise;
        const video = {
          id: existing?.id || "vid_" + Date.now().toString(36),
          slide_id: slideSelect.value,
          file: file ? { name: file.name, size: file.size, type: file.type || "video/mp4", last_modified: file.lastModified || null } : existing.file,
          playback: {
            autoplay: form.elements.autoplay.value === "true",
            end_behavior: form.elements.end_behavior.value,
            muted: false
          },
          duration_seconds: selectedDuration,
          preview: /^data:image\/jpeg;base64,/i.test(selectedThumbnail)
            ? { data_url: selectedThumbnail, width: 320, height: 180 }
            : file ? null : existing?.preview || null
        };
        const next = config.videos.filter((item) => item.slide_id !== editingSlideId && item.slide_id !== video.slide_id);
        next.push(video);
        await saveVideos(next);
        removeThumbnail(video);
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
