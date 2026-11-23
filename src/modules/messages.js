const express = require("express");
const pool = require("../db");
const { authenticate } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();

// Récupérer les messages d'une réservation (donateur ou bénéficiaire uniquement)
router.get(
  "/:reservationId",
  authenticate,
  asyncHandler(async (req, res) => {
    const { reservationId } = req.params;
    const userId = req.user.id;

    const check = await pool.query(
      `SELECT r.id, r.receiver_id, o.owner_id
       FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.id = $1`,
      [reservationId]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ error: "Réservation introuvable." });
    }

    const { receiver_id, owner_id } = check.rows[0];
    if (userId !== receiver_id && userId !== owner_id) {
      return res.status(403).json({ error: "Accès refusé à cette discussion." });
    }

    const { rows } = await pool.query(
      `SELECT m.id, m.sender_id, u.full_name AS sender_name, m.content, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.reservation_id = $1
       ORDER BY m.created_at ASC`,
      [reservationId]
    );

    res.json({ messages: rows });
  })
);

// Envoyer un message sur une réservation active
router.post(
  "/:reservationId",
  authenticate,
  asyncHandler(async (req, res) => {
    const { reservationId } = req.params;
    const userId = req.user.id;
    const content = String(req.body?.content || "").trim();

    if (!content || content.length > 500) {
      return res.status(400).json({ error: "Le message doit contenir entre 1 et 500 caractères." });
    }

    const check = await pool.query(
      `SELECT r.id, r.status, r.receiver_id, o.owner_id
       FROM reservations r
       JOIN offers o ON o.id = r.offer_id
       WHERE r.id = $1`,
      [reservationId]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ error: "Réservation introuvable." });
    }

    const { status, receiver_id, owner_id } = check.rows[0];
    if (userId !== receiver_id && userId !== owner_id) {
      return res.status(403).json({ error: "Accès refusé à cette discussion." });
    }

    if (status !== "active") {
      return res.status(400).json({ error: "La discussion est fermée car le don n'est plus en cours de retrait." });
    }

    const { rows } = await pool.query(
      `INSERT INTO messages (reservation_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, sender_id, content, created_at`,
      [reservationId, userId, content]
    );

    res.status(201).json({ message: rows[0] });
  })
);

module.exports = router;