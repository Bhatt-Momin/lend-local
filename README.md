# LendLocal

<p align="center">
  <strong>Fast, fair, and frictionless shared expense management for roommates, friends, and groups.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20Web%20%7C%20PWA-10B981?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/Expo-SDK%2057-000000?style=for-the-badge&logo=expo" alt="Expo SDK 57" />
  <img src="https://img.shields.io/badge/React%20Native-0.86.3-61DAFB?style=for-the-badge&logo=react" alt="React Native" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas-47A248?style=for-the-badge&logo=mongodb" alt="MongoDB" />
  <img src="https://img.shields.io/badge/Release-v1.1.0-0ea5e9?style=for-the-badge" alt="Version 1.1.0" />
</p>

---

## 📌 Overview

**LendLocal** is a full-stack financial platform designed to track shared living expenses, simplify multi-party debts, and settle balances instantly. Available as both a **responsive Progressive Web App (PWA)** and a **native Android application (Expo SDK 57 / React Native 0.86)** with seamless UPI integration.

---

## ✨ Features

### 📱 Native Android Experience (Expo SDK 57)
- **Direct UPI Payments**: One-tap settlement via Google Pay, PhonePe, Paytm, or BHIM using native Android intent hooks.
- **In-App APK Updates**: Built-in update engine that checks the release manifest, streams the APK with real-time progress, verifies package SHA-256 checksums, and launches the native package installer.
- **Deep-Link Settlement**: Tap payment links or QR deep links (`lendlocal://`) to open directly into settlement modals.
- **Push Notifications (FCM)**: Multi-device push notification inbox for expense additions, debt reminders, and payment confirmations.

### 💰 Financial & Settlement Engine
- **Equal & Custom Splits**: Split bills equally or assign custom itemized amounts per member.
- **Pairwise Debt Simplification**: Automatically computes optimal "who owes whom" settlement paths.
- **Debt Reminders**: Scheduled notifications to gently nudge group members with outstanding balances.
- **Spending Analytics**: Monthly expense visualization and category breakdowns.

### 🔒 Security & Identity
- **JWT & Session Protection**: Strict token lifecycle management with automated expiration handling.
- **SMS Phone Verification**: International phone verification with 6-digit OTP codes for secure password recovery.
- **Cryptographic File Integrity**: SHA-256 package hashing via streaming Android `ContentResolver` to protect against corrupted or tampered updates.

---

## 🏗️ Architecture & Project Structure

```text
lend-local/
├── backend/              # Node.js Express REST API
│   ├── config/           # Database & Firebase Admin initialization
│   ├── middleware/       # JWT auth, rate limiting & security headers
│   ├── models/           # Mongoose schemas (User, Group, Expense, Notification)
│   ├── routes/           # Auth, Groups, Expenses, Balances, Payments, Updates
│   └── services/         # Debt reminders, email dispatch, push notifications
│
├── frontend/             # Responsive Web & PWA
│   ├── css/              # Dark-mode fintech design system
│   ├── js/               # API clients, service worker, effects & PWA lifecycle
│   └── *.html            # Auth, Dashboard, and Group management pages
│
├── mobile/               # Native Android App (Expo SDK 57 / React Native)
│   ├── modules/          # Custom native Kotlin modules (ApkInstaller streaming SHA-256)
│   ├── src/app/          # Expo Router file-based navigation
│   ├── src/components/   # In-app update modal, payment modals, deep link handlers
│   └── src/services/     # Update service, secure store, API client
│
└── tests/                # Automated regression & integration test suites
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** >= 18.x
- **MongoDB** local instance or MongoDB Atlas URI
- **EAS CLI** (for mobile builds): `npm install -g eas-cli`

### 2. Backend Setup
```bash
cd backend
npm install
cp .env.example .env   # Configure PORT, MONGO_URI, JWT_SECRET
npm run dev
```

### 3. Mobile App (Expo)
```bash
cd mobile
npm install
npx expo start
```
- Press `a` to run on an Android emulator or scan the QR code with the Expo Go app.

### 4. Build Standalone Android APK
```bash
cd mobile
npx eas-cli build --platform android --profile production
```

---

## 🧪 Testing

Run the complete regression test suite:
```bash
npm test
```

All three test suites execute sequentially and must exit with code 0:
- `test_inapp_update.js` — Stage 5: In-App Android Update System
- `test_m3_website_download.js` — Milestone 3: Website Download
- `test_stage2_stage3_fixes.js` — Stage 2 & 3 Audit Fixes Verification

---

## 📦 Distribution & Releases

- **Web App**: Hosted on [Render](https://render.com).
- **Android APK**: Downloadable directly from the Web App login page or via [GitHub Releases](https://github.com/Bhatt-Momin/lend-local/releases).

---

## 📄 License

ISC License © 2026 Momin Nazir Bhat.