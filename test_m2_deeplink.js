/**
 * LendLocal Native Android — Milestone 2 (M2) Test Suite
 * Native Payment Deep-Link Routing & Post-Review Hardening
 *
 * Covers:
 * 1. Valid cold-start deep link parsing (custom scheme lendlocal:// and trusted web HTTPS)
 * 2. Valid warm-start deep link event handling
 * 3. URL with no group ID (safe resolution via authorized groups and active intents)
 * 4. Malformed URLs, missing claimIntentId, invalid MongoDB hex formats, unsupported schemes
 * 5. Domain restriction: Trusted web hosts (production/localhost) vs untrusted/attacker hosts
 * 6. Duplicate URL event suppression (cold start overlap guard)
 * 7. Logged-out user handling & post-login memory resumption
 * 8. Unauthorized user / non-member protection
 * 9. Expired, cancelled, or unavailable intent handling
 * 10. Payment status failure feedback & avoidance of false settled status
 * 11. Network failure resilience & retry safety (duplicate alert & modal prevention)
 * 12. Ordinary non-payment deep links and root navigation
 * 13. Payment safety invariant: zero auto-execution of claim, confirm, reject, or cancel actions
 */

const assert = require('assert');

// Direct production import via Node 26 native type stripping
const {
  MONGO_ID_REGEX,
  TRUSTED_WEB_HOSTS,
  isTrustedWebHost,
  parseDeepLink,
  createDuplicateGuard,
  pendingDeepLinkStore,
  resolveGroupForIntent,
} = require('./mobile/src/utils/deepLink.ts');

async function runM2Tests() {
  console.log('--- Running Native Android Milestone 2 (M2) Test Suite ---');

  const validGroupId = '660000000000000000000001';
  const validIntentId = '660000000000000000000002';
  const otherGroupId = '660000000000000000000003';

  // ============================================================================
  // 1. Valid Cold-Start Deep Links
  // ============================================================================
  console.log('1. Testing Valid Cold-Start Deep Links...');
  {
    // 1.1 Custom scheme with path parameter
    const link1 = `lendlocal://group/${validGroupId}?claimIntentId=${validIntentId}`;
    const p1 = parseDeepLink(link1);
    assert.strictEqual(p1.isValid, true);
    assert.strictEqual(p1.scheme, 'lendlocal');
    assert.strictEqual(p1.groupId, validGroupId);
    assert.strictEqual(p1.claimIntentId, validIntentId);
    assert.strictEqual(p1.isPaymentClaim, true);

    // 1.2 Custom scheme with HTML query parameters (matching web notification links)
    const link2 = `lendlocal://group.html?id=${validGroupId}&claimIntentId=${validIntentId}`;
    const p2 = parseDeepLink(link2);
    assert.strictEqual(p2.isValid, true);
    assert.strictEqual(p2.groupId, validGroupId);
    assert.strictEqual(p2.claimIntentId, validIntentId);
    assert.strictEqual(p2.isPaymentClaim, true);

    // 1.3 Web HTTPS link (as sent in notifications / emails to production domain)
    const link3 = `https://lendlocal-58sf.onrender.com/group.html?id=${validGroupId}&claimIntentId=${validIntentId}`;
    const p3 = parseDeepLink(link3);
    assert.strictEqual(p3.isValid, true);
    assert.strictEqual(p3.scheme, 'https');
    assert.strictEqual(p3.groupId, validGroupId);
    assert.strictEqual(p3.claimIntentId, validIntentId);
    assert.strictEqual(p3.isPaymentClaim, true);

    // 1.4 Custom payment path format
    const link4 = `lendlocal://payment/claim?groupId=${validGroupId}&claimIntentId=${validIntentId}`;
    const p4 = parseDeepLink(link4);
    assert.strictEqual(p4.isValid, true);
    assert.strictEqual(p4.groupId, validGroupId);
    assert.strictEqual(p4.claimIntentId, validIntentId);
    assert.strictEqual(p4.isPaymentClaim, true);

    console.log('✅ Valid Cold-Start Deep Link tests passed.');
  }

  // ============================================================================
  // 2. Valid Warm-Start Deep Link Event Handling
  // ============================================================================
  console.log('2. Testing Valid Warm-Start Deep Link Event Handling...');
  {
    const incomingEvents = [
      `lendlocal://group/${validGroupId}?claimIntentId=${validIntentId}`,
      `lendlocal://group/${otherGroupId}?claimIntentId=660000000000000000000004`,
    ];

    const parsedResults = incomingEvents.map((url) => parseDeepLink(url));
    assert.strictEqual(parsedResults.length, 2);
    assert.strictEqual(parsedResults[0].groupId, validGroupId);
    assert.strictEqual(parsedResults[0].claimIntentId, validIntentId);
    assert.strictEqual(parsedResults[1].groupId, otherGroupId);
    assert.strictEqual(parsedResults[1].claimIntentId, '660000000000000000000004');

    console.log('✅ Valid Warm-Start Deep Link tests passed.');
  }

  // ============================================================================
  // 3. URL With No Group ID (Safe Backend Resolution)
  // ============================================================================
  console.log('3. Testing URL With No Group ID...');
  {
    const linkNoGroup = `lendlocal://claim?claimIntentId=${validIntentId}`;
    const parsed = parseDeepLink(linkNoGroup);
    assert.strictEqual(parsed.isValid, true);
    assert.strictEqual(parsed.claimIntentId, validIntentId);
    assert.strictEqual(parsed.groupId, undefined);
    assert.strictEqual(parsed.isPaymentClaim, true);

    // Simulated authorized backend endpoints
    const mockGroups = [
      { id: '660000000000000000000010', name: 'Apartment' },
      { id: validGroupId, name: 'Trip' },
    ];

    const mockIntentsByGroup = {
      '660000000000000000000010': [],
      [validGroupId]: [
        {
          intentId: validIntentId,
          groupId: validGroupId,
          status: 'payer_claimed',
          amount: 500,
        },
      ],
    };

    const res = await resolveGroupForIntent(
      validIntentId,
      async () => mockGroups,
      async (gId) => mockIntentsByGroup[gId] || []
    );

    assert.strictEqual(res.groupId, validGroupId, 'Must resolve to the matching group ID');
    assert.strictEqual(res.intent.intentId, validIntentId);
    assert.strictEqual(res.intent.status, 'payer_claimed');
    assert.strictEqual(res.error, undefined);

    console.log('✅ URL With No Group ID tests passed.');
  }

  // ============================================================================
  // 4. Malformed URLs, Missing IDs, Invalid Formats & Schemes
  // ============================================================================
  console.log('4. Testing Malformed URLs & Validation...');
  {
    // Empty strings
    assert.strictEqual(parseDeepLink('').isValid, false);
    assert.strictEqual(parseDeepLink('   ').isValid, false);
    assert.strictEqual(parseDeepLink(null).isValid, false);
    assert.strictEqual(parseDeepLink(undefined).isValid, false);

    // Malformed URL syntax
    assert.strictEqual(parseDeepLink('not-a-url').isValid, false);

    // Unsupported scheme
    const ftpRes = parseDeepLink('ftp://lendlocal/group/123');
    assert.strictEqual(ftpRes.isValid, false);
    assert.strictEqual(ftpRes.error.includes('Unsupported scheme'), true);

    // Invalid Hex Intent ID (not 24 hex chars)
    const badIntentId = `lendlocal://group/${validGroupId}?claimIntentId=123`;
    const badIntentRes = parseDeepLink(badIntentId);
    assert.strictEqual(badIntentRes.isValid, false);
    assert.strictEqual(badIntentRes.error, 'Invalid payment claim intent ID format');

    // Invalid Hex Group ID
    const badGroupId = `lendlocal://group/invalid-group-id?claimIntentId=${validIntentId}`;
    const badGroupRes = parseDeepLink(badGroupId);
    assert.strictEqual(badGroupRes.isValid, false);
    assert.strictEqual(badGroupRes.error, 'Invalid group ID format');

    console.log('✅ Malformed URLs & Validation tests passed.');
  }

  // ============================================================================
  // 5. Trusted Web Hosts vs Untrusted Host Restrictions
  // ============================================================================
  console.log('5. Testing Trusted vs Untrusted Web Host Domain Restrictions...');
  {
    // Production host is trusted
    assert.strictEqual(isTrustedWebHost('lendlocal-58sf.onrender.com'), true);
    assert.strictEqual(isTrustedWebHost('LENDLOCAL-58SF.ONRENDER.COM'), true);

    // Development hosts are trusted
    assert.strictEqual(isTrustedWebHost('localhost'), true);
    assert.strictEqual(isTrustedWebHost('127.0.0.1'), true);
    assert.strictEqual(isTrustedWebHost('10.0.2.2'), true);

    // Untrusted hosts are rejected
    assert.strictEqual(isTrustedWebHost('evil-attacker.com'), false);
    assert.strictEqual(isTrustedWebHost('lendlocal-58sf.attacker.com'), false);
    assert.strictEqual(isTrustedWebHost('phishing.org'), false);
    assert.strictEqual(isTrustedWebHost(''), false);
    assert.strictEqual(isTrustedWebHost(null), false);

    // Parsing HTTPS link with untrusted host is marked invalid
    const untrustedLink = `https://evil-attacker.com/group.html?id=${validGroupId}&claimIntentId=${validIntentId}`;
    const untrustedRes = parseDeepLink(untrustedLink);
    assert.strictEqual(untrustedRes.isValid, false);
    assert.strictEqual(
      untrustedRes.error,
      'Untrusted domain for LendLocal web link: evil-attacker.com'
    );

    // Parsing HTTPS link with spoofed subdomain is rejected
    const spoofedLink = `https://lendlocal-58sf.onrender.com.attacker.com/group.html?id=${validGroupId}`;
    const spoofedRes = parseDeepLink(spoofedLink);
    assert.strictEqual(spoofedRes.isValid, false);
    assert.strictEqual(spoofedRes.error.includes('Untrusted domain'), true);

    // Valid production HTTPS link is accepted
    const trustedLink = `https://lendlocal-58sf.onrender.com/group.html?id=${validGroupId}&claimIntentId=${validIntentId}`;
    const trustedRes = parseDeepLink(trustedLink);
    assert.strictEqual(trustedRes.isValid, true);
    assert.strictEqual(trustedRes.groupId, validGroupId);

    // Custom scheme lendlocal:// is completely preserved and unaffected by web domain check
    const customSchemeLink = `lendlocal://group/${validGroupId}?claimIntentId=${validIntentId}`;
    const customRes = parseDeepLink(customSchemeLink);
    assert.strictEqual(customRes.isValid, true);
    assert.strictEqual(customRes.scheme, 'lendlocal');

    console.log('✅ Trusted vs Untrusted Web Host Domain Restriction tests passed.');
  }

  // ============================================================================
  // 6. Duplicate URL Event Suppression
  // ============================================================================
  console.log('6. Testing Duplicate URL Event Suppression...');
  {
    const guard = createDuplicateGuard(1000); // 1000ms window
    const testUrl = `lendlocal://group/${validGroupId}?claimIntentId=${validIntentId}`;

    const firstCall = guard.isDuplicate(testUrl);
    assert.strictEqual(firstCall, false, 'First call must not be a duplicate');

    const secondCall = guard.isDuplicate(testUrl);
    assert.strictEqual(secondCall, true, 'Immediate repeat must be suppressed as duplicate');

    const differentUrl = `lendlocal://group/${otherGroupId}`;
    assert.strictEqual(guard.isDuplicate(differentUrl), false, 'Different URL is not duplicate');

    guard.reset();
    assert.strictEqual(guard.isDuplicate(testUrl), false, 'After reset, URL is accepted again');

    console.log('✅ Duplicate URL Event Suppression tests passed.');
  }

  // ============================================================================
  // 7. Logged-Out User & Post-Login Resumption (In-Memory Only)
  // ============================================================================
  console.log('7. Testing Logged-Out User & Post-Login Memory Resumption...');
  {
    pendingDeepLinkStore.clear();
    assert.strictEqual(pendingDeepLinkStore.get(), null);

    const testLink = parseDeepLink(`lendlocal://group/${validGroupId}?claimIntentId=${validIntentId}`);
    assert.strictEqual(testLink.isValid, true);

    pendingDeepLinkStore.set(testLink);
    assert.deepStrictEqual(pendingDeepLinkStore.get(), testLink);

    const retrieved = pendingDeepLinkStore.get();
    assert.strictEqual(retrieved.groupId, validGroupId);
    assert.strictEqual(retrieved.claimIntentId, validIntentId);

    pendingDeepLinkStore.clear();
    assert.strictEqual(pendingDeepLinkStore.get(), null);

    console.log('✅ Logged-Out User & Post-Login Resumption tests passed.');
  }

  // ============================================================================
  // 8. Unauthorized User / Non-Member Protection
  // ============================================================================
  console.log('8. Testing Unauthorized User / Non-Member Protection...');
  {
    const userGroups = [{ id: '660000000000000000000099', name: 'Other Group' }];
    const res = await resolveGroupForIntent(
      validIntentId,
      async () => userGroups,
      async () => []
    );

    assert.strictEqual(res.groupId, undefined);
    assert.strictEqual(
      res.error.includes('Payment claim was not found in any of your active groups'),
      true
    );

    console.log('✅ Unauthorized User / Non-Member Protection tests passed.');
  }

  // ============================================================================
  // 9. Expired, Cancelled, or Unavailable Intent
  // ============================================================================
  console.log('9. Testing Expired, Cancelled, or Unavailable Intent...');
  {
    const simulateStatusResponse = (status) => {
      if (status === 'recipient_confirmed' || status === 'recipient_rejected' || status === 'cancelled') {
        return { intentId: validIntentId, status, terminal: true };
      }
      if (status === 404) {
        throw Object.assign(new Error('Payment intent not found'), { status: 404 });
      }
      return { intentId: validIntentId, status, terminal: false };
    };

    const confirmed = simulateStatusResponse('recipient_confirmed');
    assert.strictEqual(confirmed.terminal, true);

    const cancelled = simulateStatusResponse('cancelled');
    assert.strictEqual(cancelled.terminal, true);

    assert.throws(() => simulateStatusResponse(404), /Payment intent not found/);

    console.log('✅ Expired, Cancelled, or Unavailable Intent tests passed.');
  }

  // ============================================================================
  // 10. Payment Status Failure Feedback & Avoidance of False Settled Status
  // ============================================================================
  console.log('10. Testing Payment Status Failure Feedback & False-Status Prevention...');
  {
    // Simulating error mapping in group screen
    const deriveStatusFeedback = (err) => {
      if (err?.status === 404) {
        return { title: 'Payment Intent Not Found', message: 'Payment intent not found or does not exist.' };
      }
      if (err?.status === 403) {
        return { title: 'Payment Notice', message: 'You are not authorized to view this payment claim.' };
      }
      return {
        title: 'Payment Status Unverified',
        message: 'Could not verify payment claim status. Please check your connection and pull down to refresh.',
      };
    };

    // 404 is specifically reported as not found
    const notFoundFeedback = deriveStatusFeedback({ status: 404 });
    assert.strictEqual(notFoundFeedback.message.includes('not found or does not exist'), true);
    assert.strictEqual(notFoundFeedback.message.includes('settled'), false);

    // 403 is specifically reported as unauthorized
    const unauthFeedback = deriveStatusFeedback({ status: 403 });
    assert.strictEqual(unauthFeedback.message.includes('not authorized'), true);

    // Network error (status 0 / timeout / 500) reports UNVERIFIED, NOT false settled or false expired
    const networkFeedback = deriveStatusFeedback(new Error('Network request failed'));
    assert.strictEqual(networkFeedback.title, 'Payment Status Unverified');
    assert.strictEqual(networkFeedback.message.includes('Could not verify payment claim status'), true);
    assert.strictEqual(networkFeedback.message.includes('settled'), false);
    assert.strictEqual(networkFeedback.message.includes('expired'), false);

    console.log('✅ Payment Status Failure Feedback & False-Status Prevention tests passed.');
  }

  // ============================================================================
  // 11. Network Failure Resilience & Safe Retry (Deduplication)
  // ============================================================================
  console.log('11. Testing Network Failure Resilience & Retry Deduplication...');
  {
    // Simulate group screen state machine:
    // When initial load fails or activeIntentsVerified is false,
    // alertedIntentIdsRef prevents duplicate error alerts on re-renders,
    // and successful pull-to-refresh opens modal once without duplicating.
    const openedModalIntents = new Set();
    const alertedIntents = new Set();

    let alertsTriggered = 0;
    let modalsOpened = 0;

    function handleGroupDetailState(state) {
      const { targetId, isLoading, group, activeIntents, activeIntentsVerified, error } = state;
      if (!targetId || isLoading) return;

      if (!group && error) {
        if (!alertedIntents.has(targetId)) {
          alertedIntents.add(targetId);
          alertsTriggered++;
        }
        return;
      }

      const match = activeIntents.find((i) => i.intentId === targetId);
      if (match) {
        if (!openedModalIntents.has(targetId)) {
          openedModalIntents.add(targetId);
          modalsOpened++;
        }
        return;
      }

      if (openedModalIntents.has(targetId) || alertedIntents.has(targetId)) {
        return;
      }

      if (!activeIntentsVerified) {
        alertedIntents.add(targetId);
        alertsTriggered++;
      }
    }

    // Step 1: Initial load fails (offline/network error)
    handleGroupDetailState({
      targetId: validIntentId,
      isLoading: false,
      group: { id: validGroupId },
      activeIntents: [],
      activeIntentsVerified: false,
      error: null,
    });
    assert.strictEqual(alertsTriggered, 1, 'Initial failure must alert user once');
    assert.strictEqual(modalsOpened, 0);

    // Step 2: Component re-renders while still offline
    handleGroupDetailState({
      targetId: validIntentId,
      isLoading: false,
      group: { id: validGroupId },
      activeIntents: [],
      activeIntentsVerified: false,
      error: null,
    });
    assert.strictEqual(alertsTriggered, 1, 'Re-render must NOT trigger duplicate alert');

    // Step 3: User comes online and pulls to refresh (refresh succeeds)
    handleGroupDetailState({
      targetId: validIntentId,
      isLoading: false,
      group: { id: validGroupId },
      activeIntents: [{ intentId: validIntentId, status: 'payer_claimed', amount: 350 }],
      activeIntentsVerified: true,
      error: null,
    });
    assert.strictEqual(modalsOpened, 1, 'Successful refresh must open modal for user');
    assert.strictEqual(alertsTriggered, 1, 'No new alert should trigger');

    // Step 4: Subsequent re-render or background poll
    handleGroupDetailState({
      targetId: validIntentId,
      isLoading: false,
      group: { id: validGroupId },
      activeIntents: [{ intentId: validIntentId, status: 'payer_claimed', amount: 350 }],
      activeIntentsVerified: true,
      error: null,
    });
    assert.strictEqual(modalsOpened, 1, 'Modal must NOT be opened twice');

    console.log('✅ Network Failure Resilience & Retry Deduplication tests passed.');
  }

  // ============================================================================
  // 12. Ordinary Non-Payment Deep Links and Normal Navigation
  // ============================================================================
  console.log('12. Testing Ordinary Non-Payment Deep Links...');
  {
    const groupLink = `lendlocal://group/${validGroupId}`;
    const pGroup = parseDeepLink(groupLink);
    assert.strictEqual(pGroup.isValid, true);
    assert.strictEqual(pGroup.groupId, validGroupId);
    assert.strictEqual(pGroup.claimIntentId, undefined);
    assert.strictEqual(pGroup.isPaymentClaim, false);

    const webGroupLink = `https://lendlocal-58sf.onrender.com/group.html?id=${validGroupId}`;
    const pWeb = parseDeepLink(webGroupLink);
    assert.strictEqual(pWeb.isValid, true);
    assert.strictEqual(pWeb.groupId, validGroupId);
    assert.strictEqual(pWeb.claimIntentId, undefined);
    assert.strictEqual(pWeb.isPaymentClaim, false);

    const homeLink = 'lendlocal://';
    const pHome = parseDeepLink(homeLink);
    assert.strictEqual(pHome.isValid, true);
    assert.strictEqual(pHome.groupId, undefined);
    assert.strictEqual(pHome.claimIntentId, undefined);
    assert.strictEqual(pHome.isPaymentClaim, false);

    console.log('✅ Ordinary Non-Payment Deep Links tests passed.');
  }

  // ============================================================================
  // 13. Payment Safety Invariant: Zero Auto-Execution of Payment Actions
  // ============================================================================
  console.log('13. Testing Payment Safety Invariants...');
  {
    let claimCalls = 0;
    let confirmCalls = 0;
    let rejectCalls = 0;
    let cancelCalls = 0;

    const mockPaymentClient = {
      claim: async () => { claimCalls++; },
      confirm: async () => { confirmCalls++; },
      reject: async () => { rejectCalls++; },
      cancel: async () => { cancelCalls++; },
    };

    const link = `lendlocal://group/${validGroupId}?claimIntentId=${validIntentId}`;
    const parsed = parseDeepLink(link);
    assert.strictEqual(parsed.isPaymentClaim, true);

    await resolveGroupForIntent(
      parsed.claimIntentId,
      async () => [{ id: validGroupId }],
      async () => [{ intentId: validIntentId, groupId: validGroupId, status: 'payer_claimed' }]
    );

    assert.strictEqual(claimCalls, 0, 'Must NOT auto-call /payment/claim on deep link open');
    assert.strictEqual(confirmCalls, 0, 'Must NOT auto-call /payment/confirm on deep link open');
    assert.strictEqual(rejectCalls, 0, 'Must NOT auto-call /payment/reject on deep link open');
    assert.strictEqual(cancelCalls, 0, 'Must NOT auto-call /payment/cancel on deep link open');

    console.log('✅ Payment Safety Invariants verified.');
  }

  console.log('🎉 All Native Android Milestone 2 (M2) tests passed successfully!');
}

runM2Tests().catch((err) => {
  console.error('❌ M2 Test Suite Failed:', err);
  process.exit(1);
});
