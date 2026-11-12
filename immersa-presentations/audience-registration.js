const { randomBytes, createHash } = require("node:crypto");

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function audienceId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9_-]{8,191}$/i.test(id)) throw invalid("No se pudo identificar este navegador.");
  return id;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

class AudienceRegistrationRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async config(deckId) {
    const [rows] = await this.pool.execute(
      "SELECT mode, terms_url, revision FROM deck_audience_registration WHERE deck_id = ?", [deckId]
    );
    const row = rows[0];
    return { mode: row?.mode || "name", termsUrl: row?.terms_url || "", revision: Number(row?.revision || 0) };
  }

  async saveConfig(deckId, input) {
    if (!["name", "optional", "required"].includes(input.mode)) throw invalid("Selecciona el tipo de registro.");
    let termsUrl = String(input.termsUrl || "").trim();
    if (input.mode !== "name") {
      let url;
      try { url = new URL(termsUrl); } catch (_) {}
      if (url?.protocol !== "https:" || !url.hostname || url.username || url.password || termsUrl.length > 1000) {
        throw invalid("Agrega el enlace HTTPS de los términos y condiciones.");
      }
      termsUrl = url.href;
    } else {
      termsUrl = "";
    }
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw invalid("Actualiza la configuración.");
    const [result] = input.revision === 0
      ? await this.pool.execute(
        "INSERT IGNORE INTO deck_audience_registration (deck_id, mode, terms_url) VALUES (?, ?, ?)",
        [deckId, input.mode, termsUrl]
      )
      : await this.pool.execute(
        "UPDATE deck_audience_registration SET mode = ?, terms_url = ?, revision = revision + 1 WHERE deck_id = ? AND revision = ?",
        [input.mode, termsUrl, deckId, input.revision]
      );
    if (!result.affectedRows) throw invalid("La configuración cambió. Actualiza antes de guardar.", 409);
    return this.config(deckId);
  }

  async register(deckId, input) {
    const config = await this.config(deckId);
    if (config.mode === "name") throw invalid("El registro de contacto no está habilitado.");
    if (input.revision !== config.revision || input.termsAccepted !== true) {
      throw invalid("Acepta los términos y condiciones vigentes para registrarte.");
    }
    const profile = {};
    for (const [field, maximum] of Object.entries({ name: 120, email: 254, phone: 40, company: 160 })) {
      profile[field] = String(input[field] || "").trim();
      if (!profile[field] || profile[field].length > maximum) throw invalid("Completa nombre, correo, teléfono y empresa.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw invalid("Escribe un correo electrónico válido.");
    if (!/^[+\d().\s-]{5,40}$/.test(profile.phone)) throw invalid("Escribe un teléfono válido.");
    const id = audienceId(input.audienceId);
    const token = randomBytes(32).toString("hex");
    const acceptedAt = new Date();
    const expiresAt = new Date(acceptedAt.getTime() + 24 * 60 * 60 * 1000);
    await this.pool.execute(
      `INSERT INTO deck_audience_profiles
       (deck_id, audience_id, display_name, email, phone, company, terms_url, terms_accepted_at, config_revision, token_hash, token_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), email = VALUES(email), phone = VALUES(phone),
         company = VALUES(company), terms_url = VALUES(terms_url), terms_accepted_at = VALUES(terms_accepted_at),
         config_revision = VALUES(config_revision), token_hash = VALUES(token_hash), token_expires_at = VALUES(token_expires_at)`,
      [deckId, id, profile.name, profile.email, profile.phone, profile.company, config.termsUrl, acceptedAt,
        config.revision, hash(token), expiresAt]
    );
    return { name: profile.name, token, revision: config.revision, expiresAt: expiresAt.getTime() };
  }

  async verify(deckId, id, token) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ""))) return null;
    const [rows] = await this.pool.execute(
      `SELECT display_name AS name, email, phone, company, p.terms_url AS termsUrl, terms_accepted_at AS termsAcceptedAt
       FROM deck_audience_profiles p JOIN deck_audience_registration c ON c.deck_id = p.deck_id
       WHERE p.deck_id = ? AND p.audience_id = ? AND p.token_hash = ?
         AND p.token_expires_at > CURRENT_TIMESTAMP(3) AND p.config_revision = c.revision AND c.mode <> 'name'`,
      [deckId, audienceId(id), hash(token)]
    );
    return rows[0] || null;
  }
}

function registrationHandlers(repository) {
  const respond = operation => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await operation(req));
    } catch (error) {
      if (!error.statusCode) console.error("Unable to update audience registration", error);
      res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "No se pudo guardar el registro." });
    }
  };
  return {
    read: respond(req => repository.config(req.params.deckId)),
    save: respond(req => repository.saveConfig(req.params.deckId, req.body || {}))
  };
}

module.exports = { AudienceRegistrationRepository, registrationHandlers, audienceId };
