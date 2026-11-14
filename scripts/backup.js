require("dotenv").config();
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const backupDir = path.join(__dirname, "..", "backups");
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const filePath = path.join(backupDir, `solishare_${timestamp}.dump`);
const pgDumpBin = process.env.PG_DUMP_PATH || "pg_dump";

try {
  execFileSync(pgDumpBin, [process.env.DATABASE_URL, "-Fc", "-f", filePath], { stdio: "inherit" });
  console.log(`Sauvegarde créée avec succès : ${filePath}`);

  const files = fs.readdirSync(backupDir)
    .filter((f) => f.endsWith(".dump"))
    .sort()
    .reverse();

  for (const oldFile of files.slice(7)) {
    fs.unlinkSync(path.join(backupDir, oldFile));
  }
} catch (err) {
  console.error("Échec de la sauvegarde :", err.message);
  process.exit(1);
}
