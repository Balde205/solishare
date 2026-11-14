require("dotenv").config();
const pool = require("../src/db");
let hashFn;
try {
  const bcrypt = require("bcryptjs");
  hashFn = (p) => bcrypt.hash(p, 10);
} catch {
  try {
    const bcrypt = require("bcrypt");
    hashFn = (p) => bcrypt.hash(p, 10);
  } catch {
    const argon2 = require("argon2");
    hashFn = (p) => argon2.hash(p);
  }
}

(async () => {
  const email = "admin@solishare.fr";
  const plain = "Admin2026Solishare";
  const hash = await hashFn(plain);

  const res = await pool.query(
    `UPDATE users
     SET password_hash = $1, role = 'admin', is_verified = TRUE, is_active = TRUE
     WHERE LOWER(email) = LOWER($2)
     RETURNING id, email, role`,
    [hash, email]
  );

  if (res.rowCount === 0) {
    await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, is_verified, is_active)
       VALUES ('Alhassane Admin', $1, $2, 'admin', TRUE, TRUE)`,
      [email, hash]
    );
  }

  console.log("Mot de passe réinitialisé :", email, "/", plain);
  await pool.end();
})();
