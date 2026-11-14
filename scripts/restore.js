require("dotenv").config();
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dumpArg = process.argv[2];
if (!dumpArg) {
  console.error("Usage : node scripts/restore.js backups/<nom_du_fichier>.dump");
  process.exit(1);
}

const fullPath = path.resolve(dumpArg);
if (!fs.existsSync(fullPath)) {
  console.error(`Fichier introuvable : ${fullPath}`);
  process.exit(1);
}

const pgRestoreBin = process.env.PG_RESTORE_PATH || "pg_restore";

try {
  execFileSync(pgRestoreBin, ["--clean", "--if-exists", "--no-owner", "-d", process.env.DATABASE_URL, fullPath], {
    stdio: "inherit"
  });
  console.log(`Base restaurée avec succès depuis : ${fullPath}`);
} catch (err) {
  console.error("Échec de la restauration :", err.message);
  process.exit(1);
}
