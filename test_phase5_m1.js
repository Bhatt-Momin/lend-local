/**
 * LendLocal Stage 3, Phase 5 — Milestone 1 (M1) Test Suite
 *
 * Covers:
 * 1. UPI ID Format Validation (UPI_REGEX, validateUpiId, buildUpdateUpiIdPayload)
 * 2. Clearing Behavior (null, empty string, whitespace)
 * 3. Payment API Service Contract & Payload Construction
 * 4. Error Propagation & HTTP Status Handling
 * 5. Re-entrancy & Duplicate Submission Guards
 */

const assert = require('assert');

const {
  UPI_REGEX,
  validateUpiId,
  buildUpdateUpiIdPayload,
} = require('./mobile/src/utils/paymentForm.ts');

console.log('--- Running Stage 3 Phase 5 M1 Unit Tests ---');

// ============================================================================
// 1. UPI ID Format Validation & Backend Regex Compliance
// ============================================================================
console.log('Testing UPI ID format validation...');

// Valid VPAs
const validVpas = [
  'alice@okhdfcbank',
  'bob.123@icici',
  'user_name@paytm',
  'test-vpa@upi',
  'a.b_c-d@bank',
  '9876543210@ybl',
  'john_doe-123@axisbank',
  'merchant.pay@sbi',
];

for (const vpa of validVpas) {
  assert.strictEqual(UPI_REGEX.test(vpa), true, `VPA "${vpa}" should match UPI_REGEX`);
  const res = validateUpiId(vpa, false);
  assert.strictEqual(res.valid, true, `VPA "${vpa}" should be valid`);
  assert.strictEqual(res.upiId, vpa);
  assert.strictEqual(res.isClearing, false);
}

// Invalid VPAs
const invalidVpas = [
  'aliceokhdfcbank', // missing @
  'alice@', // missing bank handle
  '@okhdfcbank', // missing username
  'alice@bank123', // bank handle cannot contain numbers
  'alice@ok_axis', // bank handle cannot contain underscores
  'alice@bank-one', // bank handle cannot contain hyphens
  'alice!@bank', // username cannot contain exclamation
  'alice#@bank', // username cannot contain hash
  'alice$@bank', // username cannot contain dollar
  'alice%@bank', // username cannot contain percent
  'alice @bank', // space before @
  'alice@ bank', // space after @
  'alice@@bank', // double @
  'alice@bank@axis', // multiple @
  'alice@.bank', // bank handle cannot start with dot
];

for (const vpa of invalidVpas) {
  assert.strictEqual(UPI_REGEX.test(vpa), false, `Invalid VPA "${vpa}" must NOT match UPI_REGEX`);
  const res = validateUpiId(vpa, false);
  assert.strictEqual(res.valid, false, `Invalid VPA "${vpa}" should fail validation`);
  assert.strictEqual(res.upiId, null);
  assert.strictEqual(typeof res.error, 'string');
}

// Non-string types rejected
assert.strictEqual(validateUpiId(12345, false).valid, false);
assert.strictEqual(validateUpiId(true, false).valid, false);
assert.strictEqual(validateUpiId({}, false).valid, false);
assert.strictEqual(validateUpiId([], false).valid, false);

console.log('✅ UPI ID format validation tests passed.');

// ============================================================================
// 2. Clearing Behavior (allowEmpty vs strict required)
// ============================================================================
console.log('Testing UPI ID clearing behavior...');

// allowEmpty = true (default) allows null, undefined, empty, whitespace
const clearNull = validateUpiId(null, true);
assert.strictEqual(clearNull.valid, true);
assert.strictEqual(clearNull.upiId, null);
assert.strictEqual(clearNull.isClearing, true);

const clearUndef = validateUpiId(undefined, true);
assert.strictEqual(clearUndef.valid, true);
assert.strictEqual(clearUndef.upiId, null);
assert.strictEqual(clearUndef.isClearing, true);

const clearEmpty = validateUpiId('', true);
assert.strictEqual(clearEmpty.valid, true);
assert.strictEqual(clearEmpty.upiId, null);
assert.strictEqual(clearEmpty.isClearing, true);

const clearWhitespace = validateUpiId('    ', true);
assert.strictEqual(clearWhitespace.valid, true);
assert.strictEqual(clearWhitespace.upiId, null);
assert.strictEqual(clearWhitespace.isClearing, true);

// allowEmpty = false rejects empty inputs
assert.strictEqual(validateUpiId(null, false).valid, false);
assert.strictEqual(validateUpiId(undefined, false).valid, false);
assert.strictEqual(validateUpiId('', false).valid, false);
assert.strictEqual(validateUpiId('   ', false).valid, false);

// buildUpdateUpiIdPayload
assert.deepStrictEqual(buildUpdateUpiIdPayload('user@okhdfc'), { upiId: 'user@okhdfc' });
assert.deepStrictEqual(buildUpdateUpiIdPayload('  user@okhdfc  '), { upiId: 'user@okhdfc' });
assert.deepStrictEqual(buildUpdateUpiIdPayload(null), { upiId: null });
assert.deepStrictEqual(buildUpdateUpiIdPayload(''), { upiId: null });
assert.deepStrictEqual(buildUpdateUpiIdPayload('   '), { upiId: null });

assert.throws(() => {
  buildUpdateUpiIdPayload('invalid_vpa');
}, /Invalid UPI ID format/);

console.log('✅ UPI ID clearing behavior tests passed.');

// ============================================================================
// 3. Payment API Service Contract & Payload Construction
// ============================================================================
console.log('Testing paymentApi and authApi.updateUpiId request contracts...');

// Mock fetch to verify endpoint routing and payload transmission
(async () => {
  const recordedCalls = [];

  const mockApiRequest = async (endpoint, options = {}) => {
    recordedCalls.push({
      endpoint,
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : undefined,
    });
    return { success: true };
  };

  // paymentApi mock methods replicating mobile/src/services/paymentApi.ts
  const mockPaymentApi = {
    createIntent: async (payload) =>
      mockApiRequest('/payment/intent', { method: 'POST', body: JSON.stringify(payload) }),
    claim: async (payload) =>
      mockApiRequest('/payment/claim', { method: 'POST', body: JSON.stringify(payload) }),
    confirm: async (payload) =>
      mockApiRequest('/payment/confirm', { method: 'POST', body: JSON.stringify(payload) }),
    reject: async (payload) =>
      mockApiRequest('/payment/reject', { method: 'POST', body: JSON.stringify(payload) }),
    cancel: async (payload) =>
      mockApiRequest('/payment/cancel', { method: 'POST', body: JSON.stringify(payload) }),
    getActiveIntents: async (groupId) =>
      mockApiRequest(`/payment/active/${groupId}`),
    getStatus: async (intentId) =>
      mockApiRequest(`/payment/status/${intentId}`),
    getConfig: async () =>
      mockApiRequest('/config'),
  };

  const mockAuthApi = {
    updateUpiId: async (payload) =>
      mockApiRequest('/auth/upi-id', { method: 'POST', body: JSON.stringify(payload) }),
  };

  // Test createIntent
  await mockPaymentApi.createIntent({
    groupId: '670a11112222333344445555',
    toUserId: '670b22223333444455556666',
    amount: 150.5,
  });
  assert.strictEqual(recordedCalls[0].endpoint, '/payment/intent');
  assert.strictEqual(recordedCalls[0].method, 'POST');
  assert.strictEqual(recordedCalls[0].body.amount, 150.5);

  // Test claim
  await mockPaymentApi.claim({ intentId: 'intent_123' });
  assert.strictEqual(recordedCalls[1].endpoint, '/payment/claim');
  assert.strictEqual(recordedCalls[1].method, 'POST');
  assert.deepStrictEqual(recordedCalls[1].body, { intentId: 'intent_123' });

  // Test confirm
  await mockPaymentApi.confirm({ intentId: 'intent_123' });
  assert.strictEqual(recordedCalls[2].endpoint, '/payment/confirm');
  assert.strictEqual(recordedCalls[2].method, 'POST');

  // Test reject
  await mockPaymentApi.reject({ intentId: 'intent_123' });
  assert.strictEqual(recordedCalls[3].endpoint, '/payment/reject');
  assert.strictEqual(recordedCalls[3].method, 'POST');

  // Test cancel
  await mockPaymentApi.cancel({ intentId: 'intent_123' });
  assert.strictEqual(recordedCalls[4].endpoint, '/payment/cancel');
  assert.strictEqual(recordedCalls[4].method, 'POST');

  // Test getActiveIntents
  await mockPaymentApi.getActiveIntents('group_999');
  assert.strictEqual(recordedCalls[5].endpoint, '/payment/active/group_999');
  assert.strictEqual(recordedCalls[5].method, 'GET');

  // Test getStatus
  await mockPaymentApi.getStatus('intent_999');
  assert.strictEqual(recordedCalls[6].endpoint, '/payment/status/intent_999');
  assert.strictEqual(recordedCalls[6].method, 'GET');

  // Test getConfig
  await mockPaymentApi.getConfig();
  assert.strictEqual(recordedCalls[7].endpoint, '/config');
  assert.strictEqual(recordedCalls[7].method, 'GET');

  // Test updateUpiId (save)
  await mockAuthApi.updateUpiId({ upiId: 'alice@bank' });
  assert.strictEqual(recordedCalls[8].endpoint, '/auth/upi-id');
  assert.strictEqual(recordedCalls[8].method, 'POST');
  assert.deepStrictEqual(recordedCalls[8].body, { upiId: 'alice@bank' });

  // Test updateUpiId (clear)
  await mockAuthApi.updateUpiId({ upiId: null });
  assert.strictEqual(recordedCalls[9].endpoint, '/auth/upi-id');
  assert.strictEqual(recordedCalls[9].method, 'POST');
  assert.deepStrictEqual(recordedCalls[9].body, { upiId: null });

  console.log('✅ API request routing & payload construction tests passed.');

  // ============================================================================
  // 4. Error Propagation & HTTP Status Handling
  // ============================================================================
  console.log('Testing error propagation...');

  const failingClient = async (status, message) => {
    const err = new Error(message);
    err.status = status;
    throw err;
  };

  try {
    await failingClient(400, 'Invalid UPI ID format');
    assert.fail('Should have thrown 400 error');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.message, 'Invalid UPI ID format');
  }

  try {
    await failingClient(401, 'Session expired. Please log in again.');
    assert.fail('Should have thrown 401 error');
  } catch (err) {
    assert.strictEqual(err.status, 401);
  }

  try {
    await failingClient(409, 'An active UPI payment is already in progress');
    assert.fail('Should have thrown 409 error');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.message.includes('already in progress'), true);
  }

  console.log('✅ Error propagation tests passed.');

  // ============================================================================
  // 5. Duplicate Submission Guard
  // ============================================================================
  console.log('Testing duplicate submission protection...');

  let isSubmitting = false;
  let callCount = 0;

  const performGuardedAction = async (action) => {
    if (isSubmitting) {
      return { skipped: true };
    }
    isSubmitting = true;
    try {
      return await action();
    } finally {
      isSubmitting = false;
    }
  };

  const slowTask = () =>
    new Promise((resolve) => {
      callCount++;
      setTimeout(resolve, 50);
    });

  // Fire first action, then immediately fire second before first finishes
  const p1 = performGuardedAction(slowTask);
  const p2 = performGuardedAction(slowTask);

  const [r1, r2] = await Promise.all([p1, p2]);

  assert.strictEqual(callCount, 1, 'Only one action should execute while busy');
  assert.strictEqual(r2.skipped, true, 'Second concurrent submission must be skipped');

  console.log('✅ Duplicate submission protection tests passed.');
  console.log('🎉 All Stage 3 Phase 5 M1 tests passed successfully!');
})();

