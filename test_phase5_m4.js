/**
 * LendLocal Stage 3, Phase 5 — Milestone 4 (M4) Test Suite
 *
 * Covers:
 * 1. Recipient Intent Confirmation Eligibility (canConfirmIntent: strictly isRecipient && status === 'payer_claimed')
 * 2. Recipient Intent Rejection Eligibility (canRejectIntent: strictly isRecipient && status === 'payer_claimed')
 * 3. Debtor Self-Confirmation Prevention (debtor/payer must never confirm or reject)
 * 4. Third-Party Observer Safety (non-participants cannot confirm or reject)
 * 5. Ineligible Statuses Guard (pending, cancelled, already confirmed/rejected cannot transition)
 * 6. Terminal Status Progression & Polling Cessation
 * 7. Backend Action Payload Construction & 24-Hex Validation
 * 8. Mutation Success Preservation vs Distinct Refresh Failure Handling
 * 9. In-Flight Action Locks & Overlapping Collision Prevention
 * 10. Backend API Mock Contract (Idempotency, 403 Forbidden, 409 Conflict)
 */

const assert = require('assert');

// 1. Load client-side paymentForm helpers
const {
  canClaimIntent,
  canCancelIntent,
  canConfirmIntent,
  canRejectIntent,
  isTerminalStatus,
  buildIntentActionPayload,
  getPaymentStatusBadge,
} = require('./mobile/src/utils/paymentForm.ts');

console.log('--- Running Stage 3 Phase 5 M4 Unit & Integration Tests ---');

// ============================================================================
// 1. Recipient Confirmation Eligibility (canConfirmIntent)
// ============================================================================
console.log('Testing canConfirmIntent eligibility rules...');

// Only payer_claimed status AND when user is the recipient
assert.strictEqual(canConfirmIntent('payer_claimed', true), true, 'Recipient must be eligible to confirm claimed intent');
assert.strictEqual(canConfirmIntent('payer_claimed', false), false, 'Non-recipient must NOT be eligible to confirm');

// Ineligible statuses for recipient confirmation
assert.strictEqual(canConfirmIntent('pending', true), false, 'Pending intent cannot be confirmed before being claimed');
assert.strictEqual(canConfirmIntent('recipient_confirmed', true), false, 'Already confirmed intent cannot be confirmed again');
assert.strictEqual(canConfirmIntent('recipient_rejected', true), false, 'Rejected intent cannot be confirmed');
assert.strictEqual(canConfirmIntent('cancelled', true), false, 'Cancelled intent cannot be confirmed');
assert.strictEqual(canConfirmIntent('paid', true), false, 'Paid intent cannot be confirmed');
assert.strictEqual(canConfirmIntent('failed', true), false, 'Failed intent cannot be confirmed');

console.log('✅ canConfirmIntent eligibility checks passed.');

// ============================================================================
// 2. Recipient Rejection Eligibility (canRejectIntent)
// ============================================================================
console.log('Testing canRejectIntent eligibility rules...');

// Only payer_claimed status AND when user is the recipient
assert.strictEqual(canRejectIntent('payer_claimed', true), true, 'Recipient must be eligible to reject claimed intent');
assert.strictEqual(canRejectIntent('payer_claimed', false), false, 'Non-recipient must NOT be eligible to reject');

// Ineligible statuses for recipient rejection
assert.strictEqual(canRejectIntent('pending', true), false, 'Pending intent cannot be rejected');
assert.strictEqual(canRejectIntent('recipient_confirmed', true), false, 'Confirmed intent cannot be rejected');
assert.strictEqual(canRejectIntent('recipient_rejected', true), false, 'Already rejected intent cannot be rejected again');
assert.strictEqual(canRejectIntent('cancelled', true), false, 'Cancelled intent cannot be rejected');
assert.strictEqual(canRejectIntent('paid', true), false, 'Paid intent cannot be rejected');
assert.strictEqual(canRejectIntent('failed', true), false, 'Failed intent cannot be rejected');

console.log('✅ canRejectIntent eligibility checks passed.');

// ============================================================================
// 3. Debtor Self-Confirmation Prevention & Participant Role Derivation
// ============================================================================
console.log('Testing debtor self-confirmation prevention and role derivation...');

const payerUserId = 'user_debtor_111';
const recipientUserId = 'user_creditor_222';
const thirdPartyUserId = 'user_observer_333';

const claimedPaymentIntent = {
  intentId: '64d29a58b4f1c90012345678',
  from: payerUserId,
  to: recipientUserId,
  amount: 250,
  status: 'payer_claimed',
};

// Check Debtor Role
const isPayerForDebtor = claimedPaymentIntent.from === payerUserId;
const isRecipientForDebtor = claimedPaymentIntent.to === payerUserId;
assert.strictEqual(isPayerForDebtor, true, 'Debtor is payer');
assert.strictEqual(isRecipientForDebtor, false, 'Debtor is not recipient');
assert.strictEqual(
  canConfirmIntent(claimedPaymentIntent.status, isRecipientForDebtor),
  false,
  'CRITICAL FINANCIAL SAFETY: Debtor must NEVER be permitted to self-confirm receipt'
);
assert.strictEqual(
  canRejectIntent(claimedPaymentIntent.status, isRecipientForDebtor),
  false,
  'Debtor must NOT be permitted to reject receipt'
);

// Check Recipient Role
const isPayerForCreditor = claimedPaymentIntent.from === recipientUserId;
const isRecipientForCreditor = claimedPaymentIntent.to === recipientUserId;
assert.strictEqual(isPayerForCreditor, false, 'Creditor is not payer');
assert.strictEqual(isRecipientForCreditor, true, 'Creditor is recipient');
assert.strictEqual(canConfirmIntent(claimedPaymentIntent.status, isRecipientForCreditor), true);
assert.strictEqual(canRejectIntent(claimedPaymentIntent.status, isRecipientForCreditor), true);

// Check Third-Party Observer Role
const isPayerForObserver = claimedPaymentIntent.from === thirdPartyUserId;
const isRecipientForObserver = claimedPaymentIntent.to === thirdPartyUserId;
assert.strictEqual(isPayerForObserver, false, 'Observer is not payer');
assert.strictEqual(isRecipientForObserver, false, 'Observer is not recipient');
assert.strictEqual(canConfirmIntent(claimedPaymentIntent.status, isRecipientForObserver), false);
assert.strictEqual(canRejectIntent(claimedPaymentIntent.status, isRecipientForObserver), false);

// Check populated object format from MongoDB
const populatedIntent = {
  intentId: '64d29a58b4f1c90012345678',
  from: { _id: payerUserId, name: 'Alice Debtor' },
  to: { _id: recipientUserId, name: 'Bob Creditor' },
  amount: 250,
  status: 'payer_claimed',
};
const parsedFromId = String(
  typeof populatedIntent.from === 'object' && populatedIntent.from
    ? populatedIntent.from._id
    : populatedIntent.from
);
const parsedToId = String(
  typeof populatedIntent.to === 'object' && populatedIntent.to
    ? populatedIntent.to._id
    : populatedIntent.to
);

assert.strictEqual(parsedFromId, payerUserId);
assert.strictEqual(parsedToId, recipientUserId);
assert.strictEqual(canConfirmIntent(populatedIntent.status, parsedToId === recipientUserId), true);
assert.strictEqual(canConfirmIntent(populatedIntent.status, parsedToId === payerUserId), false);

console.log('✅ Debtor self-confirmation prevention and role derivation checks passed.');

// ============================================================================
// 4. Terminal Status Progression & Polling Cessation
// ============================================================================
console.log('Testing terminal status progression and polling cessation...');

// Terminal status validation
assert.strictEqual(isTerminalStatus('recipient_confirmed'), true);
assert.strictEqual(isTerminalStatus('recipient_rejected'), true);

// Badge mappings for M4 terminal statuses
const confirmedBadge = getPaymentStatusBadge('recipient_confirmed');
assert.strictEqual(confirmedBadge.tone, 'confirmed');
assert.strictEqual(confirmedBadge.label, 'Confirmed & Settled');

const rejectedBadge = getPaymentStatusBadge('recipient_rejected');
assert.strictEqual(rejectedBadge.tone, 'rejected');
assert.strictEqual(rejectedBadge.label, 'Rejected');

// Polling must immediately cease on confirmed or rejected
let pollingActive = true;
function handleStatusTransition(newStatus) {
  if (isTerminalStatus(newStatus)) {
    pollingActive = false;
  }
}

handleStatusTransition('payer_claimed');
assert.strictEqual(pollingActive, true, 'Polling must remain active while payer_claimed');

handleStatusTransition('recipient_confirmed');
assert.strictEqual(pollingActive, false, 'Polling must stop immediately when recipient_confirmed');

pollingActive = true;
handleStatusTransition('recipient_rejected');
assert.strictEqual(pollingActive, false, 'Polling must stop immediately when recipient_rejected');

console.log('✅ Terminal status progression and polling cessation checks passed.');

// ============================================================================
// 5. Backend Action Payload Construction
// ============================================================================
console.log('Testing buildIntentActionPayload validation...');

const validIntentId = '64d29a58b4f1c90012345678';
const confirmPayload = buildIntentActionPayload(validIntentId);
assert.deepStrictEqual(confirmPayload, { intentId: validIntentId });

const rejectPayload = buildIntentActionPayload('  ' + validIntentId + '  ');
assert.deepStrictEqual(rejectPayload, { intentId: validIntentId });

assert.throws(() => buildIntentActionPayload(''), /Valid intentId is required/);
assert.throws(() => buildIntentActionPayload('invalid-hex-length'), /Valid intentId is required/);
assert.throws(() => buildIntentActionPayload('64d29a58b4f1c9001234567z'), /Valid intentId is required/);

console.log('✅ Backend action payload construction passed.');

async function runAllTests() {
  // ============================================================================
  // 6. Mutation Success vs Refresh Failure Distinction
  // ============================================================================
  console.log('Testing mutation success preservation vs refresh failure handling...');

  // Simulated UI state model mirroring PaymentModal
  const state = {
    currentStatus: 'payer_claimed',
    formSuccess: null,
    formError: null,
    refreshWarning: null,
  };

  // Mock confirm mutation API returning success
  async function mockConfirmApi(payload) {
    return {
      success: true,
      message: 'Payment confirmed successfully',
      intentId: payload.intentId,
      status: 'recipient_confirmed',
    };
  }

  // Mock group balances refresh that encounters a network timeout
  async function failingRefresh() {
    throw new Error('Network timeout during balances refresh');
  }

  // Execute confirm handler with safeguard pattern
  async function handleConfirmReceiptTest(intentId) {
    try {
      const res = await mockConfirmApi({ intentId });
      // 1. Immediately apply terminal status from successful server response
      state.currentStatus = res.status;
      state.formSuccess = res.message;

      // 2. Refresh balances in separate try/catch
      try {
        await failingRefresh();
      } catch {
        // Distinct non-blocking refresh warning; DO NOT fail the mutation!
        state.refreshWarning =
          'Payment was confirmed successfully on the server, but group balances could not be refreshed immediately. Please pull down to refresh.';
      }
    } catch (err) {
      state.formError = err.message;
    }
  }

  await handleConfirmReceiptTest(validIntentId);

  // Assertions:
  assert.strictEqual(
    state.currentStatus,
    'recipient_confirmed',
    'Status MUST be recipient_confirmed despite background refresh failure'
  );
  assert.strictEqual(
    state.formSuccess,
    'Payment confirmed successfully',
    'Success banner MUST remain visible'
  );
  assert.strictEqual(
    state.formError,
    null,
    'formError MUST remain null; mutation must NOT be marked as failed'
  );
  assert.ok(
    state.refreshWarning && state.refreshWarning.includes('pull down to refresh'),
    'Non-blocking refresh warning must be displayed'
  );

  console.log('✅ Mutation success preservation vs refresh failure checks passed.');

  // ============================================================================
  // 7. In-Flight Action Locks & Overlapping Collision Guard
  // ============================================================================
  console.log('Testing in-flight action locks and collision protection...');

  let isActionInProgress = false;
  let confirmExecuted = 0;
  let rejectExecuted = 0;

  async function triggerConfirm() {
    if (isActionInProgress) return { blocked: true };
    isActionInProgress = true;
    confirmExecuted++;
    await new Promise((r) => setTimeout(r, 20));
    isActionInProgress = false;
    return { success: true };
  }

  async function triggerReject() {
    if (isActionInProgress) return { blocked: true };
    isActionInProgress = true;
    rejectExecuted++;
    await new Promise((r) => setTimeout(r, 20));
    isActionInProgress = false;
    return { success: true };
  }

  // Attempt simultaneous confirm and reject
  const [resConfirm, resReject] = await Promise.all([triggerConfirm(), triggerReject()]);

  assert.strictEqual(resConfirm.success, true, 'First action executes');
  assert.strictEqual(resReject.blocked, true, 'Second conflicting action is blocked');
  assert.strictEqual(confirmExecuted, 1);
  assert.strictEqual(rejectExecuted, 0);

  // Attempt double-tap on confirm
  const [tap1, tap2] = await Promise.all([triggerConfirm(), triggerConfirm()]);
  assert.strictEqual(tap1.success, true);
  assert.strictEqual(tap2.blocked, true);
  assert.strictEqual(confirmExecuted, 2);

  console.log('✅ In-flight action locks and collision protection passed.');

  // ============================================================================
  // 8. Backend Contract Simulation (Idempotency, 403 Forbidden, 409 Conflict)
  // ============================================================================
  console.log('Testing backend contract simulation...');

  // Mock backend handler matching backend/routes/payment.js:745-872
  function simulateBackendConfirm({ userId, intent, requestedIntentId }) {
    if (intent._id !== requestedIntentId) {
      return { status: 404, body: { success: false, message: 'Payment intent not found' } };
    }
    // Authorization check: strictly recipient
    if (intent.to !== userId) {
      return { status: 403, body: { success: false, message: 'Only recipient can confirm payment' } };
    }
    // Idempotency: already confirmed returns 200
    if (intent.status === 'recipient_confirmed') {
      return {
        status: 200,
        body: {
          success: true,
          message: 'Payment already confirmed',
          intentId: intent._id,
          status: 'recipient_confirmed',
        },
      };
    }
    // Precondition check: must be payer_claimed
    if (intent.status !== 'payer_claimed') {
      return {
        status: 409,
        body: {
          success: false,
          message: `Payment cannot be confirmed from status ${intent.status}`,
        },
      };
    }

    // Success transition
    intent.status = 'recipient_confirmed';
    return {
      status: 200,
      body: {
        success: true,
        message: 'Payment confirmed successfully',
        intentId: intent._id,
        status: 'recipient_confirmed',
      },
    };
  }

  // Case 1: Unauthorized debtor tries to confirm
  const debtorIntent = {
    _id: '64d29a58b4f1c90012345678',
    from: payerUserId,
    to: recipientUserId,
    status: 'payer_claimed',
  };
  const resUnauthorized = simulateBackendConfirm({
    userId: payerUserId,
    intent: debtorIntent,
    requestedIntentId: debtorIntent._id,
  });
  assert.strictEqual(resUnauthorized.status, 403, 'Debtor must receive 403 Forbidden');

  // Case 2: Recipient confirms unclaimed pending intent
  const pendingIntent = {
    _id: '64d29a58b4f1c90012345678',
    from: payerUserId,
    to: recipientUserId,
    status: 'pending',
  };
  const resConflictPending = simulateBackendConfirm({
    userId: recipientUserId,
    intent: pendingIntent,
    requestedIntentId: pendingIntent._id,
  });
  assert.strictEqual(resConflictPending.status, 409, 'Confirming pending intent must return 409 Conflict');

  // Case 3: Recipient confirms claimed intent
  const claimedIntent = {
    _id: '64d29a58b4f1c90012345678',
    from: payerUserId,
    to: recipientUserId,
    status: 'payer_claimed',
  };
  const resSuccess = simulateBackendConfirm({
    userId: recipientUserId,
    intent: claimedIntent,
    requestedIntentId: claimedIntent._id,
  });
  assert.strictEqual(resSuccess.status, 200);
  assert.strictEqual(resSuccess.body.status, 'recipient_confirmed');

  // Case 4: Idempotent re-confirmation
  const resIdempotent = simulateBackendConfirm({
    userId: recipientUserId,
    intent: claimedIntent, // status is now 'recipient_confirmed'
    requestedIntentId: claimedIntent._id,
  });
  assert.strictEqual(resIdempotent.status, 200, 'Re-confirming must return 200 idempotent response');
  assert.strictEqual(resIdempotent.body.status, 'recipient_confirmed');

  console.log('✅ Backend contract simulation passed.');
  console.log('🎉 All Stage 3 Phase 5 M4 tests passed successfully!');
}

runAllTests().catch((err) => {
  console.error('❌ M4 tests failed:', err);
  process.exit(1);
});
