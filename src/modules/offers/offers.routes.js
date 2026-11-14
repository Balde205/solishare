const router = require("express").Router();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { z } = require("zod");
const pool = require("../../db");
const { authenticate, allowRoles } = require("../../middleware/auth");
const asyncHandler = require("../../utils/asyncHandler");

const uuidParamSchema = z.object({ id: z.string().uuid() });

const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional().default(""),
  category: z.enum(["alimentaire", "materiel"]),
  offer_type: z.enum(["don", "vente_flash"]),
  price_cents: z.number().int().min(0).default(0),
  quantity_label: z.string().trim().max(80).optional().default(""),
  photo_url: z.string().url().optional().nullable(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  address_label: z.string().trim().min(3).max(300),
  expires_at: z.string().datetime()
});

router.post("/", authenticate, allowRoles("particulier", "commercant", "association"), asyncHandler(async (req, res) => {
  const d = createSchema.parse(req.body);

  if (req.user.role === "particulier" && d.offer_type !== "don") {
    return res.status(403).json({ error: "Un particulier ne peut publier que des dons gratuits." });
  }

  if (req.user.role !== "particulier") {
    const { rows: uRows } = await pool.query(
      "SELECT is_verified, is_active FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!uRows[0] || !uRows[0].is_active) {
      return res.status(403).json({ error: "Votre compte professionnel est suspendu." });
    }
    if (!uRows[0].is_verified) {
      return res.status(403).json({
        error: "Compte professionnel en attente de vÃƒÆ’Ã‚Â©rification d'identitÃƒÆ’Ã‚Â© par l'ÃƒÆ’Ã‚Â©quipe SoliShare."
      });
    }
  }

  if (d.offer_type === "don" && d.price_cents !== 0) {
    return res.status(400).json({ error: "Un don doit ÃƒÆ’Ã‚Âªtre gratuit." });
  }
    if (Math.abs(d.latitude) < 0.0001 && Math.abs(d.longitude) < 0.0001) {
    return res.status(400).json({ error: "CoordonnÃƒÂ©es GPS invalides (point nul)." });
  }
  if (new Date(d.expires_at) <= new Date()) {
    return res.status(400).json({ error: "La date d'expiration doit ÃƒÆ’Ã‚Âªtre future." });
  }

  const { rows } = await pool.query(
    `INSERT INTO offers
      (owner_id, title, description, category, offer_type, price_cents,
       quantity_label, photo_url, position_geo, address_label, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11,$12)
     RETURNING id, title, category, offer_type, price_cents, quantity_label,
       photo_url, address_label, expires_at, status, created_at`,
    [req.user.id, d.title, d.description, d.category, d.offer_type,
     d.price_cents, d.quantity_label, d.photo_url, d.longitude, d.latitude,
     d.address_label, d.expires_at]
  );
  res.status(201).json({ offer: rows[0] });
}));

// Consultation sans GPS (recherche par ville/texte ou liste) - Audit 3.4
router.get("/", authenticate, asyncHandler(async (req, res) => {
  const q = z.object({
    q: z.string().trim().max(120).optional(),
    category: z.enum(["alimentaire", "materiel"]).optional()
  }).parse(req.query);

  const params = [];
  const filters = ["o.status = 'disponible'", "o.expires_at > NOW()"];
  if (q.category) {
    params.push(q.category);
    filters.push(`o.category = $${params.length}`);
  }
  if (q.q) {
    params.push(`%${q.q}%`);
    filters.push(`(o.address_label ILIKE $${params.length} OR o.title ILIKE $${params.length})`);
  }

  const { rows } = await pool.query(
    `SELECT o.id, o.owner_id, o.title, o.description, o.category, o.offer_type, o.price_cents,
       o.quantity_label, o.photo_url, o.address_label, o.expires_at,
       u.full_name AS owner_name
     FROM offers o JOIN users u ON u.id = o.owner_id
     WHERE ${filters.join(" AND ")}
     ORDER BY o.expires_at ASC LIMIT 50`,
    params
  );
  res.json({ count: rows.length, offers: rows });
}));

router.get("/nearby", authenticate, asyncHandler(async (req, res) => {
  const q = z.object({
    longitude: z.coerce.number().min(-180).max(180),
    latitude: z.coerce.number().min(-90).max(90),
    radius_m: z.coerce.number().int().min(100).max(50000).default(2000),
    category: z.enum(["alimentaire", "materiel"]).optional()
  }).parse(req.query);

  const params = [q.longitude, q.latitude, q.radius_m];
  let categorySql = "";
  if (q.category) {
    params.push(q.category);
    categorySql = ` AND o.category = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT o.id, o.owner_id, o.title, o.description, o.category, o.offer_type, o.price_cents,
       o.quantity_label, o.photo_url, o.address_label, o.expires_at,
       u.full_name AS owner_name,
       round(ST_Distance(o.position_geo,
         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography))::int AS distance_m
     FROM offers o JOIN users u ON u.id = o.owner_id
     WHERE o.status = 'disponible' AND o.expires_at > NOW()
       AND ST_DWithin(o.position_geo,
         ST_SetSRID(ST_MakePoint($1,$2),4326)::geography, $3)
       ${categorySql}
     ORDER BY distance_m ASC, o.expires_at ASC LIMIT 50`,
    params
  );
  res.json({ count: rows.length, offers: rows });
}));

router.get("/mine", authenticate, allowRoles("particulier", "commercant", "association"), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id, o.owner_id, o.title, o.description, o.category, o.offer_type, o.price_cents,
        o.quantity_label, o.address_label, o.status, o.expires_at, o.created_at,
        r.id AS reservation_id, u.full_name AS receiver_name
     FROM offers o
     LEFT JOIN reservations r ON r.offer_id = o.id AND r.status IN ('active', 'validee')
     LEFT JOIN users u ON u.id = r.receiver_id
     WHERE o.owner_id = $1
     ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  res.json({ count: rows.length, offers: rows });
}));

router.get("/stats/me", authenticate, asyncHandler(async (req, res) => {
  const [offersRes, impactRes, pickupsRes] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total_offers,
         COUNT(*) FILTER (WHERE status = 'disponible')::int AS available_offers,
         COUNT(*) FILTER (WHERE status = 'reserve')::int AS reserved_offers,
         COUNT(*) FILTER (WHERE status = 'retire')::int AS redeemed_offers
       FROM offers WHERE owner_id = $1`,
      [req.user.id]
    ),
    pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS total_points,
              COUNT(*)::int AS confirmed_pickups
       FROM impact_events WHERE user_id = $1`,
      [req.user.id]
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'validee')::int AS redeemed_pickups
       FROM reservations WHERE receiver_id = $1`,
      [req.user.id]
    )
  ]);

  res.json({
    offers: offersRes.rows[0],
    impact: impactRes.rows[0],
    pickups: pickupsRes.rows[0]
  });
}));

// GÃƒÂ©ocodage via Base Adresse Nationale (BAN) - P1 Audit
router.get("/geocode", authenticate, asyncHandler(async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(3).max(200) }).parse(req.query);
  const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`;
  const resp = await fetch(url);
  if (!resp.ok) return res.status(502).json({ error: "Service de gÃƒÂ©ocodage indisponible." });
  const data = await resp.json();
  const results = (data.features || []).map((f) => ({
    label: f.properties.label,
    city: f.properties.city,
    postcode: f.properties.postcode,
    longitude: f.geometry.coordinates[0],
    latitude: f.geometry.coordinates[1],
    score: f.properties.score
  }));
  res.json({ results });
}));

// Upload photo sÃƒÂ©curisÃƒÂ© (2 Mo max, validation MIME + octets magiques) - P1 Audit
const ALLOWED_MIMES = {
  "image/jpeg": { ext: "jpg", check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { ext: "png", check: (b) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  "image/webp": { ext: "webp", check: (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" }
};

router.get("/:id", authenticate, asyncHandler(async (req, res) => {
  const { id } = uuidParamSchema.parse(req.params);
  const { rows } = await pool.query(
    `SELECT o.*, u.full_name AS owner_name
     FROM offers o JOIN users u ON u.id=o.owner_id WHERE o.id=$1`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Offre introuvable." });
  res.json({ offer: rows[0] });
}));

router.patch("/:id/cancel", authenticate, allowRoles("particulier", "commercant", "association"), asyncHandler(async (req, res) => {
  const { id } = uuidParamSchema.parse(req.params);
  const { rows } = await pool.query(
    `UPDATE offers SET status='expire', updated_at=NOW()
     WHERE id=$1 AND owner_id=$2 AND status='disponible'
     RETURNING id,status`,
    [id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Offre introuvable ou non annulable." });
  res.json({ offer: rows[0] });
}));

router.post(
  "/upload-photo",
  authenticate,
  express.raw({ type: Object.keys(ALLOWED_MIMES), limit: "2mb" }),
  asyncHandler(async (req, res) => {
    const contentType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const spec = ALLOWED_MIMES[contentType];
    if (!spec || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Format image invalide (JPEG, PNG ou WEBP, 2 Mo max)." });
    }
    if (!spec.check(req.body)) {
      return res.status(400).json({ error: "Signature binaire du fichier non conforme au type dÃƒÂ©clarÃƒÂ©." });
    }
    const filename = `${crypto.randomUUID()}.${spec.ext}`;
    const uploadDir = path.join(__dirname, "../../../public/uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), req.body);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.status(201).json({ photo_url: `${baseUrl}/uploads/${filename}` });
  })
);

module.exports = router;
