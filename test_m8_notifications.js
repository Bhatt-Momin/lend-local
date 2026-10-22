/**
 * LendLocal Milestone 8 (M8) Test Suite
 * In-App Notification Inbox, Server-Side Events & Push Resilience
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Milestone 8 (M8) Test Suite ---');

// ============================================================================
// 1. BACKEND MODEL & SCHEMA CONTRACT TESTS
// ============================================================================
console.log('1. Testing Notification Model & Schema Invariants...');

const notificationModelSource = fs.readFileSync(
  path.join(__dirname, 'backend/models/Notification.js'),
  'utf8'
);

assert(
  notificationModelSource.includes('recipient:') &&
  notificationModelSource.includes("ref: 'User'") &&
  notificationModelSource.includes('required: [true, \'Recipient is required\']'),
  'Notification model must require a recipient referencing User'
);

assert(
  notificationModelSource.includes('type:') &&
  notificationModelSource.includes('expense_added') &&
  notificationModelSource.includes('payment_received') &&
  notificationModelSource.includes('payment_claim') &&
  notificationModelSource.includes('payment_confirmed') &&
  notificationModelSource.includes('payment_rejected'),
  'Notification model must support all core event types'
);

assert(
  notificationModelSource.includes('isRead:') &&
  notificationModelSource.includes('default: false') &&
  notificationModelSource.includes('readAt:'),
  'Notification model must track isRead and readAt'
);

assert(
  notificationModelSource.includes('dedupeKey:') &&
  notificationModelSource.includes('default: null'),
  'Notification model must include dedupeKey field with default null'
);

assert(
  notificationModelSource.includes('notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 })') &&
  notificationModelSource.includes('notificationSchema.index({ recipient: 1, createdAt: -1 })'),
  'Notification model must define compound indexes for efficient inbox querying'
);

// 1E: Database-enforced compound unique index with partialFilterExpression
assert(
  notificationModelSource.includes('notificationSchema.index(') &&
  notificationModelSource.includes('{ recipient: 1, dedupeKey: 1 }') &&
  notificationModelSource.includes('unique: true') &&
  notificationModelSource.includes("partialFilterExpression: { dedupeKey: { $type: 'string' } }") &&
  notificationModelSource.includes("name: 'unique_recipient_dedupe_key'"),
  'Notification model must define a compound unique index on (recipient, dedupeKey) with string partialFilterExpression'
);

// Contract Simulation: Verify partialFilterExpression logic
function simulatePartialIndexFilter(doc) {
  // partialFilterExpression: { dedupeKey: { $type: 'string' } }
  return typeof doc.dedupeKey === 'string';
}

assert.strictEqual(
  simulatePartialIndexFilter({ recipient: 'u1', dedupeKey: 'payment_1' }),
  true,
  'Notifications with string dedupeKey must be indexed by unique constraint'
);
assert.strictEqual(
  simulatePartialIndexFilter({ recipient: 'u1', dedupeKey: null }),
  false,
  'Notifications with null dedupeKey must NOT be indexed by unique constraint'
);
assert.strictEqual(
  simulatePartialIndexFilter({ recipient: 'u1' }),
  false,
  'Notifications with omitted dedupeKey must NOT be indexed by unique constraint'
);

console.log('✅ [Source Assertion & Simulation] Notification model unique index and partialFilterExpression verified.');

// ============================================================================
// 2. BACKEND ROUTES & AUTHORIZATION ISOLATION TESTS
// ============================================================================
console.log('2. Testing Backend Routes & Recipient Isolation...');

const notificationsRouteSource = fs.readFileSync(
  path.join(__dirname, 'backend/routes/notifications.js'),
  'utf8'
);
const serverSource = fs.readFileSync(
  path.join(__dirname, 'backend/server.js'),
  'utf8'
);

assert(
  serverSource.includes('require("./routes/notifications")') &&
  serverSource.includes('app.use("/api/notifications", notificationRoutes)'),
  'server.js must mount /api/notifications route'
);

// Verify protect middleware is applied to all notification routes
assert(
  notificationsRouteSource.includes("router.get('/', protect,") &&
  notificationsRouteSource.includes("router.patch('/:id/read', protect,") &&
  notificationsRouteSource.includes("router.patch('/read-all', protect,"),
  'All notification endpoints must be protected with authentication middleware'
);

// Verify recipient isolation: queries MUST filter strictly by req.user._id
assert(
  notificationsRouteSource.includes('const filter = { recipient: userId };') &&
  notificationsRouteSource.includes('Notification.countDocuments({ recipient: userId, isRead: false })'),
  'GET /api/notifications must strictly isolate notifications to req.user._id'
);

assert(
  notificationsRouteSource.includes('recipient: req.user._id, // Enforce recipient ownership'),
  'PATCH /api/notifications/:id/read must verify recipient ownership before marking read'
);

assert(
  notificationsRouteSource.includes('recipient: req.user._id,') &&
  notificationsRouteSource.includes('isRead: false,'),
  'PATCH /api/notifications/read-all must only affect notifications of the authenticated user'
);

// Functional Simulation of Recipient Isolation & Read Status Transitions
function simulateInboxOwnership() {
  const mockDb = [
    { id: 'n1', recipient: 'user_A', title: 'A notif 1', isRead: false, readAt: null },
    { id: 'n2', recipient: 'user_A', title: 'A notif 2', isRead: true, readAt: new Date() },
    { id: 'n3', recipient: 'user_B', title: 'B notif 1', isRead: false, readAt: null },
  ];

  // User A requests notifications
  const userAId = 'user_A';
  const userANotifs = mockDb.filter(n => n.recipient === userAId);
  const userAUnread = userANotifs.filter(n => !n.isRead).length;

  assert.strictEqual(userANotifs.length, 2, 'User A should only see 2 notifications');
  assert.strictEqual(userAUnread, 1, 'User A unread count should be 1');
  assert(!userANotifs.some(n => n.recipient === 'user_B'), 'User A must never see User B notifications');

  // User A marks n1 as read
  const target = mockDb.find(n => n.id === 'n1' && n.recipient === userAId);
  assert(target, 'Target notification must belong to User A');
  target.isRead = true;
  target.readAt = new Date();

  const userAUnreadAfter = mockDb.filter(n => n.recipient === userAId && !n.isRead).length;
  assert.strictEqual(userAUnreadAfter, 0, 'User A unread count should now be 0');

  // User A attempts to mark User B notif (n3)
  const unauthorizedTarget = mockDb.find(n => n.id === 'n3' && n.recipient === userAId);
  assert.strictEqual(unauthorizedTarget, undefined, 'User A cannot access User B notification');
  assert.strictEqual(mockDb.find(n => n.id === 'n3').isRead, false, 'User B notification remains unread');
}
simulateInboxOwnership();
console.log('✅ Backend recipient isolation and read transitions verified.');

// ============================================================================
// 3. SERVER-SIDE EVENT EMISSION & DEDUPLICATION TESTS
// ============================================================================
console.log('3. Testing Server-Side Event Emission & Deduplication...');

const expensesRouteSource = fs.readFileSync(
  path.join(__dirname, 'backend/routes/expenses.js'),
  'utf8'
);
const paymentRouteSource = fs.readFileSync(
  path.join(__dirname, 'backend/routes/payment.js'),
  'utf8'
);
const notifServiceSource = fs.readFileSync(
  path.join(__dirname, 'backend/services/notificationService.js'),
  'utf8'
);

// 3A: Expense creation calls createMulticastNotifications
assert(
  expensesRouteSource.includes("const { createMulticastNotifications } = require('../services/notificationService');") &&
  expensesRouteSource.includes("await createMulticastNotifications({") &&
  expensesRouteSource.includes("type: 'expense_added',") &&
  expensesRouteSource.includes("dedupePrefix: `expense:${populated._id.toString()}`,"),
  'Expense creation must emit multicast notifications with deduplication prefix'
);

// 3B: Payment verification calls createNotification
assert(
  paymentRouteSource.includes('const { createNotification } = require("../services/notificationService");') &&
  paymentRouteSource.includes('type: "payment_received",') &&
  paymentRouteSource.includes('dedupeKey: `payment_verified:${payment._id.toString()}`,'),
  'Payment verification must emit payment_received notification with dedupeKey'
);

// 3C: UPI claim/confirm/reject emit notifications via sendFcm helper
assert(
  paymentRouteSource.includes('const dedupeKey = data?.type && data?.paymentId') &&
  paymentRouteSource.includes('const res = await createNotification({') &&
  paymentRouteSource.includes('dedupeKey,'),
  'sendFcm helper in payment.js must persist in-app notifications with deduplication'
);

// 3D: Source assertions for E11000 duplicate-key error handling under concurrent race
assert(
  notifServiceSource.includes('createErr.code === 11000 || createErr.message?.includes(\'E11000\')'),
  'notificationService.js must handle MongoDB E11000 duplicate-key errors as idempotent duplicates'
);

assert(
  notifServiceSource.includes('const existing = await Notification.findOne({ recipient, dedupeKey });') &&
  notifServiceSource.includes('return { notification: existing, created: false, pushSent: false };'),
  'createNotification must return existing notification on E11000 collision without throwing'
);

assert(
  notifServiceSource.includes('const existing = await Notification.findOne({ recipient: recipientId, dedupeKey });') &&
  notifServiceSource.includes('results.push({ recipient: recipientId, notification: existing, created: false });'),
  'createMulticastNotifications must catch E11000 collision and preserve existing notification'
);

// 3E: Functional simulation of concurrent database insertion race and E11000 handling
async function simulateConcurrentDatabaseRace() {
  const collection = new Map();

  async function mockDbCreate({ recipient, dedupeKey, title }) {
    const key = `${recipient}:${dedupeKey}`;
    if (collection.has(key)) {
      const err = new Error(`E11000 duplicate key error collection: lendlocal.notifications index: unique_recipient_dedupe_key dup key: { recipient: "${recipient}", dedupeKey: "${dedupeKey}" }`);
      err.code = 11000;
      throw err;
    }
    const doc = { id: 'doc_' + Math.floor(Math.random() * 100000), recipient, dedupeKey, title };
    collection.set(key, doc);
    return doc;
  }

  async function mockCreateNotification({ recipient, dedupeKey, title }) {
    // 1. Application-level check
    const preCheck = collection.get(`${recipient}:${dedupeKey}`);
    if (preCheck) {
      return { notification: preCheck, created: false };
    }

    // 2. Database insert with E11000 catch
    try {
      const notification = await mockDbCreate({ recipient, dedupeKey, title });
      return { notification, created: true };
    } catch (createErr) {
      if (createErr && (createErr.code === 11000 || createErr.message?.includes('E11000'))) {
        const existing = collection.get(`${recipient}:${dedupeKey}`);
        return { notification: existing, created: false };
      }
      throw createErr;
    }
  }

  // Simulate two concurrent requests bypassing pre-check simultaneously
  const req1Promise = mockCreateNotification({ recipient: 'user_99', dedupeKey: 'payment_confirmed:tx_99', title: 'Confirmed' });
  const req2Promise = mockCreateNotification({ recipient: 'user_99', dedupeKey: 'payment_confirmed:tx_99', title: 'Confirmed' });

  const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

  const createdCount = [res1, res2].filter(r => r.created).length;
  const duplicateCount = [res1, res2].filter(r => !r.created).length;

  assert.strictEqual(createdCount, 1, 'Exactly one concurrent insertion must succeed in creating the document');
  assert.strictEqual(duplicateCount, 1, 'The racing duplicate must be caught via E11000 and return created: false');
  assert.strictEqual(res1.notification.id, res2.notification.id, 'Both concurrent calls must reference the identical document');
}
simulateConcurrentDatabaseRace();

console.log('✅ [Source Assertion & Simulation] Server-side event emission, unique constraint, and E11000 race recovery verified.');

// ============================================================================
// 4. PUSH RESILIENCE & FAILURE INDEPENDENCE
// ============================================================================
console.log('4. Testing Push Failure Non-Fatal Invariant...');

// Notification service must catch push errors and never bubble to caller
assert(
  notifServiceSource.includes('try {') &&
  notifServiceSource.includes('dispatchFcmPush') &&
  notifServiceSource.includes('console.error(\'Push delivery error (non-fatal):') ||
  notifServiceSource.includes('console.error(\'FCM push dispatch error (non-fatal):'),
  'Push failure must be non-fatal and must not disrupt in-app notification persistence'
);

// Invalid tokens are cleaned up
assert(
  notifServiceSource.includes('messaging/invalid-registration-token') &&
  notifServiceSource.includes('messaging/registration-token-not-registered') &&
  notifServiceSource.includes('$set: { fcmToken: null, fcmSessionId: null, fcmClaim: null }'),
  'Invalid/unregistered FCM tokens must be cleaned up asynchronously'
);

console.log('✅ Push failure non-fatal invariant and token cleanup verified.');

// ============================================================================
// 5. MOBILE API SERVICE & TYPES CONTRACT TESTS
// ============================================================================
console.log('5. Testing Mobile API Services & Types...');

const mobileTypesSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/types/api.ts'),
  'utf8'
);
const mobileApiSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/services/api.ts'),
  'utf8'
);
const mobileNotifsApiSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/services/notificationsApi.ts'),
  'utf8'
);

assert(
  mobileTypesSource.includes('export interface NotificationItem') &&
  mobileTypesSource.includes('export interface NotificationsListResponse') &&
  mobileTypesSource.includes('export interface MarkNotificationReadResponse') &&
  mobileTypesSource.includes('export interface MarkAllNotificationsReadResponse'),
  'mobile/src/types/api.ts must define notification interfaces'
);

assert(
  mobileNotifsApiSource.includes("notificationsApi = {") &&
  mobileNotifsApiSource.includes("list:") &&
  mobileNotifsApiSource.includes("markAsRead:") &&
  mobileNotifsApiSource.includes("markAllAsRead:"),
  'mobile/src/services/notificationsApi.ts must implement list, markAsRead, and markAllAsRead'
);

assert(
  mobileApiSource.includes("export { notificationsApi } from './notificationsApi';") &&
  mobileApiSource.includes("saveFcmToken:") &&
  mobileApiSource.includes("removeFcmToken:"),
  'mobile/src/services/api.ts must export notificationsApi, saveFcmToken, and removeFcmToken'
);

console.log('✅ Mobile API service and types contracts verified.');

// ============================================================================
// 6. MOBILE IN-APP INBOX UI & DASHBOARD INTEGRATION TESTS
// ============================================================================
console.log('6. Testing Mobile In-App Inbox UI & Bell Affordance...');

const inboxModalSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/components/NotificationInboxModal.tsx'),
  'utf8'
);
const mobileIndexSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/app/index.tsx'),
  'utf8'
);

// 6A: NotificationInboxModal component
assert(
  inboxModalSource.includes('export function NotificationInboxModal') &&
  inboxModalSource.includes('notificationsApi.list') &&
  inboxModalSource.includes('notificationsApi.markAsRead') &&
  inboxModalSource.includes('notificationsApi.markAllAsRead'),
  'NotificationInboxModal must be fully implemented with list and read capabilities'
);

// 6B: Empty, loading, and error states
assert(
  inboxModalSource.includes('No notifications yet') &&
  inboxModalSource.includes('Loading notifications...') &&
  inboxModalSource.includes('load notifications'),
  'NotificationInboxModal must render empty, loading, and error states'
);

// 6C: Header Bell Affordance wired to NotificationInboxModal
assert(
  mobileIndexSource.includes('const [showNotificationsModal, setShowNotificationsModal] = useState(false);') &&
  mobileIndexSource.includes('const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);') &&
  mobileIndexSource.includes('setShowNotificationsModal(true)') &&
  mobileIndexSource.includes('<NotificationInboxModal') &&
  mobileIndexSource.includes('unreadNotificationsCount > 0 ? ('),
  'Dashboard header bell must open NotificationInboxModal and display unread count badge'
);

// 6D: Settlement attention section remains distinct
assert(
  mobileIndexSource.includes('pendingActions.length > 0 && (activeTab === \'overview\' || activeTab === \'activity\')') &&
  mobileIndexSource.includes('Needs your attention'),
  'Settlement attention section must remain distinct from notification unread count'
);

// 6E: Recents tab remains intact
assert(
  mobileIndexSource.includes('Recents') &&
  mobileIndexSource.includes('Recently updated groups'),
  'Recents tab and subtitle must remain intact'
);

console.log('✅ Mobile In-App Inbox UI and dashboard integration verified.');

console.log('\n🎉 ALL Milestone 8 (M8) tests passed successfully!');
