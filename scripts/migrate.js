require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/db");

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const initSql = fs.readFileSync(path.join(__dirname, "../sql/001_init.sql").replace(/^\uFEFF/, ""), "utf8");
    await pool.query(initSql);

    const migrationsDir = path.join(__dirname, "../migrations");
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const { rows } = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
        if (rows.length === 0) {
          const sql = fs.readFileSync(path.join(migrationsDir, file).replace(/^\uFEFF/, ""), "utf8");
          await pool.query(sql);
          await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
          console.log(`Applied migration: ${file}`);
        }
      }
    }
    console.log("Database schema and migrations up to date.");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
