# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LendLocal is a web-based shared expense and lending management application for small groups (friends, roommates, classmates). It's a full-stack application with a vanilla JavaScript frontend and Node.js/Express backend, using MongoDB for persistence.

## Development Commands

### Backend

```bash
# Start backend server (from backend/ directory)
cd backend
node server.js

# Start with auto-reload during development
npm run dev

# Seed database with test data
npm run seed
```

### Running the Application

1. **Start MongoDB**: Ensure MongoDB is running (local or Atlas connection configured in `backend/.env`)
2. **Start backend**: `cd backend && node server.js` (runs on port 3000)
3. **Access frontend**: Open `http://localhost:3000` in browser (backend serves static frontend files)

The backend serves frontend files from the `frontend/` directory via Express static middleware, so no separate frontend server is needed.

## Architecture

### Backend Architecture

**Request Flow**: Client → Express routes → Middleware (`protect`) → Route handlers → Models → MongoDB

**Key architectural patterns**:

1. **Authentication**: JWT-based with Bearer token in `Authorization` header. The `protect` middleware (in `middleware/auth.js`) verifies tokens and attaches `req.user` to all protected routes.

2. **Balance Calculation Engine** (`utils/helpers.js`):
   - `computeBalances(expenses, members)` is the core algorithm
   - Computes net balances: positive = owed money, negative = owes money
   - Generates simplified pairwise settlements using greedy algorithm
   - Handles floating-point precision by rounding to 2 decimals
   - Used by both `/api/balances` and group detail routes

3. **Expense Splitting**:
   - `splitType: "equal"` - divides amount equally, handling remainders by adding 0.01 to first N participants
   - `splitType: "custom"` - validates that custom shares sum to total amount (within 0.02 tolerance)
   - All splits stored as array of `{user, share}` subdocuments in Expense model

4. **Firebase Cloud Messaging (FCM)**:
   - Firebase Admin SDK initialized in `config/firebaseAdmin.js` (runs on server startup)
   - Notifications sent via `getMessaging().send()` or `sendEachForMulticast()`
   - Two notification triggers:
     - **Expense added**: Sends to all group members except creator (`routes/expenses.js` line 458+)
     - **Payment received**: Sends to payment receiver only (`routes/payment.js` line 165+)
   - Users must have `fcmToken` field populated (saved via `POST /api/auth/fcm-token`)

5. **Razorpay Payment Integration**:
   - Two-step payment flow:
     - `POST /api/payment/create-order` - creates Razorpay order, returns order_id
     - `POST /api/payment/verify-payment` - verifies HMAC signature, saves payment, sends FCM notification
   - Signature verification prevents payment forgery (critical security boundary)
   - Duplicate payments prevented by checking `razorpayPaymentId` uniqueness

### Frontend Architecture

**Client-side state management**: Uses `localStorage` for session persistence
- `lendlocal_token` - JWT token
- `lendlocal_user` - User object JSON

**API Layer** (`js/api.js`):
- `api(path, options)` - central fetch wrapper, auto-injects JWT token
- `requireAuth()` - redirects to login if no token
- All API calls go through this single function

**Progressive Web App (PWA)**:
- `manifest.json` - PWA configuration
- `service-worker.js` - handles offline caching and FCM background messages
- `js/pwa.js` - service worker registration and install prompt UI
- `js/firebase.js` - FCM foreground message handler using Firebase JS SDK

**Firebase Messaging Flow**:
- **Foreground** (page open/focused): `firebase.js` → `onMessage()` → `new Notification()`
- **Background** (page closed/unfocused): `service-worker.js` → `onBackgroundMessage()` → `self.registration.showNotification()`
- Both paths use the same FCM token stored in user's `fcmToken` field

### Database Schema

**User** → **Group** (many-to-many via `members` array) → **Expense** (many-to-one)

**Key relationships**:
- `Group.members`: Array of User ObjectIds
- `Expense.group`: Reference to Group
- `Expense.paidBy`: Reference to User (who paid)
- `Expense.splits`: Array of `{user: ObjectId, share: Number}` (who owes what)
- `Payment.from` / `Payment.to`: User references for direct settlements

**Important field**:
- `User.fcmToken`: Firebase Cloud Messaging token (null until user grants notification permission)

## Key Routes

### Backend API Routes

- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Returns JWT token
- `POST /api/auth/fcm-token` - Save user's FCM token (protected)
- `GET /api/groups` - List user's groups with balance summaries (protected)
- `POST /api/groups` - Create group, accepts `memberEmails` array (protected)
- `GET /api/groups/:id` - Group details with members, expenses, balances, settlements (protected)
- `POST /api/expenses` - Add expense with splits (protected, sends FCM notifications)
- `GET /api/expenses/:groupId` - List group expenses (protected)
- `DELETE /api/expenses/:id` - Remove expense (protected)
- `GET /api/balances/:groupId` - Calculate balances and settlements (protected)
- `POST /api/payment/create-order` - Create Razorpay order (protected)
- `POST /api/payment/verify-payment` - Verify payment signature, save to DB, send FCM notification (protected)

### Frontend Pages

- `/index.html` - Landing page
- `/login.html` - Login form
- `/register.html` - Registration form
- `/dashboard.html` - Groups list with balances
- `/group.html` - Single group view with expenses and settlements (query param: `?id=<groupId>`)

## Environment Configuration

`backend/.env` requires:
```
MONGO_URI=mongodb://...
JWT_SECRET=<random-string>
JWT_EXPIRES_IN=7d
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=<secret>
```

Firebase Admin SDK requires `backend/config/firebase-service-account.json` (service account credentials from Firebase Console).

Frontend Firebase config is hardcoded in `frontend/js/firebase.js` and `frontend/service-worker.js` (includes `apiKey`, `projectId`, `messagingSenderId`, `appId`).

## Testing

### Manual Testing Flows

**Test FCM notifications**:
1. Start backend: `cd backend && node server.js`
2. Open dashboard in browser, grant notification permission
3. Check MongoDB that user's `fcmToken` field is populated
4. Create expense in a group or complete a payment
5. Check backend logs for "Expense notification sent:" or "Payment notification sent:"
6. Verify notification appears in browser/OS

**Test payment flow**:
1. Navigate to group page
2. Click "Settle Up" on a settlement
3. Complete Razorpay test payment (test card: 4111 1111 1111 1111)
4. Verify payment saved in MongoDB `payments` collection
5. Verify receiver gets FCM notification

### Database Seeding

`npm run seed` (from backend/) populates test users, groups, and expenses. Useful for development setup.

## Common Patterns

### Adding a New Protected Route

```javascript
// backend/routes/myroute.js
const express = require('express');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.use(protect); // All routes in this file require auth

router.get('/', async (req, res) => {
  // req.user is populated by protect middleware
  const userId = req.user._id;
  // ... your logic
});

module.exports = router;
```

### Sending FCM Notifications

```javascript
const { getMessaging } = require('firebase-admin/messaging');

// Single recipient
const message = {
  token: user.fcmToken,
  notification: { title: 'Title', body: 'Body' },
  webpush: {
    notification: { icon: '/icons/icon-192.png' },
    fcmOptions: { link: '/dashboard.html' }
  },
  data: { type: 'expense', expenseId: '...' } // String values only
};
const response = await getMessaging().send(message);

// Multiple recipients
const multicastMessage = {
  tokens: [token1, token2, ...],
  notification: { ... },
  // ... same structure
};
const result = await getMessaging().sendEachForMulticast(multicastMessage);
console.log(`${result.successCount} sent, ${result.failureCount} failed`);
```

### Balance Calculation

To get balances and settlements for any group:
```javascript
const { computeBalances } = require('../utils/helpers');
const expenses = await Expense.find({ group: groupId }).populate('paidBy splits.user');
const group = await Group.findById(groupId).populate('members');
const { balances, settlements } = computeBalances(expenses, group.members);
// balances: [{ userId, name, net }] - net is positive (owed) or negative (owes)
// settlements: [{ from: {userId, name}, to: {userId, name}, amount }]
```

## Security Notes

- **JWT tokens expire** based on `JWT_EXPIRES_IN` env var (default 7d)
- **Razorpay signature verification** is critical - never skip or mock in production
- **FCM tokens are device-specific** - users can have one token per device (current implementation stores only one token per user)
- **Firebase service account JSON** is in `.gitignore` - never commit it
- **Passwords** are hashed with bcryptjs before storage (handled in User model pre-save hook)

## Deployment

Currently deployed on Render. The backend serves frontend static files, so only the backend needs to be deployed as a web service.

MongoDB connection string should point to MongoDB Atlas (or other hosted MongoDB) in production.
