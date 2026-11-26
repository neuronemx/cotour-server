const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { normalizeProfilePhoto } = require("./profile-api");
const { liveShopEnabled, liveShopTester } = require("./live-shop-config");

const MAX_PRODUCTS = 30;
const MAX_CENTS = 99_999_999;
const DECK_ID = /^[a-z0-9][a-z0-9-]*$/i;
const IMAGE_KEY = /^[a-f0-9-]{36}\.(?:png|jpg|webp)$/;
const examples = [
  { id: "curso", name: "Presentaciones que conectan", description: "Curso digital con ejercicios para diseñar y conducir presentaciones participativas.", priceCents: 129900, image: "curso" },
  { id: "libro", name: "El arte de presentar", description: "Una guía de bolsillo para estructurar ideas y contar historias frente a un público.", priceCents: 34900, image: "libro" },
  { id: "termo", name: "Termo IMMERSA", description: "Botella térmica de acero inoxidable de 500 ml para llevar a tus eventos.", priceCents: 49900, image: "termo" }
].map(product => ({ ...product, visible: true }));
const exampleImages = new Set(examples.map(product => product.image));

class CatalogError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function productFields(input) {
  const name = String(input.name || "").trim();
  const description = String(input.description || "").trim();
  const price = String(input.price || "").trim();
  if (!name || name.length > 80 || !description || description.length > 240) {
    throw new CatalogError("Escribe un nombre de hasta 80 caracteres y una descripción de hasta 240.");
  }
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(price) || !["true", "false"].includes(input.visible)) {
    throw new CatalogError("Revisa el precio en MXN y la visibilidad.");
  }
  const [pesos, decimals = ""] = price.split(".");
  const priceCents = Number(pesos) * 100 + Number(decimals.padEnd(2, "0"));
  if (priceCents < 1 || priceCents > MAX_CENTS) throw new CatalogError("Escribe un precio mayor a cero.");
  return { name, description, priceCents, visible: input.visible === "true" };
}

function productsForClient(deckId, catalog, { owner = false } = {}) {
  return catalog.products.filter(product => owner || product.visible).map(product => {
    const { image, ...fields } = product;
    const imageUrl = exampleImages.has(image)
      ? "/live-shop/images/" + image + ".webp"
      : "/api/decks/" + encodeURIComponent(deckId) + "/live-shop/" + (owner ? "editor-image/" : "image/") + image;
    return { ...fields, imageUrl };
  });
}

function createCatalogStore({ root, onChange }) {
  const mutations = new Map();

  function directory(deckId) {
    if (!DECK_ID.test(deckId)) throw new CatalogError("Deck no encontrado.", 404);
    return path.join(root, deckId);
  }

  async function read(deckId) {
    try {
      return JSON.parse(await fs.readFile(path.join(directory(deckId), "catalog.json"), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { revision: 0, products: examples.map(product => ({ ...product })) };
    }
  }

  function serialize(deckId, operation) {
    const result = (mutations.get(deckId) || Promise.resolve()).catch(() => {}).then(operation);
    mutations.set(deckId, result);
    return result.finally(() => {
      if (mutations.get(deckId) === result) mutations.delete(deckId);
    });
  }

  async function write(deckId, expectedRevision, change) {
    return serialize(deckId, async () => {
      const config = await read(deckId);
      if (String(config.revision) !== String(expectedRevision)) {
        throw new CatalogError("El catálogo cambió. Vuelve a cargarlo antes de guardar.", 409);
      }
      const folder = directory(deckId);
      const products = config.products;
      const changes = change(products);
      const next = { revision: config.revision + 1, products: changes.products || products };
      const tempPath = path.join(folder, randomUUID() + ".tmp");
      const newImage = changes.image && path.join(folder, changes.image.key);
      await fs.mkdir(folder, { recursive: true });
      try {
        if (newImage) await fs.writeFile(newImage, changes.image.buffer, { flag: "wx" });
        await fs.writeFile(tempPath, JSON.stringify(next) + "\n");
        await fs.rename(tempPath, path.join(folder, "catalog.json"));
      } catch (error) {
        await Promise.allSettled([fs.rm(tempPath, { force: true }), ...(newImage ? [fs.rm(newImage, { force: true })] : [])]);
        throw error;
      }
      if (changes.removedImage && IMAGE_KEY.test(changes.removedImage)) {
        await fs.rm(path.join(folder, changes.removedImage), { force: true }).catch(error => {
          console.warn("Unable to remove old Live Shop image", error.code);
        });
      }
      onChange(deckId, next);
      return next;
    });
  }

  function save(deckId, id, input = {}, file) {
    const fields = productFields(input);
    const image = file ? { key: randomUUID() + normalizeProfilePhoto(file).extension, buffer: file.buffer } : null;
    return write(deckId, input.revision, products => {
      const index = products.findIndex(product => product.id === id);
      if (id && index < 0) throw new CatalogError("Producto no encontrado.", 404);
      if (!id && products.length >= MAX_PRODUCTS) throw new CatalogError("El catálogo admite hasta 30 productos.");
      const old = products[index];
      if (!image && !old) throw new CatalogError("Selecciona una imagen para el producto.");
      const product = { id: id || randomUUID(), ...fields, image: image?.key || old.image };
      if (old) products[index] = product;
      else products.push(product);
      return { image, removedImage: image && old?.image };
    });
  }

  function reorder(deckId, input = {}) {
    return write(deckId, input.revision, products => {
      const byId = new Map(products.map(product => [product.id, product]));
      const order = input.ids;
      if (!Array.isArray(order) || order.length !== byId.size || new Set(order).size !== byId.size || order.some(id => !byId.has(id))) {
        throw new CatalogError("El orden debe incluir todos los productos.");
      }
      return { products: order.map(id => byId.get(id)) };
    });
  }

  function remove(deckId, id, input = {}) {
    return write(deckId, input.revision, products => {
      const index = products.findIndex(product => product.id === id);
      if (index < 0) throw new CatalogError("Producto no encontrado.", 404);
      const [product] = products.splice(index, 1);
      return { removedImage: product.image };
    });
  }

  async function imagePath(deckId, key, { owner = false } = {}) {
    if (!IMAGE_KEY.test(key)) throw new CatalogError("Imagen no encontrada.", 404);
    const config = await read(deckId);
    if (!config.products.some(product => product.image === key && (owner || product.visible))) {
      throw new CatalogError("Imagen no encontrada.", 404);
    }
    return path.join(directory(deckId), key);
  }

  return { read, save, reorder, remove, imagePath, removeDeck: deckId => serialize(deckId, () => fs.rm(directory(deckId), { recursive: true, force: true })) };
}

function createCatalogRouter({ store, requireAccount, requireOwnedDeck, requireAccountAdjustmentCleared }) {
  const router = express.Router();
  const base = "/api/decks/:deckId/live-shop";
  const owner = [requireAccount, requireTester, requireOwnedDeck];
  const mutation = [...owner, requireAccountAdjustmentCleared, sameOrigin];
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 2048 }
  }).single("image");

  function requireTester(req, res, next) {
    if (!liveShopTester(req.accountContext?.user)) return res.sendStatus(403);
    return next();
  }

  function sameOrigin(req, res, next) {
    if (!["http://" + req.get("host"), "https://" + req.get("host")].includes(req.headers.origin)) {
      return res.status(403).json({ error: "Origen no autorizado." });
    }
    return next();
  }

  function handle(action) {
    return async (req, res) => {
      res.set("Cache-Control", "no-store");
      try {
        await action(req, res, req.params.deckId);
      } catch (error) {
        const expected = error instanceof CatalogError || error.name === "ProfilePhotoError";
        if (!expected) console.error("Live Shop catalog operation failed", error);
        res.status(expected ? error.status || error.statusCode : 503)
          .json({ error: expected ? error.message : "No se pudo actualizar el catálogo." });
      }
    };
  }

  function multipart(req, res, next) {
    upload(req, res, error => {
      if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .json({ error: "Selecciona una imagen JPG, PNG o WebP de hasta 5 MB." });
      return next();
    });
  }

  function editorResponse(res, deckId, catalog) {
    res.json({ revision: catalog.revision, products: productsForClient(deckId, catalog, { owner: true }) });
  }

  const sendImage = (owner = false) => handle(async (req, res, deckId) => {
    const image = await store.imagePath(deckId, req.params.key, { owner });
    res.set("X-Content-Type-Options", "nosniff");
    res.sendFile(image, { cacheControl: false }, error => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  router.get("/api/live-shop/capability", requireAccount, (req, res) => {
    res.set("Cache-Control", "no-store").json({ enabled: liveShopTester(req.accountContext?.user) });
  });
  router.use(base, (_req, res, next) => liveShopEnabled() ? next() : res.sendStatus(404));
  router.get(base, ...owner, handle(async (_req, res, deckId) => editorResponse(res, deckId, await store.read(deckId))));
  router.get(base + "/editor-image/:key", ...owner, sendImage(true));
  router.get(base + "/image/:key", sendImage());
  router.post(base, ...mutation, multipart, handle(async (req, res, deckId) => {
    editorResponse(res, deckId, await store.save(deckId, null, req.body, req.file));
  }));
  router.put(base + "/order", ...mutation, handle(async (req, res, deckId) => {
    editorResponse(res, deckId, await store.reorder(deckId, req.body));
  }));
  router.put(base + "/:id", ...mutation, multipart, handle(async (req, res, deckId) => {
    editorResponse(res, deckId, await store.save(deckId, req.params.id, req.body, req.file));
  }));
  router.delete(base + "/:id", ...mutation, handle(async (req, res, deckId) => {
    editorResponse(res, deckId, await store.remove(deckId, req.params.id, req.body));
  }));
  return router;
}

module.exports = { createCatalogStore, createCatalogRouter, productsForClient };
