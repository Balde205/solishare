const pool = require("../db");

async function runExpirationJob() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Annuler les réservations actives dont l'offre associée a expiré
    const expiredRes = await client.query(`
      UPDATE reservations r
      SET status = 'annulee',
          cancel_reason = COALESCE(r.cancel_reason, 'offer_expired'),
          cancelled_at = COALESCE(r.cancelled_at, NOW())
      FROM offers o
      WHERE r.offer_id = o.id
        AND r.status = 'active'
        AND o.expires_at < NOW()
      RETURNING r.id, r.offer_id
    `);

    // 2. Passer en 'expire' toutes les offres disponibles ou réservées dont expires_at est dépassé
    const expiredOffers = await client.query(`
      UPDATE offers
      SET status = 'expire',
          updated_at = NOW()
      WHERE status IN ('disponible', 'reserve')
        AND expires_at < NOW()
      RETURNING id
    `);

    // 3. Rappels automatiques 30 min avant expiration (P1 Audit)
    const reminders = await client.query(`
      UPDATE reservations r
      SET reminder_sent_at = NOW()
      FROM offers o, users u
      WHERE r.offer_id = o.id
        AND r.receiver_id = u.id
        AND r.status = 'active'
        AND r.reminder_sent_at IS NULL
        AND u.notify_reminders = TRUE
        AND o.expires_at > NOW()
        AND o.expires_at <= NOW() + INTERVAL '30 minutes'
      RETURNING r.id, r.receiver_id, o.title, o.expires_at
    `);

    await client.query("COMMIT");

    if (expiredRes.rowCount > 0 || expiredOffers.rowCount > 0 || reminders.rowCount > 0) {
      console.log(
        `[CRON Expiration] ${expiredRes.rowCount} réservation(s) annulée(s), ${expiredOffers.rowCount} offre(s) expirée(s), ${reminders.rowCount} rappel(s) traité(s).`
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[CRON Expiration] Erreur :", err.message);
  } finally {
    client.release();
  }
}

function startExpirationScheduler(intervalMs = 60_000) {
  runExpirationJob();
  return setInterval(runExpirationJob, intervalMs);
}

module.exports = { runExpirationJob, startExpirationScheduler };
