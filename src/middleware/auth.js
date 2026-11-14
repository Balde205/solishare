const jwt = require("jsonwebtoken");
const pool = require("../db");

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentification requise." });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id, full_name, email, role, is_active, token_version FROM users WHERE id = $1",
      [payload.sub]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Session invalide." });
    if (user.is_active === false) return res.status(403).json({ error: "Compte suspendu." });
    if ((payload.tv || 1) !== user.token_version) {
      return res.status(401).json({ error: "Session révoquée. Veuillez vous reconnecter." });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Jeton invalide ou expiré." });
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Action non autorisée." });
    }
    next();
  };
}

module.exports = { authenticate, allowRoles };
