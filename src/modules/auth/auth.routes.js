const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const pool = require("../../db");
const { authenticate } = require("../../middleware/auth");
const asyncHandler = require("../../utils/asyncHandler");

const isPhase1C2COnly = () => String(process.env.PHASE1_C2C_ONLY || "false").toLowerCase() === "true";

const registerSchema = z.object({
  full_name: z.string().min(2, "Nom trop court."),
  email: z.string().email("Email invalide.").transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8, "8 caractères minimum."),
  role: z.enum(["particulier", "commercant", "association"]).default("particulier"),
  siret: z.string().regex(/^\d{14}$/, "Le SIRET doit contenir exactement 14 chiffres.").optional(),
  business_address: z.string().min(5, "Adresse du commerce requise.").optional(),
  phone: z.string().min(8, "Téléphone invalide.").optional()
}).superRefine((data, ctx) => {
  if (data.role !== "particulier" && !data.siret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["siret"],
      message: "Le numéro SIRET (14 chiffres) est obligatoire pour un compte professionnel."
    });
  }
});

router.post("/register", asyncHandler(async (req, res) => {
  const data = registerSchema.parse(req.body);

  if (isPhase1C2COnly() && data.role !== "particulier") {
    return res.status(403).json({
      error: "L'inscription des comptes professionnels et associations est désactivée en Phase 1."
    });
  }

  const hash = await bcrypt.hash(data.password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role, siret, business_address, phone)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7)
     RETURNING id, full_name, email, role, created_at`,
    [data.full_name, data.email, hash, data.role, data.siret || null, data.business_address || null, data.phone || null]
  );
  res.status(201).json({ user: rows[0] });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const data = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }).parse(req.body);

  const { rows } = await pool.query(
    "SELECT id, full_name, email, password_hash, role, is_active, token_version FROM users WHERE email = lower($1)",
    [data.email]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect." });
  }
  if (user.is_active === false) {
    return res.status(403).json({ error: "Compte suspendu." });
  }
  if (isPhase1C2COnly() && user.role !== "particulier") {
    return res.status(403).json({
      error: "Les comptes professionnels sont temporairement désactivés en Phase 1."
    });
  }

  const token = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version || 1 }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "15m"
  });
  res.json({
    token,
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role }
  });
}));

router.get("/me", authenticate, (req, res) => {
  if (isPhase1C2COnly() && req.user?.role !== "particulier") {
    return res.status(403).json({
      error: "Accès réservé aux comptes particuliers en Phase 1."
    });
  }
  res.json({ user: req.user });
});

router.post("/logout", authenticate, asyncHandler(async (req, res) => {
  await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [req.user.id]);
  res.json({ message: "Toutes les sessions ont été révoquées." });
}));

// Route pour enregistrer le numéro d'appareil pour les notifications
router.post("/fcm-token", authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { fcmToken } = req.body;

  if (!fcmToken || typeof fcmToken !== "string") {
    return res.status(400).json({ error: "Le token de l'appareil est manquant." });
  }

  await pool.query(
    "UPDATE users SET fcm_token = $1 WHERE id = $2",
    [fcmToken.trim(), userId]
  );

  res.status(200).json({ message: "Appareil enregistré pour les notifications avec succès !" });
}));

module.exports = router;