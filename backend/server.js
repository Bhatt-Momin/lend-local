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

// Serve frontend files
app.use(
  express.static(
    path.join(__dirname, "..", "frontend")
  )
);

// =====================================================
// API ROUTES
// =====================================================

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

app.listen(PORT, () => {
  console.log(
    `LendLocal running at http://localhost:${PORT}`
  );
});