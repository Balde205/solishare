const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const authRoutes = require("./modules/auth/auth.routes");
const offerRoutes = require("./modules/offers/offers.routes");
const notificationRoutes = require("./modules/notifications/notifications.routes");
const reservationRoutes = require("./modules/reservations/reservations.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const reportRoutes = require("./modules/reports/reports.routes");
const messageRoutes = require("./modules/messages");
const { notFound, errorHandler } = require("./middleware/errors");

const app = express();
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Origin not allowed"));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (process.env.NODE_ENV === "test") return;
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      event: "http_request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      user_id: req.user ? req.user.id : null
    }));
  });
  next();
});
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }));

app.get("/health", (req, res) => res.json({ status: "ok", service: "solishare-api" }));
app.use("/admin", express.static(path.join(__dirname, "..", "public")));
app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads")));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), authRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/messages", messageRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;