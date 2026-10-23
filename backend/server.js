require("dotenv").config();

// Initialize Firebase Admin
require("./config/firebaseAdmin");

const express = require("express");
const cors = require("cors");
const path = require("path");

const connectDB = require("./config/db");

// Routes
const authRoutes = require("./routes/auth");
const groupRoutes = require("./routes/groups");
const expenseRoutes = require("./routes/expenses");
const balanceRoutes = require("./routes/balances");
const paymentRoutes = require("./routes/payment");
const notificationRoutes = require("./routes/notifications");

const app = express();

const PORT = process.env.PORT || 3000;

// =====================================================
// DATABASE CONNECTION
// =====================================================

connectDB();

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(cors());

app.use(express.json());

// Brand header to distinguish LendLocal responses from Render wake-up/error responses
app.use((req, res, next) => {
  res.setHeader("X-App", "LendLocal");
  next();
});

// Never cache authenticated financial API responses as static assets
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// Serve frontend files with explicit caching policies
app.use(
  express.static(path.join(__dirname, "..", "frontend"), {
    setHeaders: (res, filePath) => {
      const fileName = path.basename(filePath);

      // Service worker MUST NEVER be cached by HTTP caches
      if (fileName === "service-worker.js") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        return;
      }

      // HTML pages: always revalidate so online navigation receives the latest HTML
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, must-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        return;
      }

      // Manifest & icons: cache with revalidation
      if (fileName === "manifest.json" || filePath.includes(path.sep + "icons" + path.sep)) {
        res.setHeader("Cache-Control", "public, max-age=86400, must-revalidate");
        return;
      }

      // CSS, JS and other frontend assets:
      // max-age=0 with must-revalidate and ETag allows fast 304 validation when unchanged,
      // and immediate fresh delivery when changed
      if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        return;
      }

      res.setHeader("Cache-Control", "public, max-age=3600");
    },
  })
);

// =====================================================
// API ROUTES
// =====================================================

app.get("/api/health", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/api/config", (req, res) => res.status(200).json({ razorpayEnabled: process.env.RAZORPAY_ENABLED === 'true' }));
app.get("/api/app-version", (req, res) => {
  res.status(200).json({
    latestVersion: "1.0.0",
    versionCode: 1,
    releaseNotes: "Initial release of LendLocal for Android featuring native UPI payments, deep-link settlement, and in-app notification inbox.",
    apkUrl: "https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk",
    releasesPageUrl: "https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.0.0",
    minSupportedVersion: "1.0.0",
    publishedAt: "2026-10-23T15:00:00Z",
  });
});
app.use("/api/auth", authRoutes);

app.use("/api/groups", groupRoutes);

app.use("/api/expenses", expenseRoutes);

app.use("/api/balances", balanceRoutes);

app.use("/api/payment", paymentRoutes);

app.use("/api/notifications", notificationRoutes);

// =====================================================
// API 404 HANDLER
// =====================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    message: "API route not found"
  });
});

// =====================================================
// ERROR HANDLER
// =====================================================

app.use((err, req, res, next) => {
  console.error(err);

  res.status(err.status || 500).json({
    message: err.message || "Internal server error"
  });
});

// =====================================================
// START SERVER
// =====================================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `LendLocal running at http://localhost:${PORT}`
    );

    // Optional in-process scheduler strictly enabled when ENABLE_IN_PROCESS_SCHEDULER === 'true' (e.g. for local dev/testing)
    if (process.env.ENABLE_IN_PROCESS_SCHEDULER === 'true') {
      console.log('[Scheduler] In-process scheduler enabled via ENABLE_IN_PROCESS_SCHEDULER');
      const debtReminderService = require('./services/debtReminderService');
      const intervalMs = parseInt(process.env.SCHEDULER_INTERVAL_MS, 10) || 24 * 60 * 60 * 1000;
      setInterval(() => {
        debtReminderService.sendDebtReminders().catch((err) => {
          console.error('[DebtReminderService] In-process run error:', err?.message || err);
        });
      }, intervalMs);
    } else {
      console.log('[Scheduler] In-process timer disabled. Scheduled debt reminders are managed via external cron invoking POST /api/notifications/reminders/run');
    }
  });
}
module.exports = app;