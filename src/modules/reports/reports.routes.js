const router = require("express").Router();
const { z } = require("zod");
const pool = require("../../db");
const { authenticate } = require("../../middleware/auth");
const asyncHandler = require("../../utils/asyncHandler");

const createReportSchema = z.object({
  target_type: z.enum(["offer", "user"]),
  target_id: z.string().uuid(),
  reason: z.string().trim().min(5, "Motif trop court.").max(1000)
});

router.post("/", authenticate, asyncHandler(async (req, res) => {
  const data = createReportSchema.parse(req.body);

  if (data.target_type === "user" && data.target_id === req.user.id) {
    return res.status(400).json({ error: "Impossible de se signaler soi-même." });
  }

  const table = data.target_type === "offer" ? "offers" : "users";
  const targetCheck = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [data.target_id]);
  if (!targetCheck.rows[0]) {
    return res.status(404).json({ error: "Cible du signalement introuvable." });
  }

  const { rows } = await pool.query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id, target_type, target_id, reason, status, created_at`,
    [req.user.id, data.target_type, data.target_id, data.reason]
  );

  res.status(201).json({ report: rows[0] });
}));

module.exports = router;