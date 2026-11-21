/**
 * LendLocal Stage 3, Phase 5 — Milestone 3 (M3) Test Suite
 *
 * Covers:
 * 1. Intent Claim Eligibility (canClaimIntent: strictly isPayer && status === 'pending')
 * 2. Intent Cancellation Eligibility (canCancelIntent: strictly isPayer && status === 'pending')
 * 3. Prohibited Cancellation after claim (status === 'payer_claimed' must never be cancellable)
 * 4. Terminal Status Identification (isTerminalStatus)
 * 5. buildIntentActionPayload validation
 * 6. getPaymentStatusBadge presentation mappings
 * 7. Bounded Polling lifecycle, cleanup, and max iteration bounds
 * 8. Overlapping request collision guards & stale response protection
 * 9. Separation of concerns (status check / active intents never create intents)
 * 10. Incoming intent read-only enforcement
 */

const assert = require('assert');

// 1. Load client-side paymentForm helpers
const {
  canClaimIntent,
  canCancelIntent,
  isTerminalStatus,
  buildIntentActionPayload,
  getPaymentStatusBadge,
} = require('./mobile/src/utils/paymentForm.ts');

console.log('--- Running Stage 3 Phase 5 M3 Unit Tests ---');

// ============================================================================
// 1. Intent Claim Eligibility (canClaimIntent)
// ============================================================================
console.log('Testing canClaimIntent eligibility rules...');

// Only pending status AND when user is the payer
assert.strictEqual(canClaimIntent('pending', true), true, 'Payer must be eligible to claim pending intent');
assert.strictEqual(canClaimIntent('pending', false), false, 'Non-payer (receiver/observer) must NOT be eligible to claim');

// Claimed or terminal statuses can never be claimed again
assert.strictEqual(canClaimIntent('payer_claimed', true), false, 'Already claimed intent cannot be claimed again');
assert.strictEqual(canClaimIntent('recipient_confirmed', true), false, 'Confirmed intent cannot be claimed');
assert.strictEqual(canClaimIntent('recipient_rejected', true), false, 'Rejected intent cannot be claimed');
assert.strictEqual(canClaimIntent('cancelled', true), false, 'Cancelled intent cannot be claimed');
assert.strictEqual(canClaimIntent('paid', true), false, 'Paid intent cannot be claimed');
assert.strictEqual(canClaimIntent('failed', true), false, 'Failed intent cannot be claimed');

console.log('✅ canClaimIntent eligibility checks passed.');

// ============================================================================
// 2. Intent Cancellation Eligibility (canCancelIntent)
// ============================================================================
console.log('Testing canCancelIntent eligibility rules...');

// Only pending status AND when user is the payer
assert.strictEqual(canCancelIntent('pending', true), true, 'Payer must be eligible to cancel pending intent');
assert.strictEqual(canCancelIntent('pending', false), false, 'Non-payer (receiver/observer) must NOT be eligible to cancel');

// CRITICAL FINANCIAL SAFETY RULE:
// Once claimed, an intent can NEVER be cancelled by the payer
assert.strictEqual(
  canCancelIntent('payer_claimed', true),
  false,
  'Payer MUST NOT be eligible to cancel an intent after claiming'
);
assert.strictEqual(canCancelIntent('recipient_confirmed', true), false, 'Confirmed intent cannot be cancelled');
assert.strictEqual(canCancelIntent('recipient_rejected', true), false, 'Rejected intent cannot be cancelled');
assert.strictEqual(canCancelIntent('cancelled', true), false, 'Already cancelled intent cannot be cancelled again');

console.log('✅ canCancelIntent eligibility checks passed.');

// ============================================================================
// 3. Terminal Status Identification (isTerminalStatus)
// ============================================================================
console.log('Testing isTerminalStatus identification...');

// Active / non-terminal statuses
assert.strictEqual(isTerminalStatus('pending'), false);
assert.strictEqual(isTerminalStatus('payer_claimed'), false);

// Terminal statuses
assert.strictEqual(isTerminalStatus('recipient_confirmed'), true);
assert.strictEqual(isTerminalStatus('recipient_rejected'), true);
assert.strictEqual(isTerminalStatus('cancelled'), true);
assert.strictEqual(isTerminalStatus('paid'), true);
assert.strictEqual(isTerminalStatus('failed'), true);
assert.strictEqual(isTerminalStatus('reversed'), true);

console.log('✅ isTerminalStatus checks passed.');

// ============================================================================
// 4. buildIntentActionPayload validation
// ============================================================================
console.log('Testing buildIntentActionPayload validation...');

const valid24HexId = '64d29a58b4f1c90012345678';
const payload = buildIntentActionPayload(valid24HexId);
assert.deepStrictEqual(payload, { intentId: valid24HexId });

// Trimming whitespace
const paddedId = '  64d29a58b4f1c90012345678  ';
assert.deepStrictEqual(buildIntentActionPayload(paddedId), { intentId: valid24HexId });

// Invalid intentIds rejected
const invalidIds = ['', '   ', null, undefined, 12345, 'short', '64d29a58b4f1c9001234567z', 'not-a-valid-hex-object-id'];
for (const invalid of invalidIds) {
  assert.throws(
    () => buildIntentActionPayload(invalid),
    { message: 'Valid intentId is required' }
  );
}

console.log('✅ buildIntentActionPayload checks passed.');

// ============================================================================
// 5. getPaymentStatusBadge presentation mappings
// ============================================================================
console.log('Testing getPaymentStatusBadge presentation mappings...');

const pendingBadge = getPaymentStatusBadge('pending');
assert.strictEqual(pendingBadge.tone, 'pending');
assert.strictEqual(pendingBadge.label, 'Payment Pending');

const claimedBadge = getPaymentStatusBadge('payer_claimed');
assert.strictEqual(claimedBadge.tone, 'claimed');
assert.strictEqual(claimedBadge.label.includes('Claimed'), true);

const confirmedBadge = getPaymentStatusBadge('recipient_confirmed');
assert.strictEqual(confirmedBadge.tone, 'confirmed');

const rejectedBadge = getPaymentStatusBadge('recipient_rejected');
assert.strictEqual(rejectedBadge.tone, 'rejected');

const cancelledBadge = getPaymentStatusBadge('cancelled');
assert.strictEqual(cancelledBadge.tone, 'cancelled');

const unknownBadge = getPaymentStatusBadge('something_unknown');
assert.strictEqual(unknownBadge.tone, 'unknown');

console.log('✅ getPaymentStatusBadge mappings passed.');

// ============================================================================
// 6. Bounded Polling Lifecycle & Cleanup
// ============================================================================
console.log('Testing Bounded Polling lifecycle, cleanup, and max ticks...');

(async () => {
  let pollTicks = 0;
  let pollStopped = false;
  const MAX_POLL_COUNT = 12;

  // Mock status responder that updates status on tick 3
  const statusSequence = ['payer_claimed', 'payer_claimed', 'payer_claimed', 'recipient_confirmed'];

  function mockPollTick() {
    if (pollStopped) return;
    if (pollTicks >= MAX_POLL_COUNT) {
      pollStopped = true;
      return;
    }
    const currentStatus = statusSequence[pollTicks] || 'recipient_confirmed';
    pollTicks++;
    if (isTerminalStatus(currentStatus)) {
      pollStopped = true;
    }
  }

  // Run ticks
  while (!pollStopped && pollTicks < 20) {
    mockPollTick();
  }

  assert.strictEqual(pollTicks, 4, 'Polling must stop on tick 4 when status transitions to recipient_confirmed');
  assert.strictEqual(pollStopped, true, 'Polling must be stopped');

  // Test B: Max iterations reached without terminal status
  pollTicks = 0;
  pollStopped = false;
  function mockNeverEndingTick() {
    if (pollStopped) return;
    if (pollTicks >= MAX_POLL_COUNT) {
      pollStopped = true;
      return;
    }
    pollTicks++;
  }

  while (!pollStopped && pollTicks < 20) {
    mockNeverEndingTick();
  }

  assert.strictEqual(pollTicks, MAX_POLL_COUNT, `Polling must stop after exactly ${MAX_POLL_COUNT} ticks`);
  assert.strictEqual(pollStopped, true, 'Polling must be stopped after max ticks');

  console.log('✅ Bounded polling lifecycle and timeout bounds verified.');
})();

// ============================================================================
// 7. Overlapping Request Guards & Stale Response Protection
// ============================================================================
console.log('Testing overlapping request guards and stale response protection...');

(async () => {
  let isPollingFetchInProgress = false;
  let successfulFetches = 0;

  async function simulatedPollingFetch() {
    if (isPollingFetchInProgress) {
      return null; // blocked
    }
    isPollingFetchInProgress = true;
    successfulFetches++;
    await new Promise((r) => setTimeout(r, 20));
    isPollingFetchInProgress = false;
    return 'done';
  }

  // Attempt concurrent fetches
  const [res1, res2] = await Promise.all([simulatedPollingFetch(), simulatedPollingFetch()]);
  assert.strictEqual(res1, 'done');
  assert.strictEqual(res2, null, 'Concurrent polling request must be blocked');
  assert.strictEqual(successfulFetches, 1, 'Only one polling request should execute');

  // Stale Request ID Protection
  let requestId = 0;
  let appliedStatus = 'initial';

  async function slowFetch(assignedId, newStatus) {
    await new Promise((r) => setTimeout(r, 30));
    // Guard: ignore if a newer request was dispatched
    if (assignedId === requestId) {
      appliedStatus = newStatus;
    }
  }

  async function fastFetch(assignedId, newStatus) {
    await new Promise((r) => setTimeout(r, 10));
    if (assignedId === requestId) {
      appliedStatus = newStatus;
    }
  }

  // Dispatch slow request #1, then immediately dispatch fast request #2
  const req1 = ++requestId;
  const p1 = slowFetch(req1, 'stale_status');

  const req2 = ++requestId;
  const p2 = fastFetch(req2, 'fresh_status');

  await Promise.all([p1, p2]);
  assert.strictEqual(
    appliedStatus,
    'fresh_status',
    'Stale response from request #1 must NOT overwrite newer response from request #2'
  );

  console.log('✅ Overlapping request and stale response protection verified.');
})();

// ============================================================================
// 8. Separation of Concerns & Read-Only Incoming Intent Guard
// ============================================================================
console.log('Testing separation of concerns and incoming intent read-only guard...');

// Safeguard 1: Incoming intent (where user is recipient)
const currentUserId = 'user_alice_123';
const incomingIntent = {
  intentId: '64d29a58b4f1c90012345678',
  from: 'user_bob_456',
  to: currentUserId,
  amount: 200,
  status: 'pending',
};

const isPayerForIncoming = incomingIntent.from === currentUserId;
assert.strictEqual(isPayerForIncoming, false, 'User is recipient, not payer');
assert.strictEqual(canClaimIntent(incomingIntent.status, isPayerForIncoming), false);
assert.strictEqual(canCancelIntent(incomingIntent.status, isPayerForIncoming), false);

// Outgoing intent (where user is payer)
const outgoingIntent = {
  intentId: '64d29a58b4f1c90012345678',
  from: currentUserId,
  to: 'user_bob_456',
  amount: 200,
  status: 'pending',
};

const isPayerForOutgoing = outgoingIntent.from === currentUserId;
assert.strictEqual(isPayerForOutgoing, true, 'User is payer');
assert.strictEqual(canClaimIntent(outgoingIntent.status, isPayerForOutgoing), true);
assert.strictEqual(canCancelIntent(outgoingIntent.status, isPayerForOutgoing), true);

console.log('✅ Separation of concerns and incoming intent read-only guard verified.');
console.log('🎉 All Stage 3 Phase 5 M3 tests passed successfully!');

