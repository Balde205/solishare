const express = require("express");
const { z } = require("zod");
const pool = require("../../db");
const authMod = require("../../middleware/auth");
const asyncHandler = require("../../utils/asyncHandler");

const authMiddleware = typeof authMod === "function" ? authMod : authMod.authMiddleware || authMod.authenticate || authMod.protect;
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "AccÃ¨s rÃ©servÃ© aux administrateurs." });
  }
  next();
};

const router = express.Router();

const uuidSchema = z.object({ id: z.string().uuid() });
const verifySchema = z.object({ is_verified: z.boolean() });
const statusSchema = z.object({ is_active: z.boolean() });

router.use(authMiddleware, requireAdmin);

// 1. Vue d'ensemble (utilisateurs + offres rÃ©centes)
router.get("/overview", asyncHandler(async (_req, res) => {
  const [usersRes, offersRes] = await Promise.all([
    pool.query(
      `SELECT id, full_name, email, role, phone, siret, business_address, is_verified, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    ),
    pool.query(
      `SELECT o.id, o.title, o.status, o.expires_at, o.created_at, u.full_name AS merchant_name
       FROM offers o
       JOIN users u ON u.id = o.merchant_id
       ORDER BY o.created_at DESC
       LIMIT 50`
    )
  ]);

  res.json({
    users: usersRes.rows,
    offers: offersRes.rows
  });
}));

// 2. Valider ou retirer la vÃ©rification d'un compte professionnel
router.patch("/users/:id/verify", asyncHandler(async (req, res) => {
  const { id } = uuidSchema.parse(req.params);
  const { is_verified } = verifySchema.parse(req.body);

  const result = await pool.query(
    `UPDATE users
     SET is_verified = $1
     WHERE id = $2 AND role IN ('commercant', 'association')
     RETURNING id, full_name, email, role, is_verified, is_active`,
    [is_verified, id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "Compte professionnel introuvable." });
  }

  res.json({ user: result.rows[0] });
}));

// 3. Suspendre ou rÃ©activer un compte
router.patch("/users/:id/status", asyncHandler(async (req, res) => {
  const { id } = uuidSchema.parse(req.params);
  const { is_active } = statusSchema.parse(req.body);

  const result = await pool.query(
    `UPDATE users
     SET is_active = $1
     WHERE id = $2 AND role <> 'admin'
     RETURNING id, full_name, email, role, is_verified, is_active`,
    [is_active, id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "Utilisateur introuvable ou non modifiable." });
  }

  res.json({ user: result.rows[0] });
}));

// 4. ModÃ©rer / annuler de force une offre litigieuse
router.patch("/offers/:id/cancel", asyncHandler(async (req, res) => {
  const { id } = uuidSchema.parse(req.params);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const offerRes = await client.query(
      `UPDATE offers SET status = 'retire'
       WHERE id = $1 AND status IN ('disponible', 'reserve')
       RETURNING id, title, status`,
      [id]
    );
    if (!offerRes.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Offre introuvable ou dÃ©jÃ  clÃ´turÃ©e." });
    }

    await client.query(
      `UPDATE reservations SET status = 'annulee'
       WHERE offer_id = $1 AND status = 'active'`,
      [id]
    );

    await client.query("COMMIT");
    res.json({ offer: offerRes.rows[0], message: "Offre suspendue par l'administration." });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));


// 5. Lister les signalements (P1 Audit)
router.get("/reports", asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.status, r.admin_note, r.created_at, r.resolved_at,
            u.full_name AS reporter_name, u.email AS reporter_email
     FROM reports r
     JOIN users u ON u.id = r.reporter_id
     ORDER BY (r.status = 'ouvert') DESC, r.created_at DESC
     LIMIT 100`
  );
  res.json({ reports: rows });
}));

// 6. Traiter un signalement (rÃ©soudre ou rejeter, avec action optionnelle)
router.patch("/reports/:id", asyncHandler(async (req, res) => {
  const { id } = uuidSchema.parse(req.params);
  const body = z.object({
    status: z.enum(["resolu", "rejete"]),
    admin_note: z.string().trim().max(500).optional().default(""),
    suspend_target: z.boolean().optional().default(false)
  }).parse(req.body);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repRes = await client.query(
      `UPDATE reports
       SET status = $1, admin_note = $2, resolved_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [body.status, body.admin_note, id]
    );
    const report = repRes.rows[0];
    if (!report) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Signalement introuvable." });
    }

    if (body.status === "resolu" && body.suspend_target) {
      if (report.target_type === "offer") {
        await client.query("UPDATE offers SET status = 'retire' WHERE id = $1", [report.target_id]);
        await client.query("UPDATE reservations SET status = 'annulee' WHERE offer_id = $1 AND status = 'active'", [report.target_id]);
      } else if (report.target_type === "user") {
        await client.query("UPDATE users SET is_active = false, token_version = token_version + 1 WHERE id = $1 AND role <> 'admin'", [report.target_id]);
      }
    }

    await client.query("COMMIT");
    res.json({ report });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;