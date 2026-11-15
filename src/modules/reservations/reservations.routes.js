const router = require("express").Router();
const crypto = require("crypto");
const { z } = require("zod");
const pool = require("../../db");
const { authenticate, allowRoles } = require("../../middleware/auth");
const asyncHandler = require("../../utils/asyncHandler");
const admin = require("../../config/firebase");

const uuidSchema = z.string().uuid();
const uuidParamSchema = z.object({ id: z.string().uuid() });

// Fonction interne pour envoyer la notification push
async function sendPushNotification(fcmToken, title, body) {
  if (!fcmToken) return;
  const message = {
    token: fcmToken,
    notification: { title, body }
  };
  try {
    await admin.messaging().send(message);
    console.log("Notification push envoyée avec succès !");
  } catch (error) {
    console.error("Erreur d'envoi push :", error.message);
  }
}

function qrSignature(reservationId, expiresAt) {
  return crypto.createHmac("sha256", process.env.QR_HMAC_SECRET)
    .update(`${reservationId}:${new Date(expiresAt).toISOString()}`)
    .digest("hex");
}

function safeEqual(a, b) {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

router.post("/", authenticate, allowRoles("particulier"), asyncHandler(async (req, res) => {
  const d = z.object({ offer_id: z.string().uuid() }).parse(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT * FROM offers WHERE id=$1 FOR UPDATE", [d.offer_id]
    );
    const offer = found.rows[0];
    if (!offer || offer.status !== "disponible" || new Date(offer.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Cette offre n'est plus disponible." });
    }
    if (offer.owner_id === req.user.id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Vous ne pouvez pas réserver votre propre offre." });
    }

    const expiresAt = offer.expires_at;
    const inserted = await client.query(
      `INSERT INTO reservations (offer_id, receiver_id, status, expires_at)
       VALUES ($1,$2,'active',$3) RETURNING id, offer_id, receiver_id, status, expires_at`,
      [offer.id, req.user.id, expiresAt]
    );
    const reservation = inserted.rows[0];
    const signature = qrSignature(reservation.id, reservation.expires_at);
    const qr_token = `${reservation.id}:${signature}`;
    await client.query("UPDATE reservations SET qr_token=$1 WHERE id=$2", [qr_token, reservation.id]);
    await client.query("UPDATE offers SET status='reserve', updated_at=NOW() WHERE id=$1", [offer.id]);
    await client.query("COMMIT");

    // --- NOTIFICATION PUSH AU PROPRIÉTAIRE (NON BLOQUANT) ---
    try {
      const ownerResult = await pool.query(
        "SELECT fcm_token FROM users WHERE id = $1",
        [offer.owner_id]
      );
      const ownerToken = ownerResult.rows[0]?.fcm_token;
      if (ownerToken) {
        await sendPushNotification(
          ownerToken,
          "Nouvelle réservation ! 🛒",
          `Votre offre "${offer.title}" vient d'être réservée.`
        );
      }
    } catch (pushErr) {
      console.log("Erreur d'envoi push (non bloquant) :", pushErr.message);
    }
    // -------------------------------------------------------

    res.status(201).json({
      reservation: { ...reservation, qr_token, offer_title: offer.title, address_label: offer.address_label }
    });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

router.post("/validate-qr", authenticate, allowRoles("commercant", "association"), asyncHandler(async (req, res) => {
  const d = z.object({ qr_token: z.string().min(40).max(500) }).parse(req.body);
  const parts = d.qr_token.split(":");
  if (parts.length !== 2) {
    return res.status(400).json({ error: "QR code invalide." });
  }
  const [reservationId, signature] = parts;
  if (!uuidSchema.safeParse(reservationId).success || !/^[a-f0-9]{64}$/i.test(signature)) {
    return res.status(400).json({ error: "QR code invalide." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT r.*, o.owner_id, o.title, o.id AS offer_id
       FROM reservations r JOIN offers o ON o.id=r.offer_id
       WHERE r.id=$1 FOR UPDATE OF r,o`,
      [reservationId]
    );
    const r = rows[0];
    if (!r || r.owner_id !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Vous ne pouvez pas valider cette réservation." });
    }
    if (r.status !== "active" || new Date(r.expires_at) <= new Date()) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Réservation inactive ou expirée." });
    }
    const expected = qrSignature(r.id, r.expires_at);
    if (!safeEqual(signature, expected) || d.qr_token !== r.qr_token) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Signature QR invalide." });
    }
    await client.query(
      "UPDATE reservations SET status='validee', validated_at=NOW() WHERE id=$1",
      [r.id]
    );
    await client.query("UPDATE offers SET status='retire', updated_at=NOW() WHERE id=$1", [r.offer_id]);
    await client.query(
      `INSERT INTO impact_events (reservation_id,user_id,points,reason)
       VALUES ($1,$2,10,'retrait_confirme'),($1,$3,5,'retrait_confirme')
       ON CONFLICT DO NOTHING`,
      [r.id, r.owner_id, r.receiver_id]
    );
    await client.query("COMMIT");
    res.json({ message: "Remise confirmée.", offer_title: r.title });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

router.get("/my", authenticate, allowRoles("particulier"), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.offer_id, r.status, r.expires_at, r.created_at,
        r.qr_token, o.title AS offer_title, o.address_label, o.price_cents, o.offer_type
     FROM reservations r JOIN offers o ON o.id = r.offer_id
     WHERE r.receiver_id = $1
     ORDER BY (r.status = 'active') DESC, r.created_at DESC`,
    [req.user.id]
  );
  res.json({ count: rows.length, reservations: rows });
}));

router.post("/:id/cancel", authenticate, allowRoles("particulier"), asyncHandler(async (req, res) => {
  const { id } = uuidParamSchema.parse(req.params);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT r.*, o.id AS offer_id FROM reservations r
       JOIN offers o ON o.id=r.offer_id WHERE r.id=$1 FOR UPDATE OF r,o`,
      [id]
    );
    const r = rows[0];
    if (!r || r.receiver_id !== req.user.id || r.status !== "active") {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Réservation introuvable ou non annulable." });
    }
    await client.query("UPDATE reservations SET status='annulee' WHERE id=$1", [r.id]);
    await client.query(
      "UPDATE offers SET status='disponible', updated_at=NOW() WHERE id=$1 AND status='reserve' AND expires_at>NOW()",
      [r.offer_id]
    );
    await client.query("COMMIT");
    res.json({ message: "Réservation annulée." });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}));

router.get("/:id", authenticate, asyncHandler(async (req, res) => {
  const { id } = uuidParamSchema.parse(req.params);
  const { rows } = await pool.query(
    `SELECT r.id,r.offer_id,r.receiver_id,r.status,r.expires_at,r.created_at,
        r.qr_token,o.title AS offer_title,o.address_label
     FROM reservations r JOIN offers o ON o.id=r.offer_id
     WHERE r.id=$1 AND (r.receiver_id=$2 OR o.owner_id=$2)`,
    [id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Réservation introuvable." });
  res.json({ reservation: rows[0] });
}));

module.exports = router;