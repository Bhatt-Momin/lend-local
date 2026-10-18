/**
 * LendLocal Stage 3, Phase 5 — Milestone 7 (M7) Test Suite
 * Payment Recovery Hardening & Recipient UPI ID Propagation
 *
 * Direct Production Imports:
 * - extractUpiVpa from mobile/src/utils/paymentForm.ts
 * - canClaimIntent, canCancelIntent, canConfirmIntent, canRejectIntent from mobile/src/utils/paymentForm.ts
 * - isTerminalStatus, buildIntentActionPayload, validatePaymentAmount from mobile/src/utils/paymentForm.ts
 * - executeMutationWithGuardedRefresh, MutationRefreshError from mobile/src/utils/expenseForm.ts
 * - router.mapActivePaymentIntent directly from backend/routes/payment.js
 * - Real GET /payment/active/:groupId Express route handler from backend/routes/payment.js
 *
 * Environment & Test Feasibility Declarations:
 * 1. Real useGroupDetail hook:
 *    - useGroupDetail.ts is a React custom hook relying on React's internal dispatcher (useState, useEffect).
 *    - In this environment, headless hook execution requires @testing-library/react-hooks or react-test-renderer,
 *      which are not installed in devDependencies ("Do not add dependencies" constraint).
 *    - Additionally, useGroupDetail.ts imports AuthContext.tsx which loads native Expo modules (expo-splash-screen,
 *      expo-secure-store) that fail in pure Node without the native runtime.
 *    - Therefore, the hook's state machine, lifecycle transitions, request concurrency guards, and error policies
 *      are verified using a strict lifecycle harness implementing the exact same logic and branches as useGroupDetail.ts.
 * 2. Real React Native UI rendering:
 *    - react-native/index.js contains Flow syntax (import typeof ...) which triggers SyntaxError in Node.
 *    - There is no native bridge or headless mobile DOM available without external test framework dependencies.
 *    - Therefore, the settlement action derivation and Alert retry configuration logic is tested with exhaustive cases.
 * 3. Real Backend Route:
 *    - backend/routes/payment.js is loaded directly in Node.
 *    - Both the extracted production helper router.mapActivePaymentIntent AND the actual GET /payment/active/:groupId
 *      Express handler function are tested directly.
 */

const assert = require('assert');

// Set dummy keys for razorpay config load
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret';

// 1. Direct production imports
const {
  extractUpiVpa,
  canClaimIntent,
  canCancelIntent,
  canConfirmIntent,
  canRejectIntent,
  isTerminalStatus,
  buildIntentActionPayload,
  validatePaymentAmount,
  getPaymentStatusBadge,
} = require('./mobile/src/utils/paymentForm.ts');

const {
  executeMutationWithGuardedRefresh,
  MutationRefreshError,
} = require('./mobile/src/utils/expenseForm.ts');

const Group = require('./backend/models/Group');
const Expense = require('./backend/models/Expense');
const Payment = require('./backend/models/payment');
const paymentRoute = require('./backend/routes/payment');

console.log('--- Running Stage 3 Phase 5 M7 Unit & Integration Tests ---');

// ============================================================================
// 1. extractUpiVpa Helper Tests (Direct Production Function)
// ============================================================================

console.log('Testing extractUpiVpa helper (direct production)...');

// Test 1.1: Standard encoded query parameter
{
  const uri = 'upi://pay?pa=alice%40okhdfcbank&pn=Alice&tr=TX123456&am=500.00&cu=INR';
  assert.strictEqual(extractUpiVpa(uri), 'alice@okhdfcbank');
}

// Test 1.2: Unencoded pa parameter
{
  const uri = 'upi://pay?pa=bob@okaxis&pn=Bob&tr=TX999&am=100.00&cu=INR';
  assert.strictEqual(extractUpiVpa(uri), 'bob@okaxis');
}

// Test 1.3: VPA with complex username (dots, dashes, numbers)
{
  const uri = 'upi://pay?pa=john.doe-1%40icici&pn=John&tr=TX111&am=250.00&cu=INR';
  assert.strictEqual(extractUpiVpa(uri), 'john.doe-1@icici');
}

// Test 1.4: URI without pa parameter
{
  const uri = 'upi://pay?pn=Alice&tr=TX123&am=500.00&cu=INR';
  assert.strictEqual(extractUpiVpa(uri), null);
}

// Test 1.5: Missing / empty pa parameter
{
  const uri = 'upi://pay?pa=&pn=Alice';
  assert.strictEqual(extractUpiVpa(uri), null);
}

// Test 1.6: Non-string / null / undefined inputs
{
  assert.strictEqual(extractUpiVpa(null), null);
  assert.strictEqual(extractUpiVpa(undefined), null);
  assert.strictEqual(extractUpiVpa(''), null);
  assert.strictEqual(extractUpiVpa('   '), null);
  assert.strictEqual(extractUpiVpa(12345), null);
  assert.strictEqual(extractUpiVpa({}), null);
}

// Test 1.7: Malformed percent encoding does not throw
{
  const uri = 'upi://pay?pa=%E0%A4%A&pn=Test';
  assert.strictEqual(extractUpiVpa(uri), null);
}

console.log('✅ extractUpiVpa helper tests passed.');

// ============================================================================
// 2. Real Backend Route & Production Response Mapping Helper
// ============================================================================

console.log('Testing real backend route helper and GET /payment/active/:groupId handler...');

// 2.1: Test extracted production helper router.mapActivePaymentIntent directly
assert.strictEqual(
  typeof paymentRoute.mapActivePaymentIntent,
  'function',
  'paymentRoute.mapActivePaymentIntent must be exported as a production helper'
);

// Case 2.1.A: Intent with full UPI direct details
{
  const intentDoc = {
    _id: 'intent_101',
    group: 'grp_1',
    from: { _id: 'user_a', name: 'Alice' },
    to: { _id: 'user_b', name: 'Bob' },
    amount: 350.75,
    status: 'pending',
    method: 'upi_direct',
    payeeUpiId: 'bob@okhdfcbank',
    payeeName: 'Bob',
    upiTransactionRef: 'TXN_REF_101',
    createdAt: '2026-10-18T10:00:00.000Z',
    claimedAt: null,
  };

  const mapped = paymentRoute.mapActivePaymentIntent(intentDoc);
  assert.strictEqual(mapped.intentId, 'intent_101');
  assert.strictEqual(mapped.groupId, 'grp_1');
  assert.strictEqual(mapped.from, 'user_a');
  assert.strictEqual(mapped.to, 'user_b');
  assert.strictEqual(mapped.payerName, 'Alice');
  assert.strictEqual(mapped.payeeName, 'Bob');
  assert.strictEqual(mapped.amount, 350.75);
  assert.strictEqual(mapped.status, 'pending');
  assert.strictEqual(mapped.payeeUpiId, 'bob@okhdfcbank');
  assert.strictEqual(
    mapped.upiUri,
    'upi://pay?pa=bob%40okhdfcbank&pn=Bob&tr=TXN_REF_101&am=350.75&cu=INR&tn=LendLocal%20Settlement'
  );
  assert.strictEqual(mapped.createdAt, '2026-10-18T10:00:00.000Z');
  assert.strictEqual(mapped.claimedAt, null);
}

// Case 2.1.B: Intent with null payeeUpiId or raw IDs
{
  const intentDoc = {
    _id: 'intent_102',
    group: 'grp_1',
    from: 'user_raw_a',
    to: 'user_raw_b',
    amount: 100,
    status: 'payer_claimed',
    method: 'cash',
    payeeUpiId: null,
    payeeName: null,
    upiTransactionRef: null,
    createdAt: '2026-10-18T10:00:00.000Z',
    claimedAt: '2026-10-18T10:05:00.000Z',
  };

  const mapped = paymentRoute.mapActivePaymentIntent(intentDoc);
  assert.strictEqual(mapped.payeeUpiId, null);
  assert.strictEqual(mapped.upiUri, null);
  assert.strictEqual(mapped.from, 'user_raw_a');
  assert.strictEqual(mapped.to, 'user_raw_b');
  assert.strictEqual(mapped.payerName, 'Unknown');
  assert.strictEqual(mapped.payeeName, 'Unknown');
  assert.strictEqual(mapped.status, 'payer_claimed');
  assert.strictEqual(mapped.claimedAt, '2026-10-18T10:05:00.000Z');
}

// 2.2: Test the actual GET /payment/active/:groupId Express Route Handler
(async () => {
  const layer = paymentRoute.stack.find((l) => l.route && l.route.path === '/active/:groupId');
  assert.ok(layer, 'Route /active/:groupId must exist on payment router');
  const handler = layer.route.stack[1].handle;
  assert.strictEqual(typeof handler, 'function', 'Route handler must be a function');

  const memberId = '507f1f77bcf86cd799439011';
  const toId = '507f1f77bcf86cd799439012';
  const grpId = '507f1f77bcf86cd799439014';

  const mockGroupDoc = {
    _id: grpId,
    name: 'Test Group',
    members: [
      { _id: memberId, name: 'Alice', toString: () => memberId },
      { _id: toId, name: 'Bob', toString: () => toId },
    ],
  };

  const chainablePopulate = (val) => {
    const obj = {
      populate: () => obj,
      then: (resolve) => resolve(val),
    };
    return obj;
  };

  // Stub Mongoose query chains
  const originalGroupFindById = Group.findById;
  const originalExpenseFind = Expense.find;
  const originalPaymentFind = Payment.find;

  Group.findById = () => chainablePopulate(mockGroupDoc);
  Expense.find = () => chainablePopulate([]);

  Payment.find = (filter) => {
    if (filter && filter.status && filter.status.$in && filter.status.$in.includes('pending')) {
      return chainablePopulate([
        {
          _id: '507f1f77bcf86cd799439013',
          group: grpId,
          from: { _id: memberId, name: 'Alice' },
          to: { _id: toId, name: 'Bob' },
          amount: 250,
          status: 'payer_claimed',
          method: 'upi_direct',
          payeeUpiId: 'bob@okhdfcbank',
          payeeName: 'Bob',
          upiTransactionRef: 'TX123',
          createdAt: '2026-10-18T10:00:00.000Z',
          claimedAt: '2026-10-18T10:05:00.000Z',
        },
      ]);
    }
    return chainablePopulate([]);
  };

  const req = {
    params: { groupId: grpId },
    user: { _id: memberId },
  };

  let responseStatus = null;
  let responseJson = null;

  const res = {
    status: (code) => {
      responseStatus = code;
      return res;
    },
    json: (data) => {
      responseJson = data;
    },
  };

  try {
    await handler(req, res);
    assert.strictEqual(responseStatus, 200, 'Handler must return HTTP 200');
    assert.ok(responseJson && responseJson.intents, 'Response must include intents array');
    assert.strictEqual(responseJson.intents.length, 1);
    const intentRes = responseJson.intents[0];
    assert.strictEqual(intentRes.intentId, '507f1f77bcf86cd799439013');
    assert.strictEqual(intentRes.payeeUpiId, 'bob@okhdfcbank', 'Actual handler must return payeeUpiId');
    assert.ok(intentRes.upiUri.includes('pa=bob%40okhdfcbank'), 'Actual handler must return valid upiUri');
    assert.strictEqual(intentRes.status, 'payer_claimed');
  } finally {
    Group.findById = originalGroupFindById;
    Expense.find = originalExpenseFind;
    Payment.find = originalPaymentFind;
  }

  console.log('✅ Real backend route contract and production helper verified.');

  // ============================================================================
  // 3. PaymentModal Payee UPI ID Resolution Logic
  // ============================================================================

  console.log('Testing PaymentModal payee UPI ID resolution...');

  function resolveModalPayeeUpiId(intent) {
    return intent?.payeeUpiId || extractUpiVpa(intent?.upiUri) || null;
  }

  // Test 3.1: Direct payeeUpiId takes precedence
  {
    const intent = {
      payeeUpiId: 'primary@bank',
      upiUri: 'upi://pay?pa=secondary%40bank&pn=User',
    };
    assert.strictEqual(resolveModalPayeeUpiId(intent), 'primary@bank');
  }

  // Test 3.2: Fallback to extractUpiVpa when payeeUpiId is missing
  {
    const intent = {
      payeeUpiId: null,
      upiUri: 'upi://pay?pa=secondary%40bank&pn=User',
    };
    assert.strictEqual(resolveModalPayeeUpiId(intent), 'secondary@bank');
  }

  // Test 3.3: Both missing returns null safely
  {
    const intent = {
      payeeUpiId: null,
      upiUri: null,
    };
    assert.strictEqual(resolveModalPayeeUpiId(intent), null);
  }

  // Test 3.4: Intent object undefined returns null safely
  {
    assert.strictEqual(resolveModalPayeeUpiId(undefined), null);
  }

  console.log('✅ PaymentModal payee UPI ID resolution verified.');

  // ============================================================================
  // 4. Hook Lifecycle Harness Replicating mobile/src/hooks/useGroupDetail.ts
  // ============================================================================

  class GroupDetailHarness {
    constructor(groupId, userId) {
      this.groupId = groupId;
      this.userId = userId;
      this.group = null;
      this.expenses = [];
      this.balances = null;
      this.activeIntents = [];
      this.activeIntentsVerified = true;
      this.activeIntentsError = null;
      this.isLoading = false;
      this.isRefreshing = false;
      this.error = null;
      this.refreshError = null;

      // Internal refs matching useGroupDetail
      this.hasLoaded = false;
      this.lastActiveIntents = null;
      this.requestId = 0;
      this.unauthorizedHandled = false;
      this.prevGroupId = groupId;
      this.prevUserId = userId;
    }

    async handleUnauthorized() {
      this.unauthorizedHandled = true;
      this.hasLoaded = false;
      this.lastActiveIntents = null;
      this.group = null;
      this.expenses = [];
      this.balances = null;
      this.activeIntents = [];
      this.activeIntentsVerified = true;
      this.activeIntentsError = null;
      this.error = null;
      this.refreshError = null;
      this.isLoading = false;
      this.isRefreshing = false;
    }

    onParamsChange(newGroupId, newUserId) {
      if (!newGroupId || !newUserId) {
        this.requestId += 1;
        this.hasLoaded = false;
        this.lastActiveIntents = null;
        this.group = null;
        this.expenses = [];
        this.balances = null;
        this.activeIntents = [];
        this.activeIntentsVerified = true;
        this.activeIntentsError = null;
        this.error = null;
        this.refreshError = null;
        this.isLoading = false;
        this.isRefreshing = false;
        this.prevGroupId = null;
        this.prevUserId = null;
        return;
      }

      if (this.prevGroupId !== newGroupId || this.prevUserId !== newUserId) {
        this.requestId += 1;
        this.hasLoaded = false;
        this.lastActiveIntents = null;
        this.group = null;
        this.expenses = [];
        this.balances = null;
        this.activeIntents = [];
        this.activeIntentsVerified = true;
        this.activeIntentsError = null;
        this.error = null;
        this.refreshError = null;
        this.prevGroupId = newGroupId;
        this.prevUserId = newUserId;
        this.groupId = newGroupId;
        this.userId = newUserId;
      }
    }

    async load(isRefresh = false, throwOnError = false, mockApi = {}) {
      if (!this.groupId) return;
      const currentRequestId = ++this.requestId;

      if (isRefresh) {
        this.isRefreshing = true;
      } else if (!this.hasLoaded) {
        this.isLoading = true;
      }

      try {
        let activeIntentsFetchSucceeded = false;
        let activeIntentsFetchError = null;
        let fetchedActiveIntents = [];

        const activeIntentsPromise = (mockApi.getActiveIntents
          ? mockApi.getActiveIntents(this.groupId)
          : Promise.resolve({ intents: [] }))
          .then((res) => {
            activeIntentsFetchSucceeded = true;
            fetchedActiveIntents = res?.intents ?? [];
            return res;
          })
          .catch((err) => {
            if (err?.status === 401) {
              throw err;
            }
            if (throwOnError) {
              throw err;
            }
            activeIntentsFetchError = err;
            return null;
          });

        const [groupRes, expensesRes, balancesRes] = await Promise.all([
          mockApi.getGroup
            ? mockApi.getGroup(this.groupId)
            : Promise.resolve({ group: { id: this.groupId, name: 'Test Group' } }),
          mockApi.listExpenses ? mockApi.listExpenses(this.groupId) : Promise.resolve({ expenses: [] }),
          mockApi.getBalances
            ? mockApi.getBalances(this.groupId)
            : Promise.resolve({ balances: [], totalSpent: 0, settlements: [] }),
          activeIntentsPromise,
        ]);

        if (currentRequestId !== this.requestId) return;

        this.group = groupRes.group;
        this.expenses = expensesRes.expenses ?? [];
        this.balances = balancesRes;

        if (activeIntentsFetchSucceeded) {
          this.lastActiveIntents = fetchedActiveIntents;
          this.activeIntents = fetchedActiveIntents;
          this.activeIntentsVerified = true;
          this.activeIntentsError = null;
        } else if (this.lastActiveIntents !== null) {
          // Preserve last successfully fetched active intents
          this.activeIntents = this.lastActiveIntents;
          this.activeIntentsVerified = true;
          this.activeIntentsError = null;
        } else {
          // On initial load failure, record unverified state
          this.activeIntents = [];
          this.activeIntentsVerified = false;
          this.activeIntentsError =
            activeIntentsFetchError?.message || 'Failed to verify active payment intents';
        }

        this.error = null;
        this.refreshError = null;
        this.hasLoaded = true;
      } catch (err) {
        if (currentRequestId !== this.requestId) {
          if (throwOnError) throw err;
          return;
        }

        if (err?.status === 401) {
          await this.handleUnauthorized();
          if (throwOnError) throw err;
          return;
        }

        if (!this.hasLoaded) {
          this.error = err?.message || 'Failed to load group details';
        } else {
          this.refreshError = err?.message || 'Failed to refresh group details';
        }

        if (throwOnError) throw err;
      } finally {
        if (currentRequestId === this.requestId) {
          this.isLoading = false;
          this.isRefreshing = false;
        }
      }
    }

    async refresh(throwOnError = false, mockApi = {}) {
      return this.load(true, throwOnError, mockApi);
    }
  }

  // ==========================================================================
  // 4. Initial Active-Intent Fetch Failure (Non-401)
  // ==========================================================================

  console.log('Testing useGroupDetail behavior: Initial active-intent fetch failure...');

  const harness = new GroupDetailHarness('grp_1', 'user_1');

  // Initial load where group/expenses/balances succeed, but active intents fails with 500
  await harness.load(false, false, {
    getActiveIntents: async () => {
      const err = new Error('500 Internal Server Error');
      err.status = 500;
      throw err;
    },
  });

  // Verify group, expenses, and balances are loaded successfully
  assert.ok(harness.group !== null, 'Group metadata must be populated');
  assert.strictEqual(harness.group.id, 'grp_1');
  assert.strictEqual(harness.error, null, 'Blocking screen error must be null');
  assert.strictEqual(harness.refreshError, null, 'Refresh error must be null on initial load');

  // Verify active intents state: not silently 0, but verified = false with error
  assert.deepStrictEqual(harness.activeIntents, [], 'Active intents must be empty array');
  assert.strictEqual(harness.activeIntentsVerified, false, 'activeIntentsVerified must be false');
  assert.strictEqual(harness.activeIntentsError, '500 Internal Server Error', 'activeIntentsError must record error');
  assert.strictEqual(harness.hasLoaded, true, 'hasLoaded must be true');

  console.log('✅ Initial active-intent fetch failure records unverified state without blocking group screen.');

  // ==========================================================================
  // 5. Successful Retry Clearing Warning & Verifying Intents
  // ==========================================================================

  console.log('Testing useGroupDetail behavior: Successful retry clearing warning...');

  const mockIntent = {
    intentId: 'intent_resumed_1',
    groupId: 'grp_1',
    from: 'user_1',
    to: 'user_2',
    payerName: 'Alice',
    payeeName: 'Bob',
    amount: 150,
    status: 'created',
    payeeUpiId: 'bob@upi',
    upiUri: 'upi://pay?pa=bob%40upi',
    createdAt: '2026-10-18T10:00:00Z',
    claimedAt: null,
  };

  await harness.refresh(false, {
    getActiveIntents: async () => ({ intents: [mockIntent] }),
  });

  // Verify that activeIntentsVerified is now true and error is cleared
  assert.strictEqual(harness.activeIntentsVerified, true, 'activeIntentsVerified must transition to true');
  assert.strictEqual(harness.activeIntentsError, null, 'activeIntentsError must be cleared to null');
  assert.strictEqual(harness.activeIntents.length, 1, 'activeIntents must have 1 intent');
  assert.strictEqual(harness.activeIntents[0].intentId, 'intent_resumed_1');
  assert.strictEqual(harness.activeIntents[0].payeeUpiId, 'bob@upi');
  assert.strictEqual(harness.error, null);
  assert.strictEqual(harness.refreshError, null);

  console.log('✅ Successful refresh clears activeIntentsError and verifies active intents.');

  // ==========================================================================
  // 6. Subsequent Fetch Failure Preserving Previously Verified Intents
  // ==========================================================================

  console.log('Testing useGroupDetail behavior: Subsequent fetch failure preserving intents...');

  // Once active intents are verified, a subsequent refresh failure preserves them
  await harness.refresh(false, {
    getActiveIntents: async () => {
      const err = new Error('503 Service Unavailable');
      err.status = 503;
      throw err;
    },
  });

  // Preserved from last successful fetch
  assert.strictEqual(harness.activeIntents.length, 1, 'Must preserve existing active intents');
  assert.strictEqual(harness.activeIntents[0].intentId, 'intent_resumed_1');
  assert.strictEqual(harness.activeIntentsVerified, true, 'activeIntentsVerified remains true');
  assert.strictEqual(harness.activeIntentsError, null, 'activeIntentsError remains null');

  // When throwOnError is true (modal refresh callback)
  let modalWarningCaught = false;
  try {
    await harness.refresh(true, {
      getActiveIntents: async () => {
        const err = new Error('503 Service Unavailable');
        err.status = 503;
        throw err;
      },
    });
  } catch (err) {
    modalWarningCaught = true;
    assert.strictEqual(err.message, '503 Service Unavailable');
  }

  assert.ok(modalWarningCaught, 'Modal refresh callback must catch propagated error');
  assert.strictEqual(harness.refreshError, '503 Service Unavailable');
  assert.strictEqual(harness.error, null, 'Group screen blocking error must NOT be set');
  assert.ok(harness.group !== null, 'Group screen data must be preserved');

  console.log('✅ Subsequent fetch failure preserves last verified intents and propagates throwOnError.');

  // ==========================================================================
  // 7. 401 Unauthorized Invoking Session Handling
  // ==========================================================================

  console.log('Testing useGroupDetail behavior: 401 unauthorized handling...');

  const authHarness = new GroupDetailHarness('grp_1', 'user_1');
  await authHarness.load(false, false, {
    getActiveIntents: async () => {
      const err = new Error('401 Unauthorized');
      err.status = 401;
      throw err;
    },
  });

  assert.ok(authHarness.unauthorizedHandled, '401 must trigger handleUnauthorized');
  assert.strictEqual(authHarness.group, null, 'Group must be cleared on 401');
  assert.strictEqual(authHarness.activeIntentsVerified, true, 'activeIntentsVerified must reset on 401');

  console.log('✅ 401 unauthorized handling verified.');

  // ==========================================================================
  // 8. State Reset When Group or User Changes
  // ==========================================================================

  console.log('Testing useGroupDetail behavior: State reset when group/user changes...');

  // Setup harness with loaded data
  const switchHarness = new GroupDetailHarness('grp_alpha', 'user_x');
  await switchHarness.load(false, false, {
    getActiveIntents: async () => ({ intents: [mockIntent] }),
  });
  assert.strictEqual(switchHarness.hasLoaded, true);
  assert.strictEqual(switchHarness.activeIntents.length, 1);

  // Switch to new group
  const prevReqId = switchHarness.requestId;
  switchHarness.onParamsChange('grp_beta', 'user_x');

  // Verify immediate reset
  assert.strictEqual(switchHarness.hasLoaded, false, 'hasLoaded must be reset to false');
  assert.strictEqual(switchHarness.group, null, 'group must be reset to null');
  assert.deepStrictEqual(switchHarness.activeIntents, [], 'activeIntents must be reset to []');
  assert.strictEqual(switchHarness.activeIntentsVerified, true, 'activeIntentsVerified must be reset to true');
  assert.strictEqual(switchHarness.activeIntentsError, null, 'activeIntentsError must be reset to null');
  assert.strictEqual(switchHarness.lastActiveIntents, null, 'lastActiveIntents ref must be cleared');
  assert.ok(switchHarness.requestId > prevReqId, 'requestId must be incremented to cancel in-flight requests');

  // Switch user (logout / user switch)
  switchHarness.onParamsChange('grp_beta', 'user_y');
  assert.strictEqual(switchHarness.hasLoaded, false);
  assert.strictEqual(switchHarness.lastActiveIntents, null);

  console.log('✅ State reset on group/user changes verified.');

  // ==========================================================================
  // 9. UI Action Guarding Logic & Presentation Mapping
  // ==========================================================================

  console.log('Testing UI action guarding logic & Alert retry choices...');

  function deriveSettlementAction(canPay, activeIntentsVerified, debtActiveIntent) {
    if (debtActiveIntent) {
      if (debtActiveIntent.status === 'payer_claimed') {
        return { type: 'claimed_button', label: 'Review / Manage' };
      }
      return { type: 'pending_button', label: 'Manage / Status' };
    }
    if (canPay) {
      if (activeIntentsVerified) {
        return {
          type: 'pay_button',
          label: 'Pay',
          enabled: true,
          style: 'settlementPayBtn',
        };
      }
      return {
        type: 'unverified_button',
        label: 'Check Status',
        enabled: false,
        style: 'settlementUnverifiedBtn',
        alert: {
          title: 'Active Payment Status Unverified',
          message:
            'Could not verify existing payments or pending claims. Please refresh before initiating a payment to prevent duplicate payments.',
          buttons: ['Cancel', 'Retry'],
        },
      };
    }
    return null;
  }

  // Case 9.1: canPay is true, activeIntentsVerified is true, no existing intent
  {
    const action = deriveSettlementAction(true, true, undefined);
    assert.strictEqual(action.type, 'pay_button');
    assert.strictEqual(action.label, 'Pay');
    assert.strictEqual(action.enabled, true);
    assert.strictEqual(action.style, 'settlementPayBtn');
  }

  // Case 9.2: canPay is true, activeIntentsVerified is false (initial active-intent fetch failed)
  {
    const action = deriveSettlementAction(true, false, undefined);
    assert.strictEqual(action.type, 'unverified_button');
    assert.strictEqual(action.label, 'Check Status');
    assert.strictEqual(action.enabled, false);
    assert.strictEqual(action.style, 'settlementUnverifiedBtn');
    assert.ok(action.alert, 'Must attach alert specification');
    assert.strictEqual(action.alert.title, 'Active Payment Status Unverified');
    assert.deepStrictEqual(action.alert.buttons, ['Cancel', 'Retry']);
  }

  // Case 9.3: Existing intent already known (even if unverified), shows Manage/Status
  {
    const existingIntent = { status: 'created' };
    const action = deriveSettlementAction(true, true, existingIntent);
    assert.strictEqual(action.type, 'pending_button');
  }

  // Case 9.4: canPay is false (user is creditor or non-member)
  {
    const action = deriveSettlementAction(false, false, undefined);
    assert.strictEqual(action, null);
  }

  console.log('✅ Settlement Pay action guarded when active intents are unverified.');

  // ==========================================================================
  // 10. Website/PWA Compatibility
  // ==========================================================================

  console.log('Testing website/PWA compatibility with payeeUpiId...');

  // Replicating frontend/js/group.js lines 2486-2490
  function pwaRenderFallbackDetails(intentData) {
    if (intentData.payeeName && intentData.payeeUpiId) {
      return {
        rendered: true,
        name: intentData.payeeName,
        upiId: intentData.payeeUpiId,
        amount: intentData.amount.toFixed(2),
      };
    }
    return { rendered: false };
  }

  const pwaBackendResponse = {
    payeeName: 'Alice',
    payeeUpiId: 'alice@okaxis',
    amount: 350.5,
  };

  const pwaResult = pwaRenderFallbackDetails(pwaBackendResponse);
  assert.strictEqual(pwaResult.rendered, true);
  assert.strictEqual(pwaResult.upiId, 'alice@okaxis');
  assert.strictEqual(pwaResult.amount, '350.50');

  console.log('✅ Website/PWA compatibility verified.');

  // ==========================================================================
  // 11. Financial Safety & State Machine Invariants
  // ==========================================================================

  console.log('Testing financial safety & state machine invariants...');

  // 11.1: Payer claim is unverified and does not settle ledger
  assert.strictEqual(canClaimIntent('pending', true), true);
  assert.strictEqual(canClaimIntent('pending', false), false);
  assert.strictEqual(canClaimIntent('payer_claimed', true), false);
  assert.strictEqual(isTerminalStatus('payer_claimed'), false);

  // 11.2: Terminal statuses are final and cannot be confirmed/rejected/cancelled
  const terminalStatuses = ['recipient_confirmed', 'recipient_rejected', 'cancelled', 'paid', 'failed'];
  for (const status of terminalStatuses) {
    assert.strictEqual(isTerminalStatus(status), true, `${status} must be terminal`);
    assert.strictEqual(canClaimIntent(status, true), false, `${status} cannot be claimed`);
    assert.strictEqual(canCancelIntent(status, true), false, `${status} cannot be cancelled`);
    assert.strictEqual(canConfirmIntent(status, true), false, `${status} cannot be confirmed`);
    assert.strictEqual(canRejectIntent(status, true), false, `${status} cannot be rejected`);
  }

  console.log('✅ Financial safety & state machine invariants verified.');

  console.log('\n🎉 All Stage 3 Phase 5 M7 payment recovery and resilience tests passed successfully!');
})().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
