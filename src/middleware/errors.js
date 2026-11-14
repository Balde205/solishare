function notFound(req, res) {
  res.status(404).json({ error: "Route introuvable." });
}

function errorHandler(err, req, res, next) {
  if (err.name === "ZodError") {
    return res.status(400).json({ error: "Données invalides.", details: err.issues });
  }
  if (err.code === "22P02") {
    return res.status(400).json({ error: "Identifiant au format invalide." });
  }
  if (err.code === "23505") {
    return res.status(409).json({ error: "Cette donnée existe déjà ou l'offre n'est plus disponible." });
  }
  if (err.code === "23503" || err.code === "23514") {
    return res.status(400).json({ error: "Contrainte de données non respectée." });
  }
  if (err.message === "Origin not allowed") {
    return res.status(403).json({ error: "Origine CORS non autorisée." });
  }

  console.error(`[${new Date().toISOString()}] Internal Error:`, err.message);
  res.status(500).json({ error: "Erreur interne du serveur." });
}

module.exports = { notFound, errorHandler };