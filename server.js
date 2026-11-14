require("dotenv").config();
const app = require("./src/app");
const pool = require("./src/db");
const { startExpirationScheduler } = require("./src/jobs/expiration.job");

const port = Number(process.env.PORT || 4000);

function validateEnv() {
  const jwtSecret = process.env.JWT_SECRET || "";
  const qrSecret = process.env.QR_HMAC_SECRET || "";

  if (jwtSecret.length < 32) {
    throw new Error("Configuration invalide : JWT_SECRET doit contenir au moins 32 caractères.");
  }
  if (qrSecret.length < 32) {
    throw new Error("Configuration invalide : QR_HMAC_SECRET doit contenir au moins 32 caractères.");
  }
  if (jwtSecret === qrSecret) {
    throw new Error("Sécurité : JWT_SECRET et QR_HMAC_SECRET doivent être strictement différents.");
  }
}

async function start() {
  validateEnv();
  await pool.query("SELECT 1");
  app.listen(port, () => console.log(`SoliShare API listening on :${port}`));
  startExpirationScheduler(60_000);
}

start().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});