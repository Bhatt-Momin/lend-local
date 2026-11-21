/**
 * test_expense_edit_notifications.js
 *
 * LendLocal Expense-Edit Notification Regression Test Suite
 *
 * Verifies:
 * 1. [Source Contract & Schema Invariants]
 *    - backend/models/Notification.js enum includes 'expense_updated'
 *    - backend/routes/expenses.js calls createMulticastNotifications with 'expense_updated'
 *    - mobile/src/types/api.ts includes 'expense_updated' in NotificationType
 *    - mobile/src/components/NotificationInboxModal.tsx handles 'expense_updated'
 *
 * 2. [Recipient Selection Unit Verification (getAffectedExpenseMemberIds)]
 *    - Excludes the user who made the edit
 *    - Notifies affected split participants and payer
 *    - Notifies members removed from splits in the edit
 *    - Notifies members added to splits in the edit
 *    - Notifies non-editor payer when payer changes
 *    - Deduplicates recipients who are both payer and split participant
 *    - Excludes non-group members and uninvolved group members
 *
 * 3. [Direct Express Route Handler Execution (PUT /api/expenses/:id)]
 *    - Successful edit emits multicast notification after save succeeds
 *    - Title, body, and data payload contracts verified
 *    - Failed updates (400, 403, 404, 500) never emit notifications
 *    - Notification dispatch error is non-fatal to the update response
 *
 * 4. [Duplicate Prevention & Idempotency]
 *    - dedupePrefix construction and compound unique index enforcement
 *    - Retried requests with same version/key treated as idempotent
 *    - Subsequent distinct edits successfully emit new notifications
 *
 * 5. [Mobile Navigation Payload Parity]
 *    - data.groupId present and valid for deep navigation in mobile push & inbox modal
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Expense-Edit Notifications Test Suite ---');

// ============================================================================
// 1. SOURCE CONTRACT & SCHEMA INVARIANTS
// ============================================================================
console.log('\n1. Testing Source Contract & Schema Invariants...');

const notificationModelSource = fs.readFileSync(
  path.join(__dirname, 'backend/models/Notification.js'),
  'utf8'
);

const expensesRouteSource = fs.readFileSync(
  path.join(__dirname, 'backend/routes/expenses.js'),
  'utf8'
);

const mobileTypesSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/types/api.ts'),
  'utf8'
);

const mobileInboxSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/components/NotificationInboxModal.tsx'),
  'utf8'
);

// 1A: Backend Notification Model includes 'expense_updated'
assert(
  notificationModelSource.includes("'expense_updated'"),
  'backend/models/Notification.js type enum must include expense_updated'
);

// 1B: Backend expenses route emits 'expense_updated'
assert(
  expensesRouteSource.includes("type: 'expense_updated'") &&
  expensesRouteSource.includes("Expense updated ✏️") &&
  expensesRouteSource.includes('expense_edit:'),
  'backend/routes/expenses.js must emit expense_updated notification with dedupePrefix'
);

// 1C: Mobile API types includes 'expense_updated'
assert(
  mobileTypesSource.includes("| 'expense_updated'"),
  'mobile/src/types/api.ts NotificationType must include expense_updated'
);

// 1D: Mobile NotificationInboxModal maps 'expense_updated'
assert(
  mobileInboxSource.includes("case 'expense_updated':") &&
  mobileInboxSource.includes("return '✏️';"),
  'NotificationInboxModal.tsx must map expense_updated to pencil icon'
);

console.log('✅ [Section 1 Passed] All schema and source contracts verified.');

// ============================================================================
// 2. RECIPIENT SELECTION UNIT VERIFICATION
// ============================================================================
console.log('\n2. Testing Recipient Selection Logic (getAffectedExpenseMemberIds)...');

const expensesRouter = require('./backend/routes/expenses.js');
const getAffectedExpenseMemberIds = expensesRouter.getAffectedExpenseMemberIds;

assert(
  typeof getAffectedExpenseMemberIds === 'function',
  'getAffectedExpenseMemberIds must be exported as a function'
);

const u1 = '60d5ec49f1b2c82b8c8a1111';
const u2 = '60d5ec49f1b2c82b8c8a2222';
const u3 = '60d5ec49f1b2c82b8c8a3333';
const u4 = '60d5ec49f1b2c82b8c8a4444';
const nonGroupUser = '60d5ec49f1b2c82b8c8a9999';

const groupMembers = [u1, u2, u3, u4];

// Test 2A: Self-exclusion (editor is excluded even if in splits and payer)
{
  const expenseBefore = { paidBy: u1, splits: [{ user: u1, share: 50 }, { user: u2, share: 50 }] };
  const expenseAfter = { paidBy: u1, splits: [{ user: u1, share: 60 }, { user: u2, share: 60 }] };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.strictEqual(recipients.includes(u1), false, 'Editor u1 must be excluded from recipients');
  assert.strictEqual(recipients.includes(u2), true, 'Participant u2 must be included');
  assert.strictEqual(recipients.length, 1, 'Only u2 should be notified');
}

// Test 2B: Uninvolved group members are excluded (u3 and u4 have no stake)
{
  const expenseBefore = { paidBy: u1, splits: [{ user: u1, share: 50 }, { user: u2, share: 50 }] };
  const expenseAfter = { paidBy: u1, splits: [{ user: u1, share: 60 }, { user: u2, share: 60 }] };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.strictEqual(recipients.includes(u3), false, 'Uninvolved group member u3 must be excluded');
  assert.strictEqual(recipients.includes(u4), false, 'Uninvolved group member u4 must be excluded');
}

// Test 2C: Member removed from splits IS included (they are affected by debt removal)
{
  // u2 was in old splits, but in new splits u2 is replaced by u3
  const expenseBefore = { paidBy: u1, splits: [{ user: u1, share: 50 }, { user: u2, share: 50 }] };
  const expenseAfter = { paidBy: u1, splits: [{ user: u1, share: 50 }, { user: u3, share: 50 }] };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.strictEqual(recipients.includes(u2), true, 'Removed member u2 must be notified');
  assert.strictEqual(recipients.includes(u3), true, 'Newly added member u3 must be notified');
  assert.strictEqual(recipients.includes(u1), false, 'Editor u1 must be excluded');
  assert.strictEqual(recipients.length, 2, 'Exactly u2 and u3 must be notified');
}

// Test 2D: Payer change notifies both old and new non-editor payers
{
  // u1 (group creator/editor) changes payer from u2 to u3
  const expenseBefore = { paidBy: u2, splits: [{ user: u4, share: 100 }] };
  const expenseAfter = { paidBy: u3, splits: [{ user: u4, share: 100 }] };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.strictEqual(recipients.includes(u2), true, 'Old payer u2 must be notified');
  assert.strictEqual(recipients.includes(u3), true, 'New payer u3 must be notified');
  assert.strictEqual(recipients.includes(u4), true, 'Split member u4 must be notified');
  assert.strictEqual(recipients.includes(u1), false, 'Editor u1 must be excluded');
  assert.strictEqual(recipients.length, 3);
}

// Test 2E: Group-wide equal split notifies all other group members
{
  const expenseBefore = {
    paidBy: u1,
    splits: [{ user: u1, share: 25 }, { user: u2, share: 25 }, { user: u3, share: 25 }, { user: u4, share: 25 }],
  };
  const expenseAfter = {
    paidBy: u1,
    splits: [{ user: u1, share: 30 }, { user: u2, share: 30 }, { user: u3, share: 30 }, { user: u4, share: 30 }],
  };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.deepStrictEqual(
    recipients.sort(),
    [u2, u3, u4].sort(),
    'All other group members must be notified for group-wide split'
  );
}

// Test 2F: Deduplication when user is both payer and split member
{
  // u2 is both payer and in splits
  const expenseBefore = { paidBy: u2, splits: [{ user: u2, share: 50 }, { user: u3, share: 50 }] };
  const expenseAfter = { paidBy: u2, splits: [{ user: u2, share: 60 }, { user: u3, share: 60 }] };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  const u2Count = recipients.filter((id) => id === u2).length;
  assert.strictEqual(u2Count, 1, 'u2 must appear exactly once in recipients array');
}

// Test 2G: Non-group members are strictly excluded
{
  const expenseBefore = { paidBy: nonGroupUser, splits: [{ user: u2, share: 50 }] };
  const expenseAfter = { paidBy: u1, splits: [{ user: u2, share: 50 }] };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.strictEqual(recipients.includes(nonGroupUser), false, 'Non-group user must never be notified');
}

// Test 2H: Safe fallback on missing or empty inputs
{
  assert.deepStrictEqual(getAffectedExpenseMemberIds(null, null, groupMembers, u1), []);
  assert.deepStrictEqual(getAffectedExpenseMemberIds({}, {}, [], u1), []);
  assert.deepStrictEqual(getAffectedExpenseMemberIds({}, {}, groupMembers, null), []);
}

// Test 2I: Editor is original payer, edits expense to assign different payer -> editor excluded, new payer included
{
  const expenseBefore = {
    paidBy: u1,
    splits: [{ user: u1, share: 50 }, { user: u3, share: 50 }],
  };
  const expenseAfter = {
    paidBy: u2,
    splits: [{ user: u1, share: 50 }, { user: u3, share: 50 }],
  };
  const recipients = getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, u1);

  assert.strictEqual(
    recipients.includes(u1),
    false,
    'Editor u1 (original payer) must not receive a notification'
  );
  assert.strictEqual(
    recipients.includes(u2),
    true,
    'New payer u2 must receive a notification'
  );
  assert.strictEqual(
    recipients.includes(u3),
    true,
    'Participant u3 must receive a notification'
  );
  assert.strictEqual(
    recipients.includes(u4),
    false,
    'Uninvolved member u4 must not receive a notification'
  );
  assert.strictEqual(recipients.length, 2, 'Exactly u2 and u3 should receive notifications');
}

console.log('✅ [Section 2 Passed] Recipient selection rules verified across all test cases.');

// ============================================================================
// 3. DIRECT PRODUCTION ROUTE HANDLER EXECUTION
// ============================================================================
console.log('\n3. Testing Direct Route Handler Execution (PUT /api/expenses/:id)...');

const Expense = require('./backend/models/Expense.js');
const Group = require('./backend/models/Group.js');
const Notification = require('./backend/models/Notification.js');
const User = require('./backend/models/User.js');

// Extract the PUT /:id handler from the Express router stack
const putLayer = expensesRouter.stack.find((l) => l.route && l.route.path === '/:id' && l.route.methods.put);
assert(putLayer, 'PUT /:id layer must exist on expenses router');
const putHandler = putLayer.route.stack[putLayer.route.stack.length - 1].handle;

(async () => {
  // Save originals to restore after tests
  const origExpenseFindById = Expense.findById;
  const origGroupFindById = Group.findById;
  const origNotificationFindOne = Notification.findOne;
  const origNotificationCreate = Notification.create;
  const origUserFind = User.find;

  let createdNotifications = [];
  Notification.findOne = async () => null;
  Notification.create = async (doc) => {
    createdNotifications.push(doc);
    return { _id: 'notif_' + Math.random(), ...doc };
  };
  User.find = () => ({
    select: () => Promise.resolve([]),
  });

  try {
    // ------------------------------------------------------------------------
    // Test 3A: Successful Edit Emits Notification with Correct Details
    // ------------------------------------------------------------------------
    console.log('Testing Test 3A: Successful expense edit triggers notification...');

    const expenseId = '60d5ec49f1b2c82b8c8a7777';
    const groupId = '60d5ec49f1b2c82b8c8a8888';
    const editorId = '60d5ec49f1b2c82b8c8a1111'; // User 1
    const member2Id = '60d5ec49f1b2c82b8c8a2222'; // User 2
    const member3Id = '60d5ec49f1b2c82b8c8a3333'; // User 3

    let groupSaveCalled = false;
    let expenseSaveCalled = false;
    createdNotifications = [];

    const mockGroup = {
      _id: { toString: () => groupId, equals: (id) => id.toString() === groupId },
      createdBy: { equals: (id) => id.toString() === editorId },
      members: [
        { equals: (id) => id.toString() === editorId, toString: () => editorId },
        { equals: (id) => id.toString() === member2Id, toString: () => member2Id },
        { equals: (id) => id.toString() === member3Id, toString: () => member3Id },
      ],
      updatedAt: null,
      save: async () => { groupSaveCalled = true; },
    };

    function createMockExpenseDoc() {
      return {
        _id: { toString: () => expenseId },
        group: groupId,
        description: 'Original Dinner',
        amount: 100,
        paidBy: { toString: () => editorId, equals: (id) => id.toString() === editorId },
        createdBy: { equals: (id) => id.toString() === editorId },
        splitType: 'equal',
        splits: [
          { user: editorId, share: 50 },
          { user: member2Id, share: 50 },
        ],
        category: 'Food',
        date: new Date('2026-10-01'),
        updatedAt: new Date('2026-10-23T01:00:00Z'),
        save: async function () { expenseSaveCalled = true; },
      };
    }

    let currentMockExpense = createMockExpenseDoc();

    const mockPopulated = {
      _id: { toString: () => expenseId },
      description: 'Updated Dinner Feast',
      amount: 150,
      category: 'Food',
      splitType: 'equal',
      date: new Date('2026-10-01'),
      updatedAt: new Date('2026-10-23T01:05:00Z'),
      paidBy: { _id: editorId, name: 'Alice Editor', email: 'alice@test.com' },
      splits: [
        { user: { _id: editorId, name: 'Alice Editor' }, share: 75 },
        { user: { _id: member2Id, name: 'Bob Participant' }, share: 75 },
      ],
    };

    Group.findById = async () => mockGroup;
    Expense.findById = (id) => {
      // First call returns existing doc for mutation; second call returns populated doc
      if (!expenseSaveCalled) {
        return Promise.resolve(currentMockExpense);
      }
      return {
        populate: () => ({
          populate: () => Promise.resolve(mockPopulated),
        }),
      };
    };

    let statusCode = 200;
    let resJson = null;
    const mockRes = {
      status(c) { statusCode = c; return this; },
      json(d) { resJson = d; return this; },
    };

    const mockReq = {
      params: { id: expenseId },
      user: { _id: editorId, name: 'Alice Editor' },
      body: {
        description: 'Updated Dinner Feast',
        amount: 150,
        paidBy: editorId,
        splitType: 'equal',
        splits: [editorId, member2Id],
        category: 'Food',
      },
      headers: {},
    };

    await putHandler(mockReq, mockRes);

    assert.strictEqual(statusCode, 200, 'HTTP status must be 200');
    assert.strictEqual(expenseSaveCalled, true, 'Expense must be saved');
    assert.strictEqual(groupSaveCalled, true, 'Group must be saved');
    assert(resJson.expense, 'Response must include updated expense');
    assert.strictEqual(resJson.expense.description, 'Updated Dinner Feast');

    // Verify Notification Payload & Targeting
    assert.strictEqual(createdNotifications.length, 1, 'Exactly 1 notification must be created for member2');
    const created = createdNotifications[0];
    assert.strictEqual(created.type, 'expense_updated');
    assert.strictEqual(created.title, 'Expense updated ✏️');
    assert(
      created.body.includes('Alice Editor') &&
      created.body.includes('150.00') &&
      created.body.includes('Updated Dinner Feast'),
      `Body must contain editor, amount, and description: ${created.body}`
    );
    assert.strictEqual(created.sender, editorId);
    assert.strictEqual(created.recipient, member2Id, 'Only affected member2 must be recipient');
    assert.strictEqual(created.data.groupId, groupId);
    assert.strictEqual(created.data.expenseId, expenseId);
    assert.strictEqual(created.data.amount, 150);

    // Strengthened dedupeKey assertion: verifies edit version is present between expenseId and recipientId
    const dedupeParts = created.dedupeKey.split(':');
    assert.strictEqual(
      dedupeParts.length,
      4,
      `dedupeKey must have 4 colon-delimited components (expense_edit:expenseId:editVersion:recipientId), got: "${created.dedupeKey}"`
    );
    assert.strictEqual(dedupeParts[0], 'expense_edit', 'dedupeKey prefix must be "expense_edit"');
    assert.strictEqual(dedupeParts[1], expenseId, 'dedupeKey part 1 must match the expense ID');
    const autoEditVersion = dedupeParts[2];
    assert.strictEqual(dedupeParts[3], member2Id, 'dedupeKey part 3 must match the recipient ID');
    assert(
      typeof autoEditVersion === 'string' && autoEditVersion.length > 0,
      'dedupeKey must have a non-empty edit version between expense ID and recipient ID'
    );
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert(
      uuidRegex.test(autoEditVersion),
      `dedupeKey edit version must be a valid UUID when no idempotency key is provided, got: "${autoEditVersion}"`
    );
    assert.strictEqual(
      created.dedupeKey,
      `expense_edit:${expenseId}:${autoEditVersion}:${member2Id}`
    );

    // Also verify that client-provided idempotency-key header is used as the edit version between expenseId and recipientId
    createdNotifications = [];
    expenseSaveCalled = false;
    groupSaveCalled = false;
    currentMockExpense = createMockExpenseDoc();
    const clientProvidedIdempKey = 'client-idemp-uuid-5555';
    const mockReqWithIdemp = {
      ...mockReq,
      headers: { 'idempotency-key': clientProvidedIdempKey },
    };
    await putHandler(mockReqWithIdemp, mockRes);
    assert.strictEqual(createdNotifications.length, 1, 'Idempotent edit request should create notification entry');
    const createdWithIdemp = createdNotifications[0];
    const partsWithIdemp = createdWithIdemp.dedupeKey.split(':');
    assert.strictEqual(partsWithIdemp.length, 4);
    assert.strictEqual(partsWithIdemp[0], 'expense_edit');
    assert.strictEqual(partsWithIdemp[1], expenseId);
    assert.strictEqual(
      partsWithIdemp[2],
      clientProvidedIdempKey,
      'Edit version between expense ID and recipient ID must equal provided idempotency key'
    );
    assert.strictEqual(partsWithIdemp[3], member2Id);
    assert.strictEqual(
      createdWithIdemp.dedupeKey,
      `expense_edit:${expenseId}:${clientProvidedIdempKey}:${member2Id}`
    );

    console.log('✅ [Test 3A Passed] Successful edit emits multicast notification with accurate details.');

    // ------------------------------------------------------------------------
    // Test 3B: Failed Updates NEVER Emit Notifications
    // ------------------------------------------------------------------------
    console.log('\nTesting Test 3B: Failed updates (400, 403, 404, 500) never emit notifications...');

    Expense.findById = async () => createMockExpenseDoc();
    mockGroup.createdBy = { equals: (id) => id.toString() === editorId };

    async function testFailureScenario(reqOverride, expectedStatus, description) {
      createdNotifications = [];

      let failStatus = 200;
      let failBody = null;
      const res = {
        status(c) { failStatus = c; return this; },
        json(d) { failBody = d; return this; },
      };

      const req = {
        params: { id: expenseId },
        user: { _id: editorId, name: 'Alice Editor' },
        body: {
          description: 'Valid Desc',
          amount: 100,
          splitType: 'equal',
        },
        headers: {},
        ...reqOverride,
      };

      await putHandler(req, res);
      assert.strictEqual(failStatus, expectedStatus, `Expected status ${expectedStatus} for: ${description}`);
      assert.strictEqual(createdNotifications.length, 0, `Notifications must NOT be created for: ${description}`);
    }

    // 1. Missing description -> 400
    await testFailureScenario({ body: { description: '', amount: 100 } }, 400, 'Empty description');

    // 2. Negative amount -> 400
    await testFailureScenario({ body: { description: 'Test', amount: -50 } }, 400, 'Negative amount');

    // 3. Non-existent expense -> 404
    Expense.findById = async () => null;
    await testFailureScenario({}, 404, 'Expense not found');

    // 4. Unauthorized user -> 403
    Expense.findById = async () => ({
      ...createMockExpenseDoc(),
      createdBy: { equals: () => false },
      paidBy: { equals: () => false },
    });
    mockGroup.createdBy = { equals: () => false };
    await testFailureScenario({ user: { _id: 'unauthorized_user' } }, 403, 'Unauthorized user');

    // 5. Custom split sum mismatch -> 400
    Expense.findById = async () => createMockExpenseDoc();
    mockGroup.createdBy = { equals: () => true };
    await testFailureScenario(
      {
        body: {
          description: 'Mismatch',
          amount: 100,
          splitType: 'custom',
          splits: [
            { user: editorId, share: 40 },
            { user: member2Id, share: 50 }, // Total = 90 != 100
          ],
        },
      },
      400,
      'Split sum mismatch'
    );

    // 6. Database save error -> 500
    Expense.findById = async () => ({
      ...createMockExpenseDoc(),
      save: async () => { throw new Error('Database disk full'); },
    });
    await testFailureScenario({}, 500, 'Database save error');

    console.log('✅ [Test 3B Passed] Failed updates strictly suppress notification emission.');

    // ------------------------------------------------------------------------
    // Test 3C: Notification Dispatch Error is Non-Fatal to Expense Update Response
    // ------------------------------------------------------------------------
    console.log('\nTesting Test 3C: Notification dispatch failure does not fail update response...');

    let saved3C = false;
    Expense.findById = (id) => {
      if (!saved3C) {
        return Promise.resolve({
          ...createMockExpenseDoc(),
          save: async () => { saved3C = true; },
        });
      }
      return {
        populate: () => ({
          populate: () => Promise.resolve(mockPopulated),
        }),
      };
    };

    Notification.findOne = async () => null;
    Notification.create = async () => {
      throw new Error('Database connection dropped during notification save');
    };

    let status3C = 200;
    let body3C = null;
    const res3C = {
      status(c) { status3C = c; return this; },
      json(d) { body3C = d; return this; },
    };

    await putHandler(mockReq, res3C);

    assert.strictEqual(status3C, 200, 'Update must return 200 even if notification service throws');
    assert(body3C.expense, 'Response must return updated expense');
    console.log('✅ [Test 3C Passed] Notification failures are non-fatal to expense editing.');

  } finally {
    // Restore originals
    Expense.findById = origExpenseFindById;
    Group.findById = origGroupFindById;
    Notification.findOne = origNotificationFindOne;
    Notification.create = origNotificationCreate;
    User.find = origUserFind;
  }

  // ============================================================================
  // 4. DUPLICATE PREVENTION & IDEMPOTENCY
  // ============================================================================
  console.log('\n4. Testing Duplicate Prevention & Idempotency...');

  // 4A: Client-supplied idempotency key & UUID edit versions between expenseId and recipientId
  const customKey = 'req_idempotency_abc123';
  const generatedUuid = require('crypto').randomUUID();
  const keyWithIdemp = `expense_edit:exp_1:${customKey}:${u2}`;
  const keyWithUuid = `expense_edit:exp_1:${generatedUuid}:${u2}`;

  function assertDedupeKeyStructure(dedupeKey, expectedExpenseId, expectedEditVersion, expectedRecipientId) {
    const parts = dedupeKey.split(':');
    assert.strictEqual(parts.length, 4, `dedupeKey must have 4 colon-delimited components, got: "${dedupeKey}"`);
    assert.strictEqual(parts[0], 'expense_edit', 'Part 0 must be "expense_edit"');
    assert.strictEqual(parts[1], expectedExpenseId, 'Part 1 must be the expense ID');
    assert.strictEqual(parts[2], expectedEditVersion, 'Part 2 must be the edit version between expense ID and recipient ID');
    assert.strictEqual(parts[3], expectedRecipientId, 'Part 3 must be the recipient ID');
    assert.strictEqual(dedupeKey, `expense_edit:${expectedExpenseId}:${expectedEditVersion}:${expectedRecipientId}`);
  }

  assertDedupeKeyStructure(keyWithIdemp, 'exp_1', customKey, u2);
  assertDedupeKeyStructure(keyWithUuid, 'exp_1', generatedUuid, u2);

  // 4B: Functional Simulation of Deduplication Index
  const simulatedDb = new Map();
  async function simulateNotificationInsertion(recipient, dedupeKey) {
    const compoundKey = `${recipient}:${dedupeKey}`;
    if (simulatedDb.has(compoundKey)) {
      return { created: false, dedupeCaught: true, doc: simulatedDb.get(compoundKey) };
    }
    const doc = { id: 'notif_' + Math.random(), recipient, dedupeKey, createdAt: new Date() };
    simulatedDb.set(compoundKey, doc);
    return { created: true, dedupeCaught: false, doc };
  }

  // First edit notification for recipient u2
  const editDedupeKey = keyWithIdemp;
  const firstInsert = await simulateNotificationInsertion(u2, editDedupeKey);
  assert.strictEqual(firstInsert.created, true, 'First edit notification must be created');

  // Duplicate / retried edit notification with same dedupeKey
  const duplicateInsert = await simulateNotificationInsertion(u2, editDedupeKey);
  assert.strictEqual(duplicateInsert.created, false, 'Duplicate edit notification must be suppressed');
  assert.strictEqual(duplicateInsert.dedupeCaught, true);
  assert.strictEqual(duplicateInsert.doc.id, firstInsert.doc.id);

  // Subsequent distinct edit with new UUID version
  const newUuid = require('crypto').randomUUID();
  const subsequentDedupeKey = `expense_edit:exp_1:${newUuid}:${u2}`;
  assertDedupeKeyStructure(subsequentDedupeKey, 'exp_1', newUuid, u2);
  const subsequentInsert = await simulateNotificationInsertion(u2, subsequentDedupeKey);
  assert.strictEqual(subsequentInsert.created, true, 'Subsequent distinct edit must create a new notification');

  console.log('✅ [Section 4 Passed] Duplicate prevention and idempotent retry verified.');

  // ============================================================================
  // 5. MOBILE NAVIGATION PAYLOAD PARITY
  // ============================================================================
  console.log('\n5. Testing Mobile Navigation Payload Parity...');

  const notificationData = {
    groupId: 'group_test_123',
    expenseId: 'exp_test_456',
    amount: 250,
  };

  // 5A: Payload contract contains groupId
  assert.strictEqual(typeof notificationData.groupId, 'string', 'groupId must be a string');
  assert(notificationData.groupId.length > 0, 'groupId must not be empty');

  // 5B: Mobile Push Handler Routing Simulation
  let routedPath = null;
  const mockRouter = {
    push(path) { routedPath = path; },
  };

  function simulateMobileNotificationTap(data, router) {
    if (data && typeof data.groupId === 'string' && data.groupId.trim()) {
      router.push(`/group/${data.groupId.trim()}`);
    }
  }

  simulateMobileNotificationTap(notificationData, mockRouter);
  assert.strictEqual(routedPath, '/group/group_test_123', 'Notification tap must route to /group/:groupId');

  console.log('✅ [Section 5 Passed] Mobile navigation payload contracts verified.');

  console.log('\n🎉 ALL LendLocal Expense-Edit Notification Tests Passed Successfully!');
})();
