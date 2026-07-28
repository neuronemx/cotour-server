const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { normalizeDefinition, KnowledgeActivityError } = require("./knowledge-activity-engine");
const { detectLogo } = require("./brand-mentions-api");

const MAX_VIDEO_PREVIEW_BYTES = 96 * 1024;
const VIDEO_PREVIEW_WIDTH = 320;
const VIDEO_PREVIEW_HEIGHT = 180;
const MAX_QUESTION_IMAGE_BYTES = 5 * 1024 * 1024;

function createDeckInteractionHandlers({ dataDecksDir, staticDecksDir }) {
  function normalizeDeckId(value) {
    const deckId = String(value || "").trim();
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(deckId)) {
      const error = new Error("Invalid deck id");
      error.statusCode = 400;
      throw error;
    }
    return deckId;
  }

  async function findDeckDir(id) {
    const deckId = normalizeDeckId(id);
    const candidates = [path.join(dataDecksDir, deckId), path.join(staticDecksDir, deckId)];
    for (const deckDir of candidates) {
      try {
        await fs.promises.access(path.join(deckDir, "manifest.json"), fs.constants.R_OK);
        return { deckId, deckDir };
      } catch (_error) {}
    }
    const error = new Error("Deck not found");
    error.statusCode = 404;
    throw error;
  }

  function normalizeIndexes(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map(Number)
      .filter(Number.isInteger)
      .filter((index) => index >= 0)))
      .sort((a, b) => a - b);
  }

  function normalizeIds(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)));
  }

  function optionId(index) {
    return "opt_" + String.fromCharCode(97 + index);
  }

  function normalizeInteraction(item, index) {
    const prompt = String(item?.prompt || "").trim();
    if (!prompt) {
      const error = new Error("Interaction prompt is required");
      error.statusCode = 400;
      throw error;
    }
    const options = Array.isArray(item?.options)
      ? item.options
        .map((option, optionIndex) => ({
          id: String(option?.id || optionId(optionIndex)).trim() || optionId(optionIndex),
          label: String(option?.label || "").trim()
        }))
        .filter((option) => option.label)
      : [];
    if (options.length < 2) {
      const error = new Error("Poll interactions require at least two options");
      error.statusCode = 400;
      throw error;
    }
    const settings = item?.settings || {};
    return {
      id: String(item?.id || "int_" + Date.now() + "_" + index).trim(),
      slide_id: item?.slide_id ? String(item.slide_id) : null,
      type: "poll",
      title: String(item?.title || prompt).trim() || prompt,
      prompt,
      options,
      settings: {
        allow_multiple: Boolean(settings.allow_multiple),
        anonymous: typeof settings.anonymous === "boolean" ? settings.anonymous : true,
        timer_seconds: Number.isFinite(Number(settings.timer_seconds)) ? Number(settings.timer_seconds) : null,
        correct_option_ids: Array.isArray(settings.correct_option_ids) ? settings.correct_option_ids.map(String) : [],
        points: Number.isFinite(Number(settings.points)) ? Number(settings.points) : 0
      }
    };
  }

  function questionAssetPrefix(deckId) {
    return "/decks/" + encodeURIComponent(deckId) + "/knowledge-assets/";
  }

  function normalizeQuestionImage(image, deckId) {
    if (!image) return null;
    const url = String(image.url || image.src || "").trim();
    const prefix = questionAssetPrefix(deckId);
    const fileName = url.startsWith(prefix) ? url.slice(prefix.length) : "";
    if (!/^question-[a-f0-9]{24}\.(?:png|jpg|webp)$/i.test(fileName)) {
      const error = new Error("Question image reference is invalid");
      error.statusCode = 400;
      throw error;
    }
    return {
      url: prefix + fileName,
      mimeType: String(image.mimeType || image.mime_type || "").slice(0, 64),
      width: Math.max(0, Number(image.width) || 0),
      height: Math.max(0, Number(image.height) || 0),
      sizeBytes: Math.max(0, Number(image.sizeBytes || image.size_bytes) || 0)
    };
  }

  function normalizeKnowledgeDefinition(item, index, category, previous = null, deckId = "") {
    try {
      const normalized = normalizeDefinition({
        ...item,
        id: String(item?.id || `${category}_${Date.now()}_${index}`).trim(),
        category
      });
      const now = new Date().toISOString();
      return {
        ...normalized,
        questions: normalized.questions.map((question) => ({
          ...question,
          image: normalizeQuestionImage(question.image, deckId)
        })),
        createdAt: previous?.createdAt || item?.createdAt || now,
        updatedAt: now
      };
    } catch (error) {
      if (error instanceof KnowledgeActivityError) error.statusCode = 400;
      throw error;
    }
  }

  function normalizeEndBehavior(value) {
    return ["next", "stay", "loop"].includes(value) ? value : "stay";
  }

  function normalizeVideoId(value, index) {
    const id = String(value || "vid_" + Date.now() + "_" + index).trim();
    if (!/^[a-z0-9_-]{1,96}$/i.test(id)) {
      const error = new Error("Invalid video id");
      error.statusCode = 400;
      throw error;
    }
    return id;
  }

  function normalizeDuration(value) {
    const duration = Number(value);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return Math.round(duration * 1000) / 1000;
  }

  function normalizeYouTubeStart(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return 0;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.floor(Number(raw)));
    if (/^\d{1,2}:\d{1,2}(?::\d{1,2})?$/.test(raw)) {
      const parts = raw.split(":").map(Number);
      return Math.max(0, parts.reduce((total, part) => total * 60 + part, 0));
    }
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (!match || !match[0]) return 0;
    return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
  }

  function parseYouTubeUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let parsed;
    try {
      parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw);
    } catch (_error) {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.|music\.)/, "");
    let videoId = "";
    if (host === "youtu.be") {
      videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (parsed.pathname === "/watch") videoId = parsed.searchParams.get("v") || "";
      else {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(parts[0])) videoId = parts[1] || "";
      }
    }
    if (!/^[a-z0-9_-]{11}$/i.test(videoId)) return null;
    const startSeconds = normalizeYouTubeStart(parsed.searchParams.get("start") || parsed.searchParams.get("t"));
    return {
      type: "youtube",
      video_id: videoId,
      url: "https://www.youtube.com/watch?v=" + videoId + (startSeconds ? "&t=" + startSeconds + "s" : ""),
      start_seconds: startSeconds
    };
  }

  function normalizeVideoSource(item) {
    const requestedType = String(item?.source?.type || item?.source_type || item?.provider || "").trim().toLowerCase();
    const youtubeValue = item?.source?.url || item?.youtube_url || item?.url || "";
    if (requestedType !== "youtube" && !youtubeValue) return { type: "local" };
    const source = parseYouTubeUrl(youtubeValue);
    if (!source) {
      const error = new Error("El link de YouTube no es válido");
      error.statusCode = 400;
      throw error;
    }
    const explicitStart = item?.source?.start_seconds ?? item?.start_seconds;
    const startSeconds = explicitStart === undefined || explicitStart === null || explicitStart === ""
      ? source.start_seconds
      : normalizeYouTubeStart(explicitStart);
    return {
      ...source,
      url: "https://www.youtube.com/watch?v=" + source.video_id + (startSeconds ? "&t=" + startSeconds + "s" : ""),
      start_seconds: startSeconds
    };
  }

  function previewUrlPrefix(deckId) {
    return "/decks/" + deckId + "/video-previews/";
  }

  function normalizePreview(item, deckId) {
    const preview = item?.preview || {};
    const dataUrl = String(preview.data_url || item?.preview_data_url || "").trim();
    const url = String(preview.url || item?.preview_url || "").trim();
    const width = Math.max(1, Math.min(1920, Number(preview.width) || VIDEO_PREVIEW_WIDTH));
    const height = Math.max(1, Math.min(1080, Number(preview.height) || VIDEO_PREVIEW_HEIGHT));
    if (dataUrl) return { data_url: dataUrl, width, height };
    if (url.startsWith(previewUrlPrefix(deckId)) && /^[a-z0-9_-]+\.jpg$/i.test(url.slice(previewUrlPrefix(deckId).length))) {
      return { url, width, height };
    }
    return null;
  }

  function normalizeVideo(item, index, deckId) {
    const slideId = String(item?.slide_id || "").trim();
    const source = normalizeVideoSource(item);
    const fileName = String(item?.file?.name || item?.file_name || "").trim();
    if (!slideId || (source.type === "local" && !fileName)) {
      const error = new Error(source.type === "youtube" ? "Video slide is required" : "Video slide and file name are required");
      error.statusCode = 400;
      throw error;
    }
    const preview = source.type === "youtube"
      ? {
        url: "https://i.ytimg.com/vi/" + source.video_id + "/mqdefault.jpg",
        width: VIDEO_PREVIEW_WIDTH,
        height: VIDEO_PREVIEW_HEIGHT
      }
      : normalizePreview(item, deckId);
    return {
      id: normalizeVideoId(item?.id, index),
      slide_id: slideId,
      source,
      file: source.type === "local" ? {
        name: fileName,
        size: Math.max(0, Number(item?.file?.size || item?.file_size || 0) || 0),
        type: String(item?.file?.type || item?.file_type || "video/mp4").trim() || "video/mp4",
        last_modified: Number(item?.file?.last_modified || item?.last_modified || 0) || null
      } : null,
      playback: {
        autoplay: item?.playback?.autoplay !== false,
        end_behavior: normalizeEndBehavior(item?.playback?.end_behavior),
        muted: Boolean(item?.playback?.muted)
      },
      duration_seconds: source.type === "local" ? normalizeDuration(item?.duration_seconds || item?.duration) : null,
      preview
    };
  }

  async function persistVideoPreview(deckDir, deckId, video) {
    if (!video.preview?.data_url) return video;
    const match = /^data:image\/jpeg;base64,([a-z0-9+/=]+)$/i.exec(video.preview.data_url);
    if (!match) {
      const error = new Error("Video preview must be a JPEG image");
      error.statusCode = 400;
      throw error;
    }
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length || bytes.length > MAX_VIDEO_PREVIEW_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      const error = new Error("Video preview is invalid or too large");
      error.statusCode = 400;
      throw error;
    }
    const previewDir = path.join(deckDir, "video-previews");
    await fs.promises.mkdir(previewDir, { recursive: true });
    await fs.promises.writeFile(path.join(previewDir, video.id + ".jpg"), bytes);
    return {
      ...video,
      preview: {
        url: previewUrlPrefix(deckId) + video.id + ".jpg",
        width: video.preview.width,
        height: video.preview.height
      }
    };
  }

  async function readManifest(deckDir) {
    return JSON.parse(await fs.promises.readFile(path.join(deckDir, "manifest.json"), "utf8"));
  }

  function manifestSlideIds(manifest) {
    return (Array.isArray(manifest?.slides) ? manifest.slides : []).map((slide, index) =>
      String(slide?.id || "slide-" + String(index + 1).padStart(3, "0"))
    );
  }

  function migrateHiddenIds(parsed, slideIds) {
    const explicit = normalizeIds(parsed.hidden_slide_ids);
    if (explicit.length) return explicit.filter((id) => slideIds.includes(id));
    return normalizeIndexes(parsed.hidden_slide_indexes)
      .map((index) => slideIds[index])
      .filter(Boolean);
  }

  function payloadFromParsed(parsed, deckId, slideIds) {
    return {
      deck_id: deckId,
      interactions: Array.isArray(parsed) ? parsed : Array.isArray(parsed.interactions) ? parsed.interactions : [],
      contests: Array.isArray(parsed?.contests) ? parsed.contests : [],
      assessments: Array.isArray(parsed?.assessments) ? parsed.assessments : [],
      hidden_slide_ids: migrateHiddenIds(parsed || {}, slideIds),
      hidden_slide_indexes: normalizeIndexes(parsed?.hidden_slide_indexes),
      videos: Array.isArray(parsed?.videos) ? parsed.videos : []
    };
  }

  async function readDeckConfig(id) {
    const { deckId, deckDir } = await findDeckDir(id);
    const manifest = await readManifest(deckDir);
    const slideIds = manifestSlideIds(manifest);
    const configPath = path.join(deckDir, "interactions.json");
    try {
      const parsed = JSON.parse(await fs.promises.readFile(configPath, "utf8"));
      return { ...payloadFromParsed(parsed, deckId, slideIds), slides: manifest.slides || [] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { deck_id: deckId, interactions: [], contests: [], assessments: [], hidden_slide_ids: [], hidden_slide_indexes: [], videos: [], slides: manifest.slides || [] };
    }
  }

  async function normalizePayload(id, body) {
    const { deckId, deckDir } = await findDeckDir(id);
    const manifest = await readManifest(deckDir);
    const slideIds = manifestSlideIds(manifest);
    const current = await readDeckConfig(deckId);
    if (!body || !Array.isArray(body.interactions)) {
      const error = new Error("interactions array is required");
      error.statusCode = 400;
      throw error;
    }

    const usesStableHiddenIds = body.hidden_slide_ids !== undefined;
    const hiddenIds = usesStableHiddenIds
      ? normalizeIds(body.hidden_slide_ids).filter((slideId) => slideIds.includes(slideId))
      : body.hidden_slide_indexes !== undefined
        ? normalizeIndexes(body.hidden_slide_indexes).map((index) => slideIds[index]).filter(Boolean)
        : current.hidden_slide_ids;
    if (usesStableHiddenIds && hiddenIds.length >= slideIds.length && slideIds.length) {
      const error = new Error("At least one slide must remain visible");
      error.statusCode = 400;
      throw error;
    }

    let videos = body.videos === undefined
      ? current.videos
      : body.videos.map((video, index) => normalizeVideo(video, index, deckId));
    const seenVideoSlides = new Set();
    videos.forEach((video) => {
      if (!slideIds.includes(video.slide_id)) {
        const error = new Error("Video references an unknown slide");
        error.statusCode = 400;
        throw error;
      }
      if (seenVideoSlides.has(video.slide_id)) {
        const error = new Error("Only one video can be assigned to each slide");
        error.statusCode = 400;
        throw error;
      }
      seenVideoSlides.add(video.slide_id);
    });
    if (body.videos !== undefined) {
      videos = await Promise.all(videos.map((video) => persistVideoPreview(deckDir, deckId, video)));
    }
    videos.sort((a, b) => slideIds.indexOf(a.slide_id) - slideIds.indexOf(b.slide_id));

    const normalizeDefinitionList = (category, values, currentValues) => {
      const previousById = new Map((Array.isArray(currentValues) ? currentValues : []).map((item) => [String(item?.id || ""), item]));
      return (Array.isArray(values) ? values : []).map((item, index) =>
        normalizeKnowledgeDefinition(item, index, category, previousById.get(String(item?.id || "")) || null, deckId)
      );
    };
    const contests = body.contests === undefined
      ? current.contests
      : normalizeDefinitionList("contest", body.contests, current.contests);
    const assessments = body.assessments === undefined
      ? current.assessments
      : normalizeDefinitionList("assessment", body.assessments, current.assessments);

    return {
      deck_id: deckId,
      interactions: body.interactions.map(normalizeInteraction),
      contests,
      assessments,
      hidden_slide_ids: hiddenIds,
      hidden_slide_indexes: hiddenIds.map((slideId) => slideIds.indexOf(slideId)).filter((index) => index >= 0),
      videos
    };
  }

  async function getInteractions(req, res) {
    try {
      res.json(await readDeckConfig(req.params.deckId));
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) console.error("Unable to read deck configuration", error);
      res.status(status).json({ error: error.message || "Unable to read deck configuration" });
    }
  }

  async function putInteractions(req, res) {
    try {
      const payload = await normalizePayload(req.params.deckId, req.body);
      const { deckDir } = await findDeckDir(req.params.deckId);
      await fs.promises.writeFile(path.join(deckDir, "interactions.json"), JSON.stringify(payload, null, 2) + "\n");
      await cleanupQuestionAssets(deckDir, payload).catch((error) => {
        console.warn("Unable to clean unused question images", error.message);
      });
      res.json(payload);
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) console.error("Unable to save deck configuration", error);
      res.status(status).json({ error: error.message || "Unable to save deck configuration" });
    }
  }

  function normalizeQuestionId(value) {
    const questionId = String(value || "").trim();
    if (!/^[a-z0-9_-]{1,96}$/i.test(questionId)) {
      const error = new Error("Invalid question id");
      error.statusCode = 400;
      throw error;
    }
    return questionId;
  }

  async function cleanupQuestionAssets(deckDir, payload) {
    const assetsDir = path.join(deckDir, "knowledge-assets");
    const referenced = new Set(
      [...(payload.contests || []), ...(payload.assessments || [])]
        .flatMap((definition) => definition.questions || [])
        .map((question) => path.basename(String(question.image?.url || "")))
        .filter((fileName) => /^question-[a-f0-9]{24}\.(?:png|jpg|webp)$/i.test(fileName))
    );
    let files;
    try {
      files = await fs.promises.readdir(assetsDir);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(files
      .filter((fileName) => /^question-[a-f0-9]{24}\.(?:png|jpg|webp)$/i.test(fileName))
      .filter((fileName) => !referenced.has(fileName))
      .map((fileName) => fs.promises.rm(path.join(assetsDir, fileName), { force: true })));
  }

  const questionImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_QUESTION_IMAGE_BYTES, files: 1, fields: 2 }
  }).single("image");

  function uploadQuestionImage(req, res) {
    questionImageUpload(req, res, async (uploadError) => {
      try {
        if (uploadError) {
          const error = new Error(uploadError.code === "LIMIT_FILE_SIZE" ? "La imagen debe pesar máximo 5 MB." : "No se pudo leer la imagen.");
          error.statusCode = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
          throw error;
        }
        if (!req.file?.buffer) {
          const error = new Error("Selecciona una imagen.");
          error.statusCode = 400;
          throw error;
        }
        const detected = detectLogo(req.file.buffer);
        if (detected.width > 4096 || detected.height > 4096) {
          const error = new Error("La imagen no puede superar 4096 × 4096 px.");
          error.statusCode = 400;
          throw error;
        }
        const mimeType = String(req.file.mimetype || "").toLowerCase();
        if (mimeType && mimeType !== "application/octet-stream" && mimeType !== detected.mimeType) {
          const error = new Error("El tipo del archivo no coincide con la imagen.");
          error.statusCode = 400;
          throw error;
        }
        const questionId = normalizeQuestionId(req.params.questionId);
        const { deckId, deckDir } = await findDeckDir(req.params.deckId);
        const assetsDir = path.join(deckDir, "knowledge-assets");
        const fileName = "question-" + crypto.randomBytes(12).toString("hex") + detected.extension;
        await fs.promises.mkdir(assetsDir, { recursive: true });
        await fs.promises.writeFile(path.join(assetsDir, fileName), req.file.buffer, { flag: "wx" });
        res.status(201).json({
          image: {
            url: questionAssetPrefix(deckId) + fileName,
            mimeType: detected.mimeType,
            width: detected.width,
            height: detected.height,
            sizeBytes: req.file.buffer.length
          }
        });
      } catch (error) {
        const status = error.statusCode || (error.name === "BrandMentionError" ? 400 : 500);
        if (status >= 500) console.error("Unable to upload question image", error);
        res.status(status).json({ error: status >= 500 ? "No se pudo guardar la imagen." : error.message });
      }
    });
  }

  return { getInteractions, putInteractions, readDeckConfig, uploadQuestionImage };
}

module.exports = { createDeckInteractionHandlers, MAX_QUESTION_IMAGE_BYTES };
