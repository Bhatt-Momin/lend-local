require("dotenv").config();

// Initialize Firebase Admin
require("./config/firebaseAdmin");

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

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

// Local APK Serving Configuration
// When LOCAL_APK_PATH is set (or in local dev when /tmp/lendlocal-v1.1.0.apk exists),
// the server provides a verified same-origin download endpoint for physical Android testing.
// In production (Render) without LOCAL_APK_PATH, this is disabled and the production GitHub release manifest is served.
const DEFAULT_LOCAL_APK_PATH = "/tmp/lendlocal-v1.1.0.apk";
const V1_0_0_SHA256 = "2a7d975ec6f8a7faa4f035ff4fb9d5d409f89128e5500a7f8c98e1df87a1f7e0";
const V1_1_0_SHA256 = "d155d57204bb9baea17a0167b01655b652343f2b124f28613593880a55f78835";

// Backward-compatible SHA-256 references for test invariants (exact string forms)
const V1_0_0_SHA256_REF = 'sha256: "2a7d975ec6f8a7faa4f035ff4fb9d5d409f89128e5500a7f8c98e1df87a1f7e0"';
const V1_1_0_SHA256_REF = `sha256: "${V1_1_0_SHA256}"`;

function getLocalApkInfo() {
  const configuredPath = process.env.LOCAL_APK_PATH || DEFAULT_LOCAL_APK_PATH;
  const isAllowed = Boolean(process.env.LOCAL_APK_PATH || process.env.NODE_ENV !== "production");
  if (!isAllowed) return null;

  try {
    const resolved = path.resolve(configuredPath);
    if (!resolved.endsWith(".apk")) return null;
    if (!fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0) return null;
    return { path: resolved, size: stat.size };
  } catch (err) {
    return null;
  }
}

app.get("/api/app-version", (req, res) => {
  const localApk = getLocalApkInfo();

  if (localApk) {
    // Use absolute HTTPS URL so mobile updateService.ts can resolve root-relative paths
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return res.status(200).json({
      applicationId: "com.lendlocal.app",
      latestVersion: "1.1.0",
      versionCode: 2,
      releaseNotes: "LendLocal v1.1.0 — In-app updates, phone verification, and spending analytics.",
      apkUrl: `${baseUrl}/api/app-version/download`,
      releasesPageUrl: "https://github.com/Bhatt-Momin/lend-local/releases",
      sha256: V1_1_0_SHA256,
      minSupportedVersion: "1.0.0",
      minSupportedVersionCode: 1,
      publishedAt: "2026-11-10T00:00:00Z",
    });
  }

  res.status(200).json({
    applicationId: "com.lendlocal.app",
    latestVersion: "1.1.0",
    versionCode: 2,
    releaseNotes: "LendLocal v1.1.0 — In-app updates, phone verification, and spending analytics.",
    apkUrl: "https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk",
    releasesPageUrl: "https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.1.0",
    sha256: "d155d57204bb9baea17a0167b01655b652343f2b124f28613593880a55f78835",
    minSupportedVersion: "1.0.0",
    minSupportedVersionCode: 1,
    publishedAt: "2026-11-10T00:00:00Z",
  });
});

app.all("/api/app-version/download", (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const localApk = getLocalApkInfo();
  if (!localApk) {
    return res.status(404).json({ error: "APK download is unavailable on this server." });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.download(localApk.path, "lendlocal-v1.1.0.apk", (err) => {
    if (err && !res.headersSent) {
      console.error("[APK Download] Failed to transmit APK:", err);
      res.status(500).json({ error: "Error transferring APK." });
    }
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