/**
 * test_debt_reminders.js — Test Suite for Stage 4: 30-Day Debt Reminders
 *
 * Covers:
 * 1. Notification Model Schema Invariants (debt_reminder enum, dedupeKey, compound unique index)
 * 2. P0-4: Secure Scheduler Endpoint Middleware (requireSchedulerSecret, timingSafeEqual, fail-closed 503/401)
 * 3. P0-5: Reliable Scheduling & In-Process Concurrency Lock (external trigger architecture, overlapping run lockout)
 * 4. 30-day threshold enforcement (debts < 30 days ignored, >= 30 days flagged)
 * 5. Fully settled debts are strictly excluded
 * 6. Partial settlements (reminders only reflect remaining net unsettled balance)
 * 7. Durable database deduplication & E11000 race condition safety
 * 8. Non-automated payment safety (payload contains safe navigation IDs without automatic execution)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure modules can be loaded from backend/node_modules when running from root
module.paths.push(path.join(__dirname, 'backend/node_modules'));

console.log('--- Running Stage 4: 30-Day Debt Reminders Test Suite ---');

async function runAllTests() {
  // 1. Notification Model Schema & Enum Invariants
  console.log('1. Testing Notification Model Schema Invariants...');
  const notificationModelPath = path.join(__dirname, 'backend', 'models', 'Notification.js');
  const notificationContent = fs.readFileSync(notificationModelPath, 'utf8');

  assert(notificationContent.includes("'debt_reminder'"), "Notification schema enum must include 'debt_reminder'");
  assert(notificationContent.includes('dedupeKey'), 'Notification schema must define dedupeKey');
  assert(notificationContent.includes('unique_recipient_dedupe_key'), 'Notification schema must enforce unique_recipient_dedupe_key index');
  console.log('✅ Notification Model Schema Invariants verified.');

  // 2. P0-4: Secure Scheduler Endpoint Middleware (requireSchedulerSecret)
  console.log('2. Testing P0-4: Secure Scheduler Endpoint Middleware...');
  const notificationsRouter = require('./backend/routes/notifications');
  const requireSchedulerSecret = notificationsRouter.requireSchedulerSecret;
  assert(typeof requireSchedulerSecret === 'function', 'requireSchedulerSecret middleware must be exported');

  const origSecret = process.env.INTERNAL_SCHEDULER_SECRET;

  try {
    // 2A: Fail closed if INTERNAL_SCHEDULER_SECRET is not configured on server
    delete process.env.INTERNAL_SCHEDULER_SECRET;
    let status503 = null;
    let json503 = null;
    const reqUnconfigured = { headers: { 'x-scheduler-secret': 'any-secret' } };
    const res503 = {
      status(s) { status503 = s; return this; },
      json(j) { json503 = j; return this; },
    };
    let next503Called = false;
    requireSchedulerSecret(reqUnconfigured, res503, () => { next503Called = true; });

    assert.strictEqual(status503, 503, 'Must return 503 when scheduler secret is not configured on server');
    assert.strictEqual(next503Called, false, 'Next must not be called when server is misconfigured');
    assert(json503.message.includes('not configured'), 'Error message must explain scheduler secret is unconfigured');

    // 2B: Configure secret on server
    const testSecret = 'lendlocal-production-cron-secret-2026-xyz';
    process.env.INTERNAL_SCHEDULER_SECRET = testSecret;

    // 2C: Reject request with missing X-Scheduler-Secret header (401)
    let status401Missing = null;
    let json401Missing = null;
    const reqMissing = { headers: {} };
    const res401Missing = {
      status(s) { status401Missing = s; return this; },
      json(j) { json401Missing = j; return this; },
    };
    let nextMissingCalled = false;
    requireSchedulerSecret(reqMissing, res401Missing, () => { nextMissingCalled = true; });

    assert.strictEqual(status401Missing, 401, 'Must return 401 when header is missing');
    assert.strictEqual(nextMissingCalled, false);
    assert(json401Missing.message.includes('Missing required X-Scheduler-Secret header'));

    // 2D: Reject request with wrong secret (401)
    let status401Wrong = null;
    const reqWrong = { headers: { 'x-scheduler-secret': 'wrong-password-attempt' } };
    const res401Wrong = {
      status(s) { status401Wrong = s; return this; },
      json() { return this; },
    };
    let nextWrongCalled = false;
    requireSchedulerSecret(reqWrong, res401Wrong, () => { nextWrongCalled = true; });

    assert.strictEqual(status401Wrong, 401, 'Must return 401 when secret does not match');
    assert.strictEqual(nextWrongCalled, false);

    // 2E: Reject request with secret of different length (timingSafeEqual safety without throwing)
    let status401DiffLen = null;
    const reqDiffLen = { headers: { 'x-scheduler-secret': 'short' } };
    const res401DiffLen = {
      status(s) { status401DiffLen = s; return this; },
      json() { return this; },
    };
    let nextDiffLenCalled = false;
    requireSchedulerSecret(reqDiffLen, res401DiffLen, () => { nextDiffLenCalled = true; });

    assert.strictEqual(status401DiffLen, 401, 'Must return 401 for different length secret');
    assert.strictEqual(nextDiffLenCalled, false);

    // 2F: Accept request with exact matching secret
    let nextValidCalled = false;
    const reqValid = { headers: { 'x-scheduler-secret': testSecret } };
    const resValid = {
      status() { throw new Error('status() should not be called on valid secret'); },
      json() { throw new Error('json() should not be called on valid secret'); },
    };
    requireSchedulerSecret(reqValid, resValid, () => { nextValidCalled = true; });

    assert.strictEqual(nextValidCalled, true, 'Next must be called when valid X-Scheduler-Secret is provided');

    // 2G: Route Layer Registration & Handler Invariants
    const routeLayer = notificationsRouter.stack.find(
      (s) => s.route && s.route.path === '/reminders/run'
    );
    assert(routeLayer, 'notificationsRouter must register /reminders/run route');
    assert.strictEqual(routeLayer.route.methods.post, true, '/reminders/run route must accept POST method');
    assert.strictEqual(
      routeLayer.route.stack[0].handle,
      requireSchedulerSecret,
      'First route middleware must be requireSchedulerSecret'
    );

    const runHandler = routeLayer.route.stack[1].handle;
    assert.strictEqual(typeof runHandler, 'function', 'Route handler must be a function');

    // Test handler dispatch with active job lock (safely verifies response mapping without DB calls)
    const debtReminderServiceForHandler = require('./backend/services/debtReminderService');
    const origSendReminders = debtReminderServiceForHandler.sendDebtReminders;
    debtReminderServiceForHandler.__setIsJobRunning(true);

    try {
      // 2H: Handler returns 200 with result when body provides thresholdDays
      let statusWithBody = 200;
      let jsonWithBody = null;
      await runHandler(
        { body: { thresholdDays: 45 } },
        {
          status(s) { statusWithBody = s; return this; },
          json(j) { jsonWithBody = j; return this; },
        }
      );
      assert.strictEqual(statusWithBody, 200, 'Handler must return HTTP 200 on success');
      assert.strictEqual(jsonWithBody.skipped, true, 'Handler must return debtReminderService result');
      assert.strictEqual(jsonWithBody.reason, 'Job already in progress');

      // 2I: Handler returns 200 with result when body is empty {}
      let statusEmptyBody = 200;
      let jsonEmptyBody = null;
      await runHandler(
        { body: {} },
        {
          status(s) { statusEmptyBody = s; return this; },
          json(j) { jsonEmptyBody = j; return this; },
        }
      );
      assert.strictEqual(statusEmptyBody, 200, 'Handler must return HTTP 200 with default body');
      assert.strictEqual(jsonEmptyBody.skipped, true);

      // 2J: Handler returns 500 on unexpected service exception
      debtReminderServiceForHandler.sendDebtReminders = async () => {
        throw new Error('Database connection timed out');
      };
      let status500 = 200;
      let json500 = null;
      await runHandler(
        { body: {} },
        {
          status(s) { status500 = s; return this; },
          json(j) { json500 = j; return this; },
        }
      );
      assert.strictEqual(status500, 500, 'Handler must return HTTP 500 on service error');
      assert(json500.message, 'Handler must return error message on failure');
    } finally {
      debtReminderServiceForHandler.sendDebtReminders = origSendReminders;
      debtReminderServiceForHandler.__setIsJobRunning(false);
    }
  } finally {
    if (origSecret !== undefined) {
      process.env.INTERNAL_SCHEDULER_SECRET = origSecret;
    } else {
      delete process.env.INTERNAL_SCHEDULER_SECRET;
    }
  }
  console.log('✅ P0-4: Secure Scheduler Endpoint Middleware verified.');

  // 3. P0-5: Reliable Scheduling & In-Process Concurrency Lock
  console.log('3. Testing P0-5: Reliable Scheduling Architecture & Concurrency Lock...');
  const serverContent = fs.readFileSync(path.join(__dirname, 'backend', 'server.js'), 'utf8');

  // Verify server.js defaults to external scheduler architecture
  assert(serverContent.includes('ENABLE_IN_PROCESS_SCHEDULER'), 'server.js must reference ENABLE_IN_PROCESS_SCHEDULER');
  assert(
    serverContent.includes('ENABLE_IN_PROCESS_SCHEDULER === \'true\''),
    'server.js must require explicit opt-in for in-process setInterval'
  );

  const debtReminderService = require('./backend/services/debtReminderService');
  assert(typeof debtReminderService.sendDebtReminders === 'function', 'sendDebtReminders must be exported');
  assert(typeof debtReminderService.__setIsJobRunning === 'function', '__setIsJobRunning test hook must be exported');

  // Test overlapping run lockout
  debtReminderService.__setIsJobRunning(true);
  const overlappingResult = await debtReminderService.sendDebtReminders();
  assert.strictEqual(overlappingResult.skipped, true, 'Job must skip when already running');
  assert.strictEqual(overlappingResult.reason, 'Job already in progress');

  debtReminderService.__setIsJobRunning(false);
  console.log('✅ P0-5: Reliable Scheduling Architecture & Concurrency Lock verified.');

  // 4. Functional Simulation: Debt Age Determination & Threshold Logic
  console.log('4. Testing Debt Age Determination & 30-Day Threshold...');
  const now = new Date('2026-10-23T12:00:00Z');
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function evaluateDebtCandidate({ debtorId, creditorId, groupId, groupName, debtAmount, earliestExpenseDate, asOfDate, thresholdDays = 30 }) {
    if (debtAmount <= 0) return null; // Fully settled

    const ageMs = asOfDate.getTime() - earliestExpenseDate.getTime();
    const ageDays = Math.floor(ageMs / MS_PER_DAY);

    if (ageDays < thresholdDays) {
      return null; // Under threshold
    }

    const cycleIndex = Math.floor(ageDays / thresholdDays);
    const dedupeKey = `debt_reminder:${debtorId}:${creditorId}:${groupId}:${cycleIndex}`;

    return {
      debtorId,
      creditorId,
      groupId,
      groupName,
      amount: debtAmount,
      ageDays,
      cycleIndex,
      dedupeKey,
    };
  }

  // 4A: Debt from 15 days ago -> under threshold, no reminder
  const debt15Days = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: 50.0,
    earliestExpenseDate: new Date(now.getTime() - 15 * MS_PER_DAY),
    asOfDate: now,
  });
  assert.strictEqual(debt15Days, null, '15-day-old debt must not trigger reminder');

  // 4B: Debt from 29 days ago -> under threshold, no reminder
  const debt29Days = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: 50.0,
    earliestExpenseDate: new Date(now.getTime() - 29 * MS_PER_DAY),
    asOfDate: now,
  });
  assert.strictEqual(debt29Days, null, '29-day-old debt must not trigger reminder yet');

  // 4C: Debt from 31 days ago -> qualifies for reminder
  const debt31Days = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: 75.0,
    earliestExpenseDate: new Date(now.getTime() - 31 * MS_PER_DAY),
    asOfDate: now,
  });
  assert(debt31Days !== null, '31-day-old debt must trigger reminder');
  assert.strictEqual(debt31Days.ageDays, 31);
  assert.strictEqual(debt31Days.cycleIndex, 1);
  assert.strictEqual(debt31Days.dedupeKey, 'debt_reminder:userA:userB:group1:1');
  assert.strictEqual(debt31Days.amount, 75.0);

  console.log('✅ Debt Age Determination & 30-Day Threshold verified.');

  // 5. Fully Settled Debts
  console.log('5. Testing Fully Settled Debts...');
  const settledDebt = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: 0.0, // Fully settled balance
    earliestExpenseDate: new Date(now.getTime() - 45 * MS_PER_DAY),
    asOfDate: now,
  });
  assert.strictEqual(settledDebt, null, 'Fully settled debt (amount 0) must never trigger reminder');
  console.log('✅ Fully Settled Debts verified.');

  // 6. Partial Settlements
  console.log('6. Testing Partial Settlement Calculations...');
  const remainingDebtAmount = 40.0;
  const partialDebt = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: remainingDebtAmount,
    earliestExpenseDate: new Date(now.getTime() - 35 * MS_PER_DAY),
    asOfDate: now,
  });
  assert(partialDebt !== null, 'Partially settled debt with positive remaining balance must trigger reminder');
  assert.strictEqual(partialDebt.amount, 40.0, 'Reminder must reflect remaining balance of ₹40.00');
  assert.strictEqual(partialDebt.ageDays, 35);
  console.log('✅ Partial Settlement Calculations verified.');

  // 7. Durable Deduplication & Concurrency Simulation
  console.log('7. Testing Deduplication Across Repeated Runs...');
  class MockNotificationDB {
    constructor() {
      this.notifications = [];
    }

    async findOne({ recipient, dedupeKey }) {
      return this.notifications.find((n) => n.recipient === recipient && n.dedupeKey === dedupeKey) || null;
    }

    async create(data) {
      if (data.dedupeKey) {
        const exists = await this.findOne({ recipient: data.recipient, dedupeKey: data.dedupeKey });
        if (exists) {
          const err = new Error('E11000 duplicate key error collection: unique_recipient_dedupe_key');
          err.code = 11000;
          throw err;
        }
      }
      const record = { _id: 'notif_' + Math.random().toString(36).slice(2), ...data, createdAt: new Date() };
      this.notifications.push(record);
      return record;
    }
  }

  const db = new MockNotificationDB();

  // Run 1: Day 31 -> notification created
  const candidate = debt31Days;
  const existing1 = await db.findOne({ recipient: candidate.debtorId, dedupeKey: candidate.dedupeKey });
  assert.strictEqual(existing1, null);

  const notif1 = await db.create({
    recipient: candidate.debtorId,
    sender: candidate.creditorId,
    type: 'debt_reminder',
    title: `Friendly reminder: unsettled balance in ${candidate.groupName}`,
    body: `You have an unsettled balance of ₹${candidate.amount.toFixed(2)}`,
    data: { groupId: candidate.groupId, type: 'debt_reminder', amount: candidate.amount },
    dedupeKey: candidate.dedupeKey,
  });

  assert(notif1._id, 'Notification 1 must be created');
  assert.strictEqual(db.notifications.length, 1);

  // Run 2: Next hour (Day 32) -> dedupeKey is identical, DB check skips
  const candidateDay32 = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: 75.0,
    earliestExpenseDate: new Date(now.getTime() - 32 * MS_PER_DAY),
    asOfDate: now,
  });
  assert.strictEqual(candidateDay32.dedupeKey, candidate.dedupeKey);

  // Race condition simulation: two simultaneous calls attempt insertion
  let raceErrorCaught = false;
  try {
    await db.create({
      recipient: candidateDay32.debtorId,
      dedupeKey: candidateDay32.dedupeKey,
    });
  } catch (err) {
    if (err.code === 11000) {
      raceErrorCaught = true;
    }
  }
  assert.strictEqual(raceErrorCaught, true, 'Simultaneous duplicate insertion must trigger E11000');
  assert.strictEqual(db.notifications.length, 1, 'Collection must maintain strictly 1 notification');

  // Run 3: Day 62 (second 30-day cycle) -> cycleIndex advances to 2, allows next reminder
  const candidateDay62 = evaluateDebtCandidate({
    debtorId: 'userA',
    creditorId: 'userB',
    groupId: 'group1',
    groupName: 'Roommates',
    debtAmount: 75.0,
    earliestExpenseDate: new Date(now.getTime() - 62 * MS_PER_DAY),
    asOfDate: now,
  });
  assert.strictEqual(candidateDay62.cycleIndex, 2);
  assert.strictEqual(candidateDay62.dedupeKey, 'debt_reminder:userA:userB:group1:2');

  const notif2 = await db.create({
    recipient: candidateDay62.debtorId,
    sender: candidateDay62.creditorId,
    type: 'debt_reminder',
    title: `Friendly reminder: unsettled balance in ${candidateDay62.groupName}`,
    body: `You have an unsettled balance of ₹${candidateDay62.amount.toFixed(2)}`,
    data: { groupId: candidateDay62.groupId, type: 'debt_reminder', amount: candidateDay62.amount },
    dedupeKey: candidateDay62.dedupeKey,
  });
  assert(notif2._id, 'Cycle 2 notification must be allowed');
  assert.strictEqual(db.notifications.length, 2);

  console.log('✅ Deduplication & Multi-Cycle Simulation verified.');

  // 8. Mobile & Web Client Contract Invariants for Debt Reminders
  console.log('8. Testing Mobile & Web Client Contract Invariants for Debt Reminders...');

  // 8A: Mobile API types must include 'debt_reminder'
  const mobileTypesPath = path.join(__dirname, 'mobile', 'src', 'types', 'api.ts');
  const mobileTypesSource = fs.readFileSync(mobileTypesPath, 'utf8');
  assert(
    mobileTypesSource.includes("| 'debt_reminder'"),
    'mobile/src/types/api.ts NotificationType must include debt_reminder'
  );

  // 8B: Mobile NotificationInboxModal must map 'debt_reminder' to reminder icon
  const mobileInboxPath = path.join(__dirname, 'mobile', 'src', 'components', 'NotificationInboxModal.tsx');
  const mobileInboxSource = fs.readFileSync(mobileInboxPath, 'utf8');
  assert(
    mobileInboxSource.includes("case 'debt_reminder':") &&
    mobileInboxSource.includes("return '⏰';"),
    'NotificationInboxModal.tsx must map debt_reminder to alarm icon ⏰'
  );

  // 8C: Web service-worker must route debt_reminder with groupId to /group.html?id=...
  const swPath = path.join(__dirname, 'frontend', 'service-worker.js');
  const swSource = fs.readFileSync(swPath, 'utf8');
  assert(
    swSource.includes('payload.data.type === "debt_reminder"'),
    'frontend/service-worker.js must route debt_reminder with groupId to /group.html?id=...'
  );

  // 8D: Web firebase.js must route debt_reminder with groupId to /group.html?id=...
  const fbPath = path.join(__dirname, 'frontend', 'js', 'firebase.js');
  const fbSource = fs.readFileSync(fbPath, 'utf8');
  assert(
    fbSource.includes('payload.data.type === "debt_reminder"'),
    'frontend/js/firebase.js must route debt_reminder with groupId to /group.html?id=...'
  );

  // 8E: Functional routing simulation
  function resolveNotificationUrl(payload) {
    let url = "/dashboard.html";
    if (payload.data?.groupId) {
      if (payload.data.type === "payment_claim" && payload.data.paymentId) {
        url = "/group.html?id=" + payload.data.groupId + "&claimIntentId=" + payload.data.paymentId;
      } else if (
        payload.data.type === "payment_confirmed" ||
        payload.data.type === "payment_rejected" ||
        payload.data.type === "debt_reminder"
      ) {
        url = "/group.html?id=" + payload.data.groupId;
      }
    }
    return url;
  }

  const reminderPayload = {
    data: {
      type: 'debt_reminder',
      groupId: 'grp_test_999',
      amount: '45.00',
    },
  };
  const resolvedUrl = resolveNotificationUrl(reminderPayload);
  assert.strictEqual(
    resolvedUrl,
    '/group.html?id=grp_test_999',
    'debt_reminder notification with groupId must resolve to group URL'
  );

  const fallbackPayload = {
    data: {
      type: 'debt_reminder',
      // no groupId
    },
  };
  assert.strictEqual(
    resolveNotificationUrl(fallbackPayload),
    '/dashboard.html',
    'Notification without groupId must fall back to /dashboard.html'
  );

  // 8F: Mobile Push Notification response handling (NotificationPushHandler.tsx uses getNotificationTargetRoute)
  const mobilePushHandlerPath = path.join(__dirname, 'mobile', 'src', 'components', 'NotificationPushHandler.tsx');
  const mobilePushHandlerSource = fs.readFileSync(mobilePushHandlerPath, 'utf8');
  assert(
    mobilePushHandlerSource.includes("import { getNotificationTargetRoute } from '../utils/notificationRouting';"),
    'NotificationPushHandler.tsx must import getNotificationTargetRoute helper'
  );
  assert(
    mobilePushHandlerSource.includes('const targetRoute = getNotificationTargetRoute(data);') &&
    mobilePushHandlerSource.includes('router.push(targetRoute as any);'),
    'NotificationPushHandler.tsx must resolve targetRoute via getNotificationTargetRoute and navigate'
  );

  // 8G: Exercise production notification routing helper directly (getNotificationTargetRoute)
  const { getNotificationTargetRoute } = require(path.join(__dirname, 'mobile', 'src', 'utils', 'notificationRouting.ts'));

  const mobileReminderResponse = {
    notification: {
      request: {
        content: {
          data: {
            groupId: 'grp_reminder_mobile_456',
            type: 'debt_reminder',
            amount: 75,
          },
        },
      },
    },
  };
  assert.strictEqual(
    getNotificationTargetRoute(mobileReminderResponse),
    '/group/grp_reminder_mobile_456',
    'getNotificationTargetRoute must navigate to /group/:groupId when given NotificationResponse'
  );
  assert.strictEqual(
    getNotificationTargetRoute({ groupId: 'grp_direct_789', type: 'debt_reminder' }),
    '/group/grp_direct_789',
    'getNotificationTargetRoute must navigate to /group/:groupId when given payload data directly'
  );
  assert.strictEqual(
    getNotificationTargetRoute({ notification: { request: { content: { data: {} } } } }),
    null,
    'getNotificationTargetRoute must return null when response lacks groupId'
  );
  assert.strictEqual(
    getNotificationTargetRoute({ groupId: '   ' }),
    null,
    'getNotificationTargetRoute must return null when groupId is empty whitespace'
  );
  assert.strictEqual(
    getNotificationTargetRoute(null),
    null,
    'getNotificationTargetRoute must return null when input is null'
  );

  console.log('✅ Mobile & Web Client Contract Invariants verified.');

  // 9. Debt Reminder Service Payload & Recipient Runtime Execution Test
  console.log('9. Testing Debt Reminder Service Payload & Recipient Runtime Execution...');

  const mongoose = require('mongoose');
  const Group = require('./backend/models/Group');
  const Notification = require('./backend/models/Notification');
  const helpers = require('./backend/utils/helpers');
  const notificationService = require('./backend/services/notificationService');

  // Preserve original methods for safe restoration
  const origGroupFind = Group.find;
  const origNotificationFindOne = Notification.findOne;
  const origGetGroupLedger = helpers.getGroupLedger;
  const origCreateNotification = notificationService.createNotification;

  const capturedNotifications = [];
  const testAsOfDate = new Date('2026-03-15T12:00:00.000Z');
  const expenseDate = new Date(testAsOfDate.getTime() - 35 * 24 * 60 * 60 * 1000); // 35 days old

  // Realistic, deterministic 24-character hexadecimal Mongoose ObjectIds
  const stubGroupId = new mongoose.Types.ObjectId('660000000000000000000001');
  const debtorUserId = new mongoose.Types.ObjectId('660000000000000000000002');
  const creditorUserId = new mongoose.Types.ObjectId('660000000000000000000003');

  const stubGroup = {
    _id: stubGroupId,
    name: 'Weekend Trip',
    members: [
      { user: { _id: debtorUserId, name: 'Debtor Alice' } },
      { user: { _id: creditorUserId, name: 'Creditor Bob' } },
    ],
  };

  const stubLedger = {
    settlements: [
      {
        from: { id: debtorUserId.toString(), userId: debtorUserId.toString(), name: 'Debtor Alice' },
        to: { id: creditorUserId.toString(), userId: creditorUserId.toString(), name: 'Creditor Bob' },
        amount: 125.50,
      },
    ],
    expenses: [
      {
        createdAt: expenseDate,
        paidBy: { _id: creditorUserId, name: 'Creditor Bob' },
        splits: [
          { user: { _id: debtorUserId }, share: 125.50 },
          { user: { _id: creditorUserId }, share: 125.50 },
        ],
      },
    ],
  };

  try {
    // Stub Group.find().select()
    Group.find = () => ({
      select: async () => [stubGroup],
    });

    // Stub helpers.getGroupLedger
    helpers.getGroupLedger = async (groupId) => {
      assert.strictEqual(groupId.toString(), stubGroupId.toString(), 'getGroupLedger called with correct group ID');
      return stubLedger;
    };

    // Stub Notification.findOne for deduplication check (initially returns null -> eligible)
    let simulateExistingNotification = false;
    Notification.findOne = async (query) => {
      assert.strictEqual(query.recipient, debtorUserId.toString());
      assert.strictEqual(query.dedupeKey, `debt_reminder:${debtorUserId}:${creditorUserId}:${stubGroupId}:1`);
      return simulateExistingNotification ? { _id: new mongoose.Types.ObjectId('660000000000000000000004') } : null;
    };

    // Stub notificationService.createNotification to intercept generated payload
    notificationService.createNotification = async (payload) => {
      capturedNotifications.push(payload);
      return { _id: new mongoose.Types.ObjectId('660000000000000000000005'), created: true };
    };

    // Ensure job lock is clear before running
    debtReminderService.__setIsJobRunning(false);

    // Run the actual debt reminder service path
    const results = await debtReminderService.sendDebtReminders({
      thresholdDays: 30,
      asOfDate: testAsOfDate,
    });

    // Assert service return metrics
    assert.strictEqual(results.found, 1, 'Should find 1 eligible debt candidate');
    assert.strictEqual(results.sent, 1, 'Should send 1 notification');
    assert.strictEqual(results.alreadySent, 0, 'No notifications should be skipped yet');
    assert.strictEqual(results.failed, 0, 'No notification failures');
    assert.strictEqual(capturedNotifications.length, 1, 'Exactly one notification payload generated');

    // Assert exact generated notification payload and recipient invariants
    const notif = capturedNotifications[0];
    assert.strictEqual(notif.recipient, debtorUserId.toString(), 'Notification recipient must be the debtor user ID');
    assert.strictEqual(notif.sender, creditorUserId.toString(), 'Notification sender must be the creditor user ID');
    assert.strictEqual(notif.type, 'debt_reminder', 'Notification type must be debt_reminder');
    assert.strictEqual(
      notif.title,
      'Friendly reminder: unsettled balance in Weekend Trip',
      'Notification title must match friendly reminder template'
    );
    assert.strictEqual(
      notif.body,
      'You have an unsettled balance of ₹125.50 with Creditor Bob in Weekend Trip from 35 days ago.',
      'Notification body must correctly reflect formatted amount, creditor name, group name, and debt age'
    );
    assert.deepStrictEqual(
      notif.data,
      {
        groupId: stubGroupId.toString(),
        type: 'debt_reminder',
        amount: 125.50,
      },
      'Notification data payload must include groupId string, type debt_reminder, and numeric amount'
    );
    assert.strictEqual(
      notif.dedupeKey,
      `debt_reminder:${debtorUserId}:${creditorUserId}:${stubGroupId}:1`,
      'Notification must include durable dedupeKey for cycle 1'
    );
    assert.strictEqual(notif.sendPush, true, 'Notification must have sendPush enabled');

    // Runtime test second run when alreadySent/deduped in database:
    simulateExistingNotification = true;
    const dedupedResults = await debtReminderService.sendDebtReminders({
      thresholdDays: 30,
      asOfDate: testAsOfDate,
    });
    assert.strictEqual(dedupedResults.found, 1, 'Still finds 1 candidate');
    assert.strictEqual(dedupedResults.sent, 0, 'Does not re-send already notified debt');
    assert.strictEqual(dedupedResults.alreadySent, 1, 'Correctly increments alreadySent counter');
    assert.strictEqual(capturedNotifications.length, 1, 'createNotification was not called again');

    console.log('✅ Debt Reminder Service Payload & Recipient Runtime Execution verified.');
  } finally {
    // Restore all original stubs unconditionally
    Group.find = origGroupFind;
    Notification.findOne = origNotificationFindOne;
    helpers.getGroupLedger = origGetGroupLedger;
    notificationService.createNotification = origCreateNotification;
    debtReminderService.__setIsJobRunning(false);
  }

  console.log('\n🎉 All Stage 4: 30-Day Debt Reminder Tests Passed Successfully!');
}

runAllTests().catch((err) => {
  console.error('❌ Stage 4 Test Failure:', err);
  process.exit(1);
});
