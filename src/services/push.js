const admin = require("firebase-admin");

let initialized = false;
function getFirebase() {
  if (initialized) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null; // Push désactivé tant que Firebase n'est pas configuré.
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  initialized = true;
  return admin;
}

async function notifyNearbyUsers(offer) {
  const firebase = getFirebase();
  if (!firebase) return { skipped: true, reason: "Firebase non configuré" };

  const { rows } = await require("../db").query(
    `SELECT u.id AS user_id, d.fcm_token,
       round(ST_Distance(u.position_geo, $1::geography))::int AS distance_m
     FROM users u JOIN user_devices d ON d.user_id=u.id AND d.enabled=true
     WHERE u.position_geo IS NOT NULL
       AND u.push_enabled=true
       AND ST_DWithin(u.position_geo, $1::geography, u.rayon_alerte_m)
       AND u.id <> $2`,
    [offer.position_geo, offer.owner_id]
  );

  let sent = 0;
  for (const row of rows) {
    try {
      const result = await firebase.messaging().send({
        token: row.fcm_token,
        notification: {
          title: "Nouvelle offre à proximité",
          body: `${offer.title} — à environ ${row.distance_m} m`
        },
        data: { offerId: String(offer.id) }
      });
      await require("../db").query(
        `INSERT INTO notification_logs (offer_id,user_id,distance_m,fcm_message_id,status)
         VALUES ($1,$2,$3,$4,'envoye') ON CONFLICT (offer_id,user_id) DO NOTHING`,
        [offer.id, row.user_id, row.distance_m, result]
      );
      sent++;
    } catch (err) {
      await require("../db").query(
        `INSERT INTO notification_logs (offer_id,user_id,distance_m,status)
         VALUES ($1,$2,$3,'echec') ON CONFLICT (offer_id,user_id) DO NOTHING`,
        [offer.id, row.user_id, row.distance_m]
      );
      if (err.code === "messaging/registration-token-not-registered") {
        await require("../db").query(
          "UPDATE user_devices SET enabled=false WHERE fcm_token=$1",
          [row.fcm_token]
        );
      }
    }
  }
  return { sent, targeted: rows.length };
}
module.exports = { notifyNearbyUsers };
