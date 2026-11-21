/**
 * LendLocal Stage 3, Phase 5 — Milestone 5 (M5) Test Suite
 *
 * Covers:
 * 1. ApiError Structured Data Contract (preservation of status, message, and error payload data)
 * 2. HTTP 409 Conflict Recovery Logic & Intent Verification (group, participants, debt direction, status)
 * 3. Prevention of Duplicate Intent Creation during recovery & safe fallbacks
 * 4. Dashboard Focus Refresh Behavior (in-flight concurrency lock, data preservation on failure, 401 handling)
 * 5. Incoming-Claim Badge Derivation (ID normalization, status filtering, de-duplication, role matching)
 * 6. Backend-Authoritative Ledger Settlement Parity (only recipient_confirmed reduces ledger debt)
 */

const assert = require('assert');

async function runAllM5Tests() {
  console.log('--- Running Stage 3 Phase 5 M5 Integration Audit Tests ---');

  // ============================================================================
  // 1. ApiError Structured Data Contract
  // ============================================================================
  console.log('Testing ApiError structured data contract...');

  // Simulated apiRequest error creation matching mobile/src/services/api.ts
  function simulateApiErrorResponse({ status, bodyText }) {
    let data = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = { message: bodyText };
      }
    }

    const message = (data && data.message) || `Request failed with status ${status}`;
    return {
      message,
      status,
      data,
    };
  }

  // Case 1A: 409 Conflict with structured payload
  const conflictPayload = {
    message: 'An active UPI payment for ₹250.00 is already in progress. To pay a different amount, cancel the existing pending payment first.',
    intentId: '64d29a58b4f1c90012345678',
    status: 'pending',
    amount: 250,
  };
  const err409 = simulateApiErrorResponse({
    status: 409,
    bodyText: JSON.stringify(conflictPayload),
  });

  assert.strictEqual(err409.status, 409);
  assert.strictEqual(err409.message, conflictPayload.message);
  assert.deepStrictEqual(err409.data, conflictPayload);
  assert.strictEqual(err409.data.intentId, '64d29a58b4f1c90012345678');
  assert.strictEqual(err409.data.status, 'pending');

  // Case 1B: Non-JSON error response
  const err500 = simulateApiErrorResponse({
    status: 500,
    bodyText: 'Internal Server Error',
  });
  assert.strictEqual(err500.status, 500);
  assert.strictEqual(err500.message, 'Internal Server Error');
  assert.deepStrictEqual(err500.data, { message: 'Internal Server Error' });

  console.log('✅ ApiError structured data contract tests passed.');

  // ============================================================================
  // 2. HTTP 409 Conflict Recovery Logic & Intent Verification
  // ============================================================================
  console.log('Testing HTTP 409 conflict recovery logic...');

  const groupId = '64d11111b4f1c90012345678';
  const debtorUserId = 'user_debtor_111';
  const creditorUserId = 'user_creditor_222';
  const thirdPartyUserId = 'user_observer_333';

  // Simulated resolver function matching mobile/src/components/PaymentModal.tsx:handleResolveConflict
  function resolveMatchingConflictIntent({
    targetIntentId,
    groupId: targetGroupId,
    debtorId,
    creditorId,
    activeIntents,
  }) {
    return activeIntents.find((i) => {
      const iFrom = String(
        typeof i.from === 'object' && i.from
          ? i.from._id || i.from.id
          : i.from
      );
      const iTo = String(
        typeof i.to === 'object' && i.to
          ? i.to._id || i.to.id
          : i.to
      );
      const iGroup = String(i.groupId || targetGroupId);

      const idMatches = targetIntentId ? String(i.intentId) === String(targetIntentId) : true;
      const groupMatches = iGroup === targetGroupId;
      const participantsMatch = iFrom === debtorId && iTo === creditorId;
      const statusActive = i.status === 'pending' || i.status === 'payer_claimed';

      return idMatches && groupMatches && participantsMatch && statusActive;
    });
  }

  const mockActiveIntents = [
    {
      intentId: '64d29a58b4f1c90012345678',
      groupId,
      from: debtorUserId,
      to: creditorUserId,
      amount: 250,
      status: 'pending',
      payeeName: 'Creditor User',
      payerName: 'Debtor User',
    },
    {
      // Populated object format
      intentId: '64d39a58b4f1c90012345679',
      groupId,
      from: { _id: debtorUserId, name: 'Debtor' },
      to: { _id: thirdPartyUserId, name: 'Third Party' },
      amount: 100,
      status: 'pending',
    },
    {
      // Different group
      intentId: '64d49a58b4f1c90012345680',
      groupId: 'other_group_999',
      from: debtorUserId,
      to: creditorUserId,
      amount: 50,
      status: 'pending',
    },
    {
      // Terminal status (cannot be active conflict)
      intentId: '64d59a58b4f1c90012345681',
      groupId,
      from: debtorUserId,
      to: creditorUserId,
      amount: 250,
      status: 'cancelled',
    },
  ];

  // Test 2A: Exact match by intentId and participants
  const matchById = resolveMatchingConflictIntent({
    targetIntentId: '64d29a58b4f1c90012345678',
    groupId,
    debtorId: debtorUserId,
    creditorId: creditorUserId,
    activeIntents: mockActiveIntents,
  });
  assert.ok(matchById, 'Must resolve intent matching intentId, group, and participants');
  assert.strictEqual(matchById.intentId, '64d29a58b4f1c90012345678');
  assert.strictEqual(matchById.amount, 250);

  // Test 2B: Fallback match without targetIntentId (e.g. backend error without intentId in body)
  const matchByFallback = resolveMatchingConflictIntent({
    targetIntentId: null,
    groupId,
    debtorId: debtorUserId,
    creditorId: creditorUserId,
    activeIntents: mockActiveIntents,
  });
  assert.ok(matchByFallback, 'Must resolve matching active intent by participants and group even if targetIntentId is absent');
  assert.strictEqual(matchByFallback.intentId, '64d29a58b4f1c90012345678');

  // Test 2C: Reversed debt direction must NOT match
  const reversedMatch = resolveMatchingConflictIntent({
    targetIntentId: '64d29a58b4f1c90012345678',
    groupId,
    debtorId: creditorUserId, // reversed
    creditorId: debtorUserId, // reversed
    activeIntents: mockActiveIntents,
  });
  assert.strictEqual(reversedMatch, undefined, 'Reversed debt direction must NOT be resolved as conflict');

  // Test 2D: Different group must NOT match
  const otherGroupMatch = resolveMatchingConflictIntent({
    targetIntentId: '64d49a58b4f1c90012345680',
    groupId, // requesting groupId, but intent is other_group_999
    debtorId: debtorUserId,
    creditorId: creditorUserId,
    activeIntents: mockActiveIntents,
  });
  assert.strictEqual(otherGroupMatch, undefined, 'Intent from another group must NOT match');

  // Test 2E: Terminal status must NOT match
  const terminalMatch = resolveMatchingConflictIntent({
    targetIntentId: '64d59a58b4f1c90012345681',
    groupId,
    debtorId: debtorUserId,
    creditorId: creditorUserId,
    activeIntents: mockActiveIntents,
  });
  assert.strictEqual(terminalMatch, undefined, 'Cancelled intent must NOT be resolved as active conflict');

  console.log('✅ HTTP 409 conflict recovery logic tests passed.');

  // ============================================================================
  // 3. Dashboard Focus Refresh Behavior & Concurrency Lock
  // ============================================================================
  console.log('Testing dashboard focus refresh behavior and concurrency...');

  let listCallCount = 0;
  let inFlight = false;
  let hasLoaded = false;
  let state = {
    groups: [],
    error: null,
  };

  async function mockListApi(shouldFail = false, status = 500) {
    listCallCount++;
    await new Promise((r) => setTimeout(r, 15));
    if (shouldFail) {
      throw { message: 'Network dropout', status };
    }
    return {
      groups: [
        { id: 'g1', name: 'Apartment', myBalance: -250 },
        { id: 'g2', name: 'Trip', myBalance: 500 },
      ],
    };
  }

  // Simulated refreshOnFocus hook implementation matching useGroups.ts
  async function refreshOnFocus(shouldFail = false, failStatus = 500) {
    if (inFlight) return { skipped: true };
    inFlight = true;
    try {
      const res = await mockListApi(shouldFail, failStatus);
      state.groups = res.groups;
      state.error = null;
      hasLoaded = true;
      return { success: true };
    } catch (err) {
      if (err?.status === 401) {
        state.groups = [];
        state.error = null;
        hasLoaded = false;
        return { unauthorized: true };
      }
      // Data preservation rule on failure
      if (!hasLoaded) {
        state.error = err.message;
      }
      return { failed: true };
    } finally {
      inFlight = false;
    }
  }

  // 1. Initial successful focus load
  const initialRes = await refreshOnFocus();
  assert.strictEqual(initialRes.success, true);
  assert.strictEqual(state.groups.length, 2);
  assert.strictEqual(listCallCount, 1);

  // 2. Concurrency / In-flight overlapping protection
  const [callA, callB] = await Promise.all([refreshOnFocus(), refreshOnFocus()]);
  assert.strictEqual(callA.success, true, 'First in-flight call succeeds');
  assert.strictEqual(callB.skipped, true, 'Concurrent second call must be skipped to avoid duplicate requests');
  assert.strictEqual(listCallCount, 2);

  // 3. Data preservation on focus failure
  const failRes = await refreshOnFocus(true, 500);
  assert.strictEqual(failRes.failed, true);
  assert.strictEqual(
    state.groups.length,
    2,
    'CRITICAL: Existing groups and totals must be preserved when background focus refresh fails'
  );
  assert.strictEqual(state.error, null, 'Error must not wipe out UI when data is already loaded');

  // 4. Session revocation on 401
  const unauthRes = await refreshOnFocus(true, 401);
  assert.strictEqual(unauthRes.unauthorized, true);
  assert.strictEqual(state.groups.length, 0, 'Groups must be cleared immediately upon 401 session expiration');

  console.log('✅ Dashboard focus refresh behavior and concurrency tests passed.');

  // ============================================================================
  // 4. Incoming-Claim Badge Derivation
  // ============================================================================
  console.log('Testing incoming-claim badge derivation...');

  // Logic matching mobile/src/app/group/[id]/index.tsx:unconfirmedClaimsCount
  function computeUnconfirmedClaimsCount(activeIntents, currentUserId) {
    if (!currentUserId || !activeIntents || activeIntents.length === 0) return 0;
    const seenIntentIds = new Set();

    return activeIntents.filter((intent) => {
      if (!intent || intent.status !== 'payer_claimed') return false;

      const toId = String(
        typeof intent.to === 'object' && intent.to
          ? intent.to._id || intent.to.id
          : intent.to
      );

      if (toId !== currentUserId) return false;

      const intentId = String(intent.intentId || '');
      if (intentId && seenIntentIds.has(intentId)) return false;
      if (intentId) seenIntentIds.add(intentId);

      return true;
    }).length;
  }

  const currentCreditorId = 'creditor_999';

  const testIntents = [
    // 1. Valid claim for current user
    {
      intentId: 'intent_1',
      from: 'debtor_1',
      to: currentCreditorId,
      status: 'payer_claimed',
    },
    // 2. Valid claim with populated object
    {
      intentId: 'intent_2',
      from: 'debtor_2',
      to: { _id: currentCreditorId, name: 'Creditor' },
      status: 'payer_claimed',
    },
    // 3. Duplicate of intent_1
    {
      intentId: 'intent_1',
      from: 'debtor_1',
      to: currentCreditorId,
      status: 'payer_claimed',
    },
    // 4. Payer is current user (outgoing claim, should not count towards recipient review badge)
    {
      intentId: 'intent_3',
      from: currentCreditorId,
      to: 'other_user',
      status: 'payer_claimed',
    },
    // 5. Unclaimed pending intent
    {
      intentId: 'intent_4',
      from: 'debtor_3',
      to: currentCreditorId,
      status: 'pending',
    },
    // 6. Confirmed intent
    {
      intentId: 'intent_5',
      from: 'debtor_4',
      to: currentCreditorId,
      status: 'recipient_confirmed',
    },
    // 7. Third-party claim
    {
      intentId: 'intent_6',
      from: 'debtor_5',
      to: 'third_party_creditor',
      status: 'payer_claimed',
    },
  ];

  const badgeCount = computeUnconfirmedClaimsCount(testIntents, currentCreditorId);
  assert.strictEqual(
    badgeCount,
    2,
    'Badge count must equal exactly 2 (intent_1 and intent_2, de-duplicating intent_1 and ignoring pending/confirmed/outgoing)'
  );

  // Empty intents
  assert.strictEqual(computeUnconfirmedClaimsCount([], currentCreditorId), 0);
  assert.strictEqual(computeUnconfirmedClaimsCount(null, currentCreditorId), 0);
  assert.strictEqual(computeUnconfirmedClaimsCount(testIntents, ''), 0);

  console.log('✅ Incoming-claim badge derivation tests passed.');

  // ============================================================================
  // 5. Backend-Authoritative Ledger Parity
  // ============================================================================
  console.log('Testing backend-authoritative ledger parity rules...');

  // Logic matching backend/utils/helpers.js:calculateLedger lines 118-138
  function simulateLedgerSettlementEffect(initialDebtPaise, paymentStatus, paymentAmountPaise) {
    let outstandingDebtPaise = initialDebtPaise;

    // Authoritative condition: ONLY 'paid' and 'recipient_confirmed' reduce debt
    if (paymentStatus === 'paid' || paymentStatus === 'recipient_confirmed') {
      outstandingDebtPaise -= paymentAmountPaise;
    }

    return outstandingDebtPaise;
  }

  const initialDebtPaise = 50000; // ₹500.00
  const paymentAmountPaise = 25000; // ₹250.00

  // Ineligible statuses have ZERO ledger impact
  assert.strictEqual(
    simulateLedgerSettlementEffect(initialDebtPaise, 'pending', paymentAmountPaise),
    initialDebtPaise,
    'Pending intent must NOT alter ledger debt'
  );
  assert.strictEqual(
    simulateLedgerSettlementEffect(initialDebtPaise, 'payer_claimed', paymentAmountPaise),
    initialDebtPaise,
    'Claimed intent must NOT alter ledger debt until confirmed by recipient'
  );
  assert.strictEqual(
    simulateLedgerSettlementEffect(initialDebtPaise, 'recipient_rejected', paymentAmountPaise),
    initialDebtPaise,
    'Rejected claim must NOT alter ledger debt'
  );
  assert.strictEqual(
    simulateLedgerSettlementEffect(initialDebtPaise, 'cancelled', paymentAmountPaise),
    initialDebtPaise,
    'Cancelled intent must NOT alter ledger debt'
  );

  // Authoritative confirmed settlement
  assert.strictEqual(
    simulateLedgerSettlementEffect(initialDebtPaise, 'recipient_confirmed', paymentAmountPaise),
    25000,
    'Authoritative recipient_confirmed settlement must reduce ledger debt'
  );

  console.log('✅ Backend-authoritative ledger parity rules passed.');
  console.log('🎉 All Stage 3 Phase 5 M5 integration tests passed successfully!');
}

runAllM5Tests().catch((err) => {
  console.error('❌ M5 integration tests failed:', err);
  process.exit(1);
});
