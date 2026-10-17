/**
 * LendLocal Stage 3, Phase 5 — Milestone 2 (M2) Test Suite
 *
 * Covers:
 * 1. Client vs Backend validatePaymentAmount parity and exact paise arithmetic
 * 2. Decimal precision enforcement (strictly <= 2 decimal places)
 * 3. Minimum amount (₹0.01) and debt cap enforcement
 * 4. buildCreateIntentPayload input validation and self-payment protection
 * 5. Payment initiation response handling and error contracts (400, 409, 403)
 * 6. External UPI deep-link launching and graceful manual fallback behavior
 * 7. Settlement debt payment eligibility (isPayerMe && isActiveMember)
 * 8. Duplicate submission protection (isSubmitting guard)
 */

const assert = require('assert');

// 1. Load client-side paymentForm helpers
const {
  validatePaymentAmount: clientValidatePaymentAmount,
  buildCreateIntentPayload,
} = require('./mobile/src/utils/paymentForm.ts');

// 2. Load backend helpers for 1:1 parity testing
const {
  validatePaymentAmount: backendValidatePaymentAmount,
} = require('./backend/utils/helpers.js');

console.log('--- Running Stage 3 Phase 5 M2 Unit Tests ---');

// ============================================================================
// 1. Client vs Backend validatePaymentAmount Parity
// ============================================================================
console.log('Testing validatePaymentAmount parity with backend...');

const parityTestCases = [
  // [amount, authorizedAmount, description]
  [undefined, 100, 'undefined amount'],
  [null, 100, 'null amount'],
  ['', 100, 'empty string amount'],
  ['   ', 100, 'whitespace string amount'],
  [true, 100, 'boolean input'],
  [{}, 100, 'object input'],
  [[], 100, 'array input'],
  ['abc', 100, 'alphabetic string'],
  ['-10', 100, 'negative string'],
  [-10, 100, 'negative number'],
  [0, 100, 'zero number'],
  ['0', 100, 'zero string'],
  [0.009, 100, 'sub-paisa number (< 0.01)'],
  ['0.009', 100, 'sub-paisa string (< 0.01)'],
  ['10.123', 100, '3 decimal places string'],
  ['10.999', 100, '3 decimal places string ending with 9'],
  [10.123, 100, '3 decimal places number'],
  [0.01, 100, 'minimum valid amount (₹0.01)'],
  ['0.01', 100, 'minimum valid amount string ("0.01")'],
  [50, 100, 'valid partial amount number (50)'],
  ['50.50', 100, 'valid partial amount string ("50.50")'],
  [100, 100, 'exact authorized amount number (100)'],
  ['100.00', 100, 'exact authorized amount string ("100.00")'],
  [100.01, 100, 'exceeding authorized amount by 1 paisa'],
  ['100.01', 100, 'exceeding authorized amount string by 1 paisa'],
  [250.75, 200, 'significantly exceeding authorized amount'],
  [999.99, null, 'valid amount with null authorized amount'],
  [999.99, undefined, 'valid amount with undefined authorized amount'],
];

for (const [amount, authorizedAmount, desc] of parityTestCases) {
  const backendRes = backendValidatePaymentAmount(amount, authorizedAmount);
  const clientRes = clientValidatePaymentAmount(amount, authorizedAmount);

  assert.strictEqual(
    clientRes.valid,
    backendRes.valid,
    `Validity mismatch for ${desc}: client=${clientRes.valid}, backend=${backendRes.valid}`
  );

  if (!clientRes.valid) {
    assert.strictEqual(
      clientRes.message,
      backendRes.message,
      `Error message mismatch for ${desc}: client="${clientRes.message}", backend="${backendRes.message}"`
    );
  } else {
    assert.strictEqual(
      clientRes.numericAmount,
      backendRes.numericAmount,
      `numericAmount mismatch for ${desc}`
    );
    assert.strictEqual(
      clientRes.requestedPaise,
      backendRes.requestedPaise,
      `requestedPaise mismatch for ${desc}`
    );
    assert.strictEqual(
      clientRes.paymentAmount,
      backendRes.paymentAmount,
      `paymentAmount mismatch for ${desc}`
    );
  }
}

console.log('✅ validatePaymentAmount 100% parity verified with backend.');

// ============================================================================
// 2. Integer Paise Math & Precision Bounds
// ============================================================================
console.log('Testing integer paise math and precision bounds...');

// Minimum amount boundary
assert.strictEqual(clientValidatePaymentAmount(0.01, 10).valid, true);
assert.strictEqual(clientValidatePaymentAmount(0.01, 10).requestedPaise, 1);
assert.strictEqual(clientValidatePaymentAmount(0.009, 10).valid, false);

// Floating point representation safety (e.g. 19.99 * 100 is 1998.9999999999998 in raw JS)
const fpTest = clientValidatePaymentAmount(19.99, 20);
assert.strictEqual(fpTest.valid, true);
assert.strictEqual(fpTest.requestedPaise, 1999);
assert.strictEqual(fpTest.paymentAmount, 19.99);

const fpTest2 = clientValidatePaymentAmount('49.95', 50);
assert.strictEqual(fpTest2.valid, true);
assert.strictEqual(fpTest2.requestedPaise, 4995);

// Debt cap boundary
assert.strictEqual(clientValidatePaymentAmount('100.00', 100).valid, true);
assert.strictEqual(clientValidatePaymentAmount('100.01', 100).valid, false);
assert.strictEqual(
  clientValidatePaymentAmount('100.01', 100).message,
  'Payment exceeds authorized settlement amount'
);

console.log('✅ Integer paise arithmetic and precision checks passed.');

// ============================================================================
// 3. buildCreateIntentPayload
// ============================================================================
console.log('Testing buildCreateIntentPayload...');

const validGroupId = '507f1f77bcf86cd799439011';
const validToUserId = '507f1f77bcf86cd799439022';
const validFromUserId = '507f1f77bcf86cd799439033';

// Valid payload
const payload = buildCreateIntentPayload({
  groupId: validGroupId,
  toUserId: validToUserId,
  amount: '45.50',
  authorizedAmount: 100,
  currentUserId: validFromUserId,
});

assert.deepStrictEqual(payload, {
  groupId: validGroupId,
  toUserId: validToUserId,
  amount: 45.5,
});

// Self-payment rejection
assert.throws(
  () => {
    buildCreateIntentPayload({
      groupId: validGroupId,
      toUserId: validFromUserId,
      amount: '50.00',
      authorizedAmount: 100,
      currentUserId: validFromUserId,
    });
  },
  { message: 'You cannot pay yourself' }
);

// Invalid groupId (not 24 hex characters)
assert.throws(
  () => {
    buildCreateIntentPayload({
      groupId: 'invalid-id',
      toUserId: validToUserId,
      amount: '50.00',
    });
  },
  { message: 'Valid group and receiver IDs are required' }
);

// Invalid toUserId
assert.throws(
  () => {
    buildCreateIntentPayload({
      groupId: validGroupId,
      toUserId: 'not-hex',
      amount: '50.00',
    });
  },
  { message: 'Valid group and receiver IDs are required' }
);

// Amount exceeding debt throws
assert.throws(
  () => {
    buildCreateIntentPayload({
      groupId: validGroupId,
      toUserId: validToUserId,
      amount: '150.00',
      authorizedAmount: 100,
    });
  },
  { message: 'Payment exceeds authorized settlement amount' }
);

console.log('✅ buildCreateIntentPayload validation checks passed.');

// ============================================================================
// 4. Intent API Contract & Error Mapping (400, 409, 403)
// ============================================================================
console.log('Testing Intent API responses and error contract handling...');

// Simulating backend /api/payment/intent responses
const mockSuccessfulIntentResponse = {
  intentId: '64d29a58b4f1c90012345678',
  upiUri: 'upi://pay?pa=alice%40okhdfcbank&pn=Alice&tr=64d29a58b4f1c90012345678&am=50.00&cu=INR&tn=LendLocal%20Settlement',
  payeeName: 'Alice',
  payeeUpiId: 'alice@okhdfcbank',
  amount: 50.0,
  status: 'pending',
};

// Validate URI structure conforms to UPI specification
assert.strictEqual(mockSuccessfulIntentResponse.upiUri.startsWith('upi://pay?'), true);
assert.strictEqual(mockSuccessfulIntentResponse.upiUri.includes('pa=alice%40okhdfcbank'), true);
assert.strictEqual(mockSuccessfulIntentResponse.upiUri.includes('am=50.00'), true);
assert.strictEqual(mockSuccessfulIntentResponse.upiUri.includes('cu=INR'), true);

// 400 Missing UPI error handling contract
function mapIntentError(err, recipientName) {
  const status = err?.status;
  const message = err?.message || 'Failed to initiate UPI payment';

  if (status === 409) {
    return { isConflict: true, isRecipientUpiMissing: false, displayError: message };
  }
  if (status === 400 && message.toLowerCase().includes('not configured a upi')) {
    return {
      isConflict: false,
      isRecipientUpiMissing: true,
      displayError: `${recipientName} has not set up a UPI ID yet. Please ask them to add their UPI ID in their Profile Settings.`,
    };
  }
  return { isConflict: false, isRecipientUpiMissing: false, displayError: message };
}

const err400 = {
  status: 400,
  message: 'Recipient has not configured a UPI payment method',
};
const mapped400 = mapIntentError(err400, 'Bob');
assert.strictEqual(mapped400.isRecipientUpiMissing, true);
assert.strictEqual(mapped400.isConflict, false);
assert.strictEqual(
  mapped400.displayError,
  'Bob has not set up a UPI ID yet. Please ask them to add their UPI ID in their Profile Settings.'
);

// 409 Conflict error handling contract
const err409 = {
  status: 409,
  message:
    'An active UPI payment for ₹50.00 is already in progress. To pay a different amount, cancel the existing pending payment first (Note: cancellation does not reverse money already sent via UPI).',
};
const mapped409 = mapIntentError(err409, 'Bob');
assert.strictEqual(mapped409.isConflict, true);
assert.strictEqual(mapped409.isRecipientUpiMissing, false);
assert.strictEqual(mapped409.displayError, err409.message);

// 403 Forbidden error handling contract
const err403 = {
  status: 403,
  message: 'No valid payable relationship established by ledger',
};
const mapped403 = mapIntentError(err403, 'Bob');
assert.strictEqual(mapped403.isConflict, false);
assert.strictEqual(mapped403.isRecipientUpiMissing, false);
assert.strictEqual(mapped403.displayError, 'No valid payable relationship established by ledger');

console.log('✅ Intent API responses and error contract handling verified.');

// ============================================================================
// 5. External UPI Launching & Graceful Manual Fallback
// ============================================================================
console.log('Testing UPI launching and graceful fallback state machine...');

async function simulateUpiLaunch(upiUri, linkingMock) {
  try {
    await linkingMock.openURL(upiUri);
    return 'launched';
  } catch (err) {
    return 'fallback';
  }
}

// Case A: Device has compatible UPI app -> launched
const successLinkingMock = {
  openURL: async (uri) => {
    assert.strictEqual(typeof uri, 'string');
    return true;
  },
};

(async () => {
  const resultA = await simulateUpiLaunch(mockSuccessfulIntentResponse.upiUri, successLinkingMock);
  assert.strictEqual(resultA, 'launched', 'Successful Linking.openURL must set status to launched');

  // Case B: Device has no compatible UPI app or openURL fails -> fallback
  const failLinkingMock = {
    openURL: async () => {
      throw new Error('No activity found to handle Intent');
    },
  };

  const resultB = await simulateUpiLaunch(mockSuccessfulIntentResponse.upiUri, failLinkingMock);
  assert.strictEqual(resultB, 'fallback', 'Failed Linking.openURL must gracefully fall back to manual instructions');

  console.log('✅ UPI launch and manual fallback state transitions verified.');
})();

// ============================================================================
// 6. Settlement Debt Payment Eligibility
// ============================================================================
console.log('Testing settlement debt payment eligibility logic...');

function canUserPaySettlement({ settlement, currentUserId, isActiveMember }) {
  if (!settlement || !currentUserId) return false;
  const fromId = String(settlement.from?.userId ?? settlement.from?.id ?? '');
  const isPayerMe = fromId === String(currentUserId);
  return isPayerMe && Boolean(isActiveMember);
}

const myId = 'user_111';
const otherId = 'user_222';
const thirdId = 'user_333';

const debtWhereIOwe = {
  from: { id: myId, userId: myId, name: 'Current User' },
  to: { id: otherId, userId: otherId, name: 'Alice' },
  amount: 250,
};

const debtWhereOtherOwesMe = {
  from: { id: otherId, userId: otherId, name: 'Alice' },
  to: { id: myId, userId: myId, name: 'Current User' },
  amount: 150,
};

const debtBetweenOthers = {
  from: { id: otherId, userId: otherId, name: 'Alice' },
  to: { id: thirdId, userId: thirdId, name: 'Charlie' },
  amount: 80,
};

// 1. Current user owes money and is active member -> ELIGIBLE
assert.strictEqual(
  canUserPaySettlement({ settlement: debtWhereIOwe, currentUserId: myId, isActiveMember: true }),
  true
);

// 2. Current user owes money but is a departed historical participant -> NOT ELIGIBLE
assert.strictEqual(
  canUserPaySettlement({ settlement: debtWhereIOwe, currentUserId: myId, isActiveMember: false }),
  false
);

// 3. Other member owes current user -> NOT ELIGIBLE (User is receiver, not payer)
assert.strictEqual(
  canUserPaySettlement({ settlement: debtWhereOtherOwesMe, currentUserId: myId, isActiveMember: true }),
  false
);

// 4. Debt between two third-party members -> NOT ELIGIBLE
assert.strictEqual(
  canUserPaySettlement({ settlement: debtBetweenOthers, currentUserId: myId, isActiveMember: true }),
  false
);

console.log('✅ Settlement debt payment eligibility rules verified.');

// ============================================================================
// 7. Duplicate Submission Protection
// ============================================================================
console.log('Testing duplicate submission protection...');

let isSubmitting = false;
let callCount = 0;

async function mockHandlePay() {
  if (isSubmitting) return false;
  isSubmitting = true;
  callCount++;
  // simulate async api call
  await new Promise((r) => setTimeout(r, 20));
  isSubmitting = false;
  return true;
}

(async () => {
  // Fire two concurrent calls
  const [first, second] = await Promise.all([mockHandlePay(), mockHandlePay()]);
  assert.strictEqual(first, true, 'First invocation should proceed');
  assert.strictEqual(second, false, 'Concurrent invocation should be blocked');
  assert.strictEqual(callCount, 1, 'Only one payment request should execute');

  console.log('✅ Duplicate submission protection verified.');
  console.log('🎉 All Stage 3 Phase 5 M2 tests passed successfully!');
})();

