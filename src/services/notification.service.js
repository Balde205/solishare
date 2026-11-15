const admin = require("../config/firebase");

async function sendPushNotification(fcmToken, title, body) {
  if (!fcmToken) return;

  const message = {
    token: fcmToken,
    notification: { title, body }
  };

  try {
    await admin.messaging().send(message);
    console.log("Notification envoyée avec succès !");
  } catch (error) {
    console.error("Erreur d'envoi :", error.message);
  }
}

module.exports = { sendPushNotification };