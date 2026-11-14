require("dotenv").config();
const pool = require("../src/db");
let bcrypt;
try { bcrypt = require("bcryptjs"); } catch { bcrypt = require("bcrypt"); }

(async () => {
  await pool.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'admin';`);

  const email = process.env.ADMIN_EMAIL || "admin@solishare.fr";
  const plain = process.env.ADMIN_PASSWORD || "AdminSolishare2026!";
  const hash = await bcrypt.hash(plain, 10);

  await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role, is_verified, is_active)
     VALUES ($1, $2, $3, $4, TRUE, TRUE)
     ON CONFLICT (email) DO UPDATE
     SET role = $4, password_hash = $3, is_verified = TRUE, is_active = TRUE`,
    ["Alhassane Admin", email, hash, "admin"]
  );

  console.log("ENUM mis à jour et compte admin prêt :", email, "/", plain);
  await pool.end();
})().catch(async (err) => {
  console.error("Erreur :", err.message);
  await pool.end();
  process.exit(1);
});
