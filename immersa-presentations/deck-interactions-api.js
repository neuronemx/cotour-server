const path = require("path");
const fs = require("fs");

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

  function normalizeEndBehavior(value) {
    return ["next", "stay", "loop"].includes(value) ? value : "stay";
  }

  function normalizeVideo(item, index) {
    const slideId = String(item?.slide_id || "").trim();
    const fileName = String(item?.file?.name || item?.file_name || "").trim();
    if (!slideId || !fileName) {
      const error = new Error("Video slide and file name are required");
      error.statusCode = 400;
      throw error;
    }
    return {
      id: String(item?.id || "vid_" + Date.now() + "_" + index).trim(),
      slide_id: slideId,
      file: {
        name: fileName,
        size: Math.max(0, Number(item?.file?.size || item?.file_size || 0) || 0),
        type: String(item?.file?.type || item?.file_type || "video/mp4").trim() || "video/mp4",
        last_modified: Number(item?.file?.last_modified || item?.last_modified || 0) || null
      },
      playback: {
        autoplay: item?.playback?.autoplay !== false,
        end_behavior: normalizeEndBehavior(item?.playback?.end_behavior),
        muted: Boolean(item?.playback?.muted)
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
      return { deck_id: deckId, interactions: [], hidden_slide_ids: [], hidden_slide_indexes: [], videos: [], slides: manifest.slides || [] };
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

    const hiddenIds = body.hidden_slide_ids !== undefined
      ? normalizeIds(body.hidden_slide_ids).filter((slideId) => slideIds.includes(slideId))
      : body.hidden_slide_indexes !== undefined
        ? normalizeIndexes(body.hidden_slide_indexes).map((index) => slideIds[index]).filter(Boolean)
        : current.hidden_slide_ids;
    if (hiddenIds.length >= slideIds.length && slideIds.length) {
      const error = new Error("At least one slide must remain visible");
      error.statusCode = 400;
      throw error;
    }

    const videos = body.videos === undefined
      ? current.videos
      : body.videos.map(normalizeVideo);
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

    return {
      deck_id: deckId,
      interactions: body.interactions.map(normalizeInteraction),
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
      res.json(payload);
    } catch (error) {
      const status = error.statusCode || 500;
      if (status >= 500) console.error("Unable to save deck configuration", error);
      res.status(status).json({ error: error.message || "Unable to save deck configuration" });
    }
  }

  return { getInteractions, putInteractions };
}

module.exports = { createDeckInteractionHandlers };
