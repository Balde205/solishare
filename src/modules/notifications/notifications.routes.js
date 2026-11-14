const router = require("express").Router();
const { z } = require("zod");
const pool = require("../../db");
const { authenticate } = require("../../middleware/auth");
const asyncHandler = require("../../utils/asyncHandler");

router.post("/register-device", authenticate, asyncHandler(async (req, res) => {
  const d = z.object({
    fcm_token: z.string().min(20).max(4096),
    platform: z.enum(["ios", "android"])
  }).parse(req.body);
  await pool.query(
    `INSERT INTO user_devices (user_id, fcm_token, platform, enabled, last_seen_at)
     VALUES ($1,$2,$3,true,NOW())
     ON CONFLICT (fcm_token) DO UPDATE
       SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform,
           enabled=true, last_seen_at=NOW()`,
    [req.user.id, d.fcm_token, d.platform]
  );
  res.status(201).json({ message: "Appareil enregistrÃ©." });
}));

router.delete("/register-device", authenticate, asyncHandler(async (req, res) => {
  const d = z.object({ fcm_token: z.string().min(20) }).parse(req.body);
  await pool.query(
    "UPDATE user_devices SET enabled=false WHERE user_id=$1 AND fcm_token=$2",
    [req.user.id, d.fcm_token]
  );
  res.json({ message: "Appareil dÃ©sactivÃ©." });
}));

router.get("/preferences", authenticate, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    "SELECT notify_reservations, notify_reminders FROM users WHERE id = $1",
    [req.user.id]
  );
  res.json({ preferences: rows[0] });
}));

router.patch("/preferences", authenticate, asyncHandler(async (req, res) => {
  const d = z.object({
    notify_reservations: z.boolean().optional(),
    notify_reminders: z.boolean().optional()
  }).parse(req.body);

  const { rows } = await pool.query(
    `UPDATE users
     SET notify_reservations = COALESCE($1, notify_reservations),
         notify_reminders = COALESCE($2, notify_reminders)
     WHERE id = $3
     RETURNING notify_reservations, notify_reminders`,
    [d.notify_reservations ?? null, d.notify_reminders ?? null, req.user.id]
  );
  res.json({ preferences: rows[0] });
}));

module.exports = router;