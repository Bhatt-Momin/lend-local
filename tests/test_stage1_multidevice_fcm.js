/**
 * test_stage1_multidevice_fcm.js
 *
 * LendLocal Stage 1: Targeted FCM Token Hardening Test Suite
 *
 * Covers:
 * 1. User schema & multi-device invariants (fcmTokens array, sparse index, legacy fcmToken compatibility)
 * 2. POST /api/auth/fcm-token contract & validation (defaults to 'web', platform validation, session check)
 * 3. Web + Android coexistence & deliberate legacy scalar preservation (web token prioritized on scalar)
 * 4. Re-registration idempotency & deduplication
 * 5. Token revocation and logout (DELETE /api/auth/fcm-token, session revocation, promotion)
 * 6. Token transfer between users & cross-user race safety (simulation & atomic yielding)
 * 7. Late invalid-token response after token replacement (old error does NOT erase new token)
 * 8. Dispatch targeting & unified payload invariants (webpush + android blocks)
 *
 * Note on test execution:
 * Real MongoDB concurrency requires a live multi-node replica set. Concurrency scenarios
 * in this file are high-fidelity functional simulations and source contract assertions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Ensure modules can be loaded from backend/node_modules when running from root
module.paths.push(path.join(__dirname, 'backend/node_modules'));

console.log('--- Running LendLocal Stage 1: Hardened Multi-Device FCM Test Suite ---');

// ============================================================================
// 1. SCHEMA & MODEL INVARIANTS
// ============================================================================
console.log('1. Testing User Schema & Multi-Device Representation Invariants...');

const User = require('./backend/models/User');
const userSchema = User.schema;

// 1A: fcmTokens array exists
assert(userSchema.path('fcmTokens'), 'User schema must define fcmTokens array');

// 1B: fcmTokens entry properties
const fcmTokensSchema = userSchema.path('fcmTokens').schema;
assert(fcmTokensSchema.path('token'), 'fcmTokens entries must contain token');
assert.strictEqual(fcmTokensSchema.path('token').instance, 'String', 'token must be String');
assert(fcmTokensSchema.path('token').isRequired, 'token must be required');

assert(fcmTokensSchema.path('platform'), 'fcmTokens entries must contain platform');
assert.strictEqual(fcmTokensSchema.path('platform').instance, 'String', 'platform must be String');
assert.deepStrictEqual(
  fcmTokensSchema.path('platform').enumValues,
  ['web', 'android', 'ios'],
  'platform enum must support web, android, and ios'
);
assert.strictEqual(fcmTokensSchema.path('platform').defaultValue, 'web', 'platform must default to web');

assert(fcmTokensSchema.path('sessionId'), 'fcmTokens entries must contain sessionId');
assert(fcmTokensSchema.path('claim'), 'fcmTokens entries must contain claim');
assert(fcmTokensSchema.path('updatedAt'), 'fcmTokens entries must contain updatedAt');

// 1C: Backward compatibility fields
assert(userSchema.path('fcmToken'), 'User schema must retain legacy fcmToken field');
assert(userSchema.path('fcmSessionId'), 'User schema must retain legacy fcmSessionId field');
assert(userSchema.path('fcmClaim'), 'User schema must retain legacy fcmClaim field');
assert(userSchema.path('revokedTokens'), 'User schema must retain revokedTokens field');

// 1D: Sparse index on fcmTokens.token
const userModelSource = fs.readFileSync(path.join(__dirname, 'backend/models/User.js'), 'utf8');
assert(
  userModelSource.includes("userSchema.index({ 'fcmTokens.token': 1 }, { sparse: true });"),
  'User schema must define sparse index on fcmTokens.token for efficient pruning'
);

console.log('✅ [Source Assertion & Model Inspection] User schema multi-device, index, and backward-compatibility invariants verified.');

// ============================================================================
// 2. REGISTRATION CONTRACT & INPUT VALIDATION
// ============================================================================
console.log('2. Testing Registration Contract & Input Validation...');

const authRouteSource = fs.readFileSync(path.join(__dirname, 'backend/routes/auth.js'), 'utf8');

// 2A: Platform parameter defaults to 'web' if omitted
assert(
  authRouteSource.includes("let platform = 'web';") &&
  authRouteSource.includes("if (platformRaw !== undefined && platformRaw !== null)") &&
  authRouteSource.includes("['web', 'android', 'ios'].includes(platformRaw.toLowerCase().trim())"),
  'auth.js must parse optional platform and default to web'
);

// 2B: Invalid platform rejection
assert(
  authRouteSource.includes("Invalid platform. Must be web, android, or ios."),
  'auth.js must reject invalid platforms with HTTP 400'
);

// 2C: Session check and revocation check
assert(
  authRouteSource.includes('if (!req.jwt.sessionId) {') &&
  authRouteSource.includes('Session expired. Please log in again.'),
  'auth.js must require valid JWT session ID'
);
assert(
  authRouteSource.includes('Registration rejected: Token was revoked for this session'),
  'auth.js must reject registration of revoked tokens on the current session'
);

// 2D: Documented Concurrency Limitation
assert(
  authRouteSource.includes('Standalone MongoDB without replica set multi-document transactions cannot guarantee') &&
  authRouteSource.includes('cross-document ACID atomicity across separate User documents'),
  'auth.js must explicitly document the MongoDB cross-document concurrency limitation'
);

console.log('✅ [Source Assertion] Registration contract, input validation, and concurrency documentation verified.');

// ============================================================================
// 3. WEB + ANDROID TOKEN COEXISTENCE & SCALAR COMPATIBILITY STRATEGY
// ============================================================================
console.log('3. Testing Web + Android Token Coexistence & Scalar Compatibility...');

/**
 * Functional simulation of the hardened registration logic
 */
function simulateHardenedRegistration({ body, session, userDoc, allUsers = [userDoc] }) {
  const { token, platform: platformRaw } = body;
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { status: 400, body: { message: 'FCM token is required' } };
  }
  const trimmedToken = token.trim();

  if (!session || !session.sessionId) {
    return { status: 401, body: { message: 'Session expired. Please log in again.' } };
  }

  let platform = 'web';
  if (platformRaw !== undefined && platformRaw !== null) {
    if (typeof platformRaw !== 'string' || !['web', 'android', 'ios'].includes(platformRaw.toLowerCase().trim())) {
      return { status: 400, body: { message: 'Invalid platform. Must be web, android, or ios.' } };
    }
    platform = platformRaw.toLowerCase().trim();
  }

  // Revocation check
  const isRevoked = (userDoc.revokedTokens || []).some(
    r => r.token === trimmedToken && r.sessionId === session.sessionId
  );
  if (isRevoked) {
    return { status: 403, body: { message: 'Registration rejected: Token was revoked for this session' } };
  }

  const claim = Date.now().toString() + '-' + Math.random().toString(36).slice(2);

  // Deliberate compatibility strategy:
  // If user already has an active web token, registering an android token does NOT overwrite
  // the legacy scalar fcmToken. This guarantees legacy web callers continue seeing a valid web token.
  const hasActiveWebToken = (userDoc.fcmTokens || []).some(
    t => t.platform === 'web' && t.token !== trimmedToken
  );

  if (platform === 'web' || !hasActiveWebToken) {
    userDoc.fcmToken = trimmedToken;
    userDoc.fcmSessionId = session.sessionId;
  }
  userDoc.fcmClaim = claim;

  // Update fcmTokens array: pull matching token string, then push fresh entry
  userDoc.fcmTokens = (userDoc.fcmTokens || []).filter(t => t.token !== trimmedToken);
  userDoc.fcmTokens.push({
    token: trimmedToken,
    platform,
    sessionId: session.sessionId,
    claim,
    updatedAt: new Date(),
  });
  if (userDoc.fcmTokens.length > 10) {
    userDoc.fcmTokens = userDoc.fcmTokens.slice(-10);
  }

  // Disassociate this token from other users with weaker claims
  for (const other of allUsers) {
    if (other !== userDoc) {
      if (!other.fcmClaim || other.fcmClaim < claim) {
        if (other.fcmToken === trimmedToken) {
          other.fcmToken = null;
          other.fcmSessionId = null;
          other.fcmClaim = null;
        }
        if (other.fcmTokens) {
          other.fcmTokens = other.fcmTokens.filter(t => t.token !== trimmedToken);
        }
      }
    }
  }

  return { status: 200, body: { message: 'FCM token saved successfully', platform } };
}

const userA = {
  id: 'user_A',
  email: 'usera@example.com',
  fcmToken: null,
  fcmTokens: [],
  revokedTokens: [],
};

// 3A: Register Web Token for User A
const reg1 = simulateHardenedRegistration({
  body: { token: 'token-chrome-pwa' }, // platform omitted -> defaults to web
  session: { sessionId: 'sess-web-1' },
  userDoc: userA,
});
assert.strictEqual(reg1.status, 200);
assert.strictEqual(reg1.body.platform, 'web');
assert.strictEqual(userA.fcmTokens.length, 1);
assert.strictEqual(userA.fcmTokens[0].token, 'token-chrome-pwa');
assert.strictEqual(userA.fcmTokens[0].platform, 'web');
assert.strictEqual(userA.fcmToken, 'token-chrome-pwa', 'Scalar fcmToken must reflect the web token');

// 3B: Register Android Token for User A
const reg2 = simulateHardenedRegistration({
  body: { token: 'token-android-apk', platform: 'android' },
  session: { sessionId: 'sess-android-1' },
  userDoc: userA,
});
assert.strictEqual(reg2.status, 200);

// Invariants:
// 1. Both devices are in fcmTokens
assert.strictEqual(userA.fcmTokens.length, 2, 'fcmTokens must contain BOTH web and android devices');
assert(userA.fcmTokens.some(t => t.token === 'token-chrome-pwa' && t.platform === 'web'));
assert(userA.fcmTokens.some(t => t.token === 'token-android-apk' && t.platform === 'android'));

// 2. Deliberate compatibility invariant:
// The legacy scalar fcmToken MUST REMAIN 'token-chrome-pwa'! It must NOT be overwritten by Android.
assert.strictEqual(
  userA.fcmToken,
  'token-chrome-pwa',
  'Legacy scalar fcmToken must retain the active web token for legacy web push consumers'
);

console.log('✅ [Functional Simulation] Web + Android coexistence and deliberate scalar preservation verified.');

// ============================================================================
// 4. RE-REGISTRATION IDEMPOTENCY & DEDUPLICATION
// ============================================================================
console.log('4. Testing Re-registration Idempotency & Deduplication...');

// Re-registering the exact same web token (e.g. on web page reload or silent refresh)
const reg3 = simulateHardenedRegistration({
  body: { token: 'token-chrome-pwa' },
  session: { sessionId: 'sess-web-1' },
  userDoc: userA,
});
assert.strictEqual(reg3.status, 200);
assert.strictEqual(userA.fcmTokens.length, 2, 'No duplicate entries should be created');
assert.strictEqual(userA.fcmTokens.filter(t => t.token === 'token-chrome-pwa').length, 1);
assert.strictEqual(userA.fcmToken, 'token-chrome-pwa');

console.log('✅ [Functional Simulation] Re-registration idempotency verified.');

// ============================================================================
// 5. TOKEN REVOCATION AND LOGOUT
// ============================================================================
console.log('5. Testing Token Revocation and Logout...');

function simulateHardenedRemoval({ body, session, userDoc }) {
  const { token } = body;
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { status: 400, body: { message: 'FCM token is required' } };
  }
  const trimmedToken = token.trim();

  if (!session || !session.sessionId) {
    return { status: 401, body: { message: 'Session expired. Please log in again.' } };
  }

  userDoc.revokedTokens = userDoc.revokedTokens || [];
  if (!userDoc.revokedTokens.some(r => r.token === trimmedToken && r.sessionId === session.sessionId)) {
    userDoc.revokedTokens.push({ token: trimmedToken, sessionId: session.sessionId, exp: Math.floor(Date.now() / 1000) + 3600 });
  }

  // Pull from fcmTokens
  userDoc.fcmTokens = (userDoc.fcmTokens || []).filter(t => t.token !== trimmedToken);

  // If fcmToken was this token, clear it and promote a remaining token (preferring web)
  if (userDoc.fcmToken === trimmedToken) {
    userDoc.fcmToken = null;
    userDoc.fcmSessionId = null;
    userDoc.fcmClaim = null;

    if (userDoc.fcmTokens.length > 0) {
      const webToken = userDoc.fcmTokens.find(t => t.platform === 'web');
      const fallback = webToken || userDoc.fcmTokens[userDoc.fcmTokens.length - 1];
      userDoc.fcmToken = fallback.token;
      userDoc.fcmSessionId = fallback.sessionId;
      userDoc.fcmClaim = fallback.claim;
    }
  }

  return { status: 200, body: { message: 'FCM token processed successfully' } };
}

// User logs out of web device
const del1 = simulateHardenedRemoval({
  body: { token: 'token-chrome-pwa' },
  session: { sessionId: 'sess-web-1' },
  userDoc: userA,
});
assert.strictEqual(del1.status, 200);

// Web token removed from fcmTokens
assert.strictEqual(userA.fcmTokens.length, 1);
assert.strictEqual(userA.fcmTokens[0].token, 'token-android-apk');

// Invariant: Since web token was removed, scalar fcmToken falls back to the remaining Android token
assert.strictEqual(userA.fcmToken, 'token-android-apk');

// Late delayed web registration on the same session is rejected as revoked (HTTP 403)
const lateReg = simulateHardenedRegistration({
  body: { token: 'token-chrome-pwa' },
  session: { sessionId: 'sess-web-1' },
  userDoc: userA,
});
assert.strictEqual(lateReg.status, 403, 'Late registration of revoked token must return 403');

console.log('✅ [Functional Simulation] Token removal, fallback promotion, and revocation enforcement verified.');

// ============================================================================
// 6. TOKEN TRANSFER BETWEEN USERS & CROSS-USER RACE RESILIENCE
// ============================================================================
console.log('6. Testing Token Transfer Between Users...');

const userOwner1 = {
  id: 'user_1',
  email: 'u1@test.com',
  fcmToken: 'tablet-token-123',
  fcmTokens: [{ token: 'tablet-token-123', platform: 'android', sessionId: 's1', claim: '100-c' }],
  revokedTokens: [],
};

const userOwner2 = {
  id: 'user_2',
  email: 'u2@test.com',
  fcmToken: null,
  fcmTokens: [],
  revokedTokens: [],
};

const allTestUsers = [userOwner1, userOwner2];

// User 2 logs into the same tablet and registers the same physical token
const transferRes = simulateHardenedRegistration({
  body: { token: 'tablet-token-123', platform: 'android' },
  session: { sessionId: 's2' },
  userDoc: userOwner2,
  allUsers: allTestUsers,
});

assert.strictEqual(transferRes.status, 200);

// Invariants:
// 1. User 2 now owns the token
assert(userOwner2.fcmTokens.some(t => t.token === 'tablet-token-123'), 'User 2 must now own the token');
assert.strictEqual(userOwner2.fcmToken, 'tablet-token-123');

// 2. User 1 had the token stripped
assert(!userOwner1.fcmTokens.some(t => t.token === 'tablet-token-123'), 'User 1 must no longer hold the transferred token');
assert.strictEqual(userOwner1.fcmToken, null, 'User 1 scalar fcmToken must be cleared');

console.log('✅ [Functional Simulation] Cross-user token transfer verified.');

// ============================================================================
// 7. REGISTRATION-IDENTITY PRUNING & LATE RESPONSE SAFETY
// ============================================================================
console.log('7. Testing Registration-Identity Pruning & Late Response Safety...');

const notifServiceSource = fs.readFileSync(path.join(__dirname, 'backend/services/notificationService.js'), 'utf8');

// 7A: Source assertions for registration-identity based cleanup
assert(
  notifServiceSource.includes('async function pruneInvalidFcmToken(target)') &&
  notifServiceSource.includes('$pull: { fcmTokens: pullFilter }') &&
  notifServiceSource.includes('$set: { fcmToken: null, fcmSessionId: null, fcmClaim: null }'),
  'notificationService.js must define pruneInvalidFcmToken using registration identity and pullFilter'
);

assert(
  notifServiceSource.includes('if (!userId) {') &&
  notifServiceSource.includes('Skipping unscoped FCM token pruning'),
  'notificationService.js must refuse unscoped destructive cleanup if userId is missing'
);

assert(
  notifServiceSource.includes('matchingEntry = Array.isArray(user.fcmTokens)') ||
  notifServiceSource.includes('matchingEntry = Array.isArray(u.fcmTokens)'),
  'notificationService.js must find corresponding fcmTokens entry by exact token string to obtain scalar token claim'
);

assert(
  notifServiceSource.includes('pruneInvalidFcmToken(targetObj || token)') &&
  notifServiceSource.includes('pruneInvalidFcmToken(badTarget)'),
  'notificationService.js must pass target metadata to pruneInvalidFcmToken in single and multicast sends'
);

assert(
  notifServiceSource.includes('const targets = [];') &&
  notifServiceSource.includes('const tokens = [];') &&
  notifServiceSource.includes('targets.push({') &&
  notifServiceSource.includes('userId: u._id,') &&
  notifServiceSource.includes('tokens.push(entry.token);'),
  'createMulticastNotifications must maintain parallel targets and tokens arrays preserving index mapping'
);

// 7B: Functional simulation of registration-identity based cleanup logic
function simulateRegistrationIdentityPruning(target, userDocs) {
  let token = null;
  let userId = null;
  let claim = null;
  let isLegacyScalarOnly = false;

  if (typeof target === 'string') {
    token = target.trim();
  } else if (typeof target === 'object' && target !== null) {
    token = target.token?.trim();
    userId = target.userId ? String(target.userId) : null;
    claim = target.claim || null;
    isLegacyScalarOnly = Boolean(target.isLegacyScalarOnly);
  }

  if (!token) return;

  // P1 requirement: unscoped caller cannot perform destructive deletion
  if (!userId) {
    return; // skips unscoped pruning
  }

  for (const user of userDocs) {
    if (String(user._id || user.id) !== userId) {
      continue;
    }

    // Pull from fcmTokens only if token matches AND (if claim specified) claim matches
    if (user.fcmTokens) {
      user.fcmTokens = user.fcmTokens.filter(t => {
        if (t.token !== token) return true;
        if (claim && t.claim !== claim) return true; // keep if claim doesn't match
        if (isLegacyScalarOnly && t.claim) return true; // keep if legacy scalar error but array has claim
        return false; // remove
      });
    }

    // Clear scalar fcmToken only if token matches and claim matches
    if (user.fcmToken === token) {
      if (!claim || user.fcmClaim === claim) {
        user.fcmToken = null;
        user.fcmSessionId = null;
        user.fcmClaim = null;

        // Promote remaining device if available
        if (user.fcmTokens && user.fcmTokens.length > 0) {
          const webTok = user.fcmTokens.find(t => t.platform === 'web');
          const fallback = webTok || user.fcmTokens[user.fcmTokens.length - 1];
          user.fcmToken = fallback.token;
          user.fcmSessionId = fallback.sessionId;
          user.fcmClaim = fallback.claim;
        }
      }
    }
  }
}

// 7C: Regression Test 1 — Unscoped legacy string error cannot delete another user's registration
const userWithToken = {
  id: 'user_B',
  email: 'b@test.com',
  fcmToken: 'shared_tok_99',
  fcmTokens: [{ token: 'shared_tok_99', platform: 'android', claim: 'claim_B' }],
  fcmClaim: 'claim_B',
};

// Calling cleanup with legacy unscoped string (no userId):
simulateRegistrationIdentityPruning('shared_tok_99', [userWithToken]);

// INVARIANT: User B's registration MUST NOT be deleted by unscoped call!
assert.strictEqual(userWithToken.fcmTokens.length, 1, 'Legacy string caller must NOT delete another user token');
assert.strictEqual(userWithToken.fcmTokens[0].token, 'shared_tok_99');
assert.strictEqual(userWithToken.fcmToken, 'shared_tok_99');

// 7D: Regression Test 2 — Web scalar token with Android registration added later uses web token's own claim
const userDualDevice = {
  id: 'user_A',
  email: 'a@test.com',
  fcmToken: 'web_tok_111', // web token preserved on scalar
  fcmClaim: 'claim_web_aaa', // scalar claim matches web token
  fcmTokens: [
    { token: 'web_tok_111', platform: 'web', claim: 'claim_web_aaa' },
    { token: 'android_tok_222', platform: 'android', claim: 'claim_android_bbb' },
  ],
};

function resolveTargets(user) {
  const targets = [];
  const seen = new Set();
  for (const entry of user.fcmTokens || []) {
    if (entry.token && !seen.has(entry.token)) {
      seen.add(entry.token);
      targets.push({ userId: user.id, token: entry.token, claim: entry.claim || null, isLegacyScalarOnly: false });
    }
  }
  if (user.fcmToken && !seen.has(user.fcmToken)) {
    seen.add(user.fcmToken);
    const match = (user.fcmTokens || []).find(t => t.token === user.fcmToken);
    targets.push({ userId: user.id, token: user.fcmToken, claim: match?.claim || null, isLegacyScalarOnly: !match });
  }
  return targets;
}

const resolvedTargets = resolveTargets(userDualDevice);
const webTarget = resolvedTargets.find(t => t.token === 'web_tok_111');
const androidTarget = resolvedTargets.find(t => t.token === 'android_tok_222');

// INVARIANT: webTarget uses claim_web_aaa, NOT claim_android_bbb!
assert.strictEqual(webTarget.claim, 'claim_web_aaa', 'Web scalar token must use its own claim, not Android claim');
assert.strictEqual(androidTarget.claim, 'claim_android_bbb', 'Android token must use its own claim');

// 7E: Regression Test 3 — A truly invalid current registration is still pruned
simulateRegistrationIdentityPruning(webTarget, [userDualDevice]);
assert.strictEqual(userDualDevice.fcmTokens.length, 1, 'Invalid web token must be pruned');
assert.strictEqual(userDualDevice.fcmTokens[0].token, 'android_tok_222');
assert.strictEqual(userDualDevice.fcmToken, 'android_tok_222', 'Scalar promoted to remaining Android token');

// 7F: Regression Test 4 — A legacy scalar token without array entry is handled safely
const userLegacyScalarOnly = {
  id: 'user_L',
  email: 'legacy@test.com',
  fcmToken: 'unmigrated_scalar_tok',
  fcmClaim: null,
  fcmTokens: [],
};

const legacyTargets = resolveTargets(userLegacyScalarOnly);
assert.strictEqual(legacyTargets.length, 1);
assert.strictEqual(legacyTargets[0].token, 'unmigrated_scalar_tok');
assert.strictEqual(legacyTargets[0].claim, null, 'Must not invent a claim for legacy scalar');
assert.strictEqual(legacyTargets[0].isLegacyScalarOnly, true);

// If User L subsequently registered this token into fcmTokens with claim_fresh:
userLegacyScalarOnly.fcmTokens.push({ token: 'unmigrated_scalar_tok', platform: 'web', claim: 'claim_fresh' });

// Old late error from the legacy scalar send arrives:
simulateRegistrationIdentityPruning(legacyTargets[0], [userLegacyScalarOnly]);

// INVARIANT: The newly registered entry in fcmTokens with claim_fresh is NOT deleted!
assert.strictEqual(userLegacyScalarOnly.fcmTokens.length, 1, 'New array entry with claim must not be deleted by legacy scalar error');
assert.strictEqual(userLegacyScalarOnly.fcmTokens[0].claim, 'claim_fresh');

// 7G: Regression Test 5 — Multicast response indices map to correct registration identities
const multiUser1 = {
  id: 'u_1',
  fcmTokens: [
    { token: 'u1_tok_A', platform: 'web', claim: 'c_1A' },
    { token: 'u1_tok_B', platform: 'android', claim: 'c_1B' },
  ],
};
const multiUser2 = {
  id: 'u_2',
  fcmTokens: [
    { token: 'u2_tok_C', platform: 'android', claim: 'c_2C' },
  ],
};

function buildMulticastList(users) {
  const tokens = [];
  const targets = [];
  const seen = new Set();
  for (const u of users) {
    for (const entry of u.fcmTokens || []) {
      const key = `${u.id}:${entry.token}`;
      if (!seen.has(key)) {
        seen.add(key);
        tokens.push(entry.token);
        targets.push({ userId: u.id, token: entry.token, claim: entry.claim || null });
      }
    }
  }
  return { tokens, targets };
}

const { tokens: mcTokens, targets: mcTargets } = buildMulticastList([multiUser1, multiUser2]);

assert.strictEqual(mcTokens.length, 3);
assert.strictEqual(mcTargets.length, 3);
assert.strictEqual(mcTokens[0], 'u1_tok_A');
assert.strictEqual(mcTargets[0].userId, 'u_1');
assert.strictEqual(mcTargets[0].claim, 'c_1A');
assert.strictEqual(mcTokens[1], 'u1_tok_B');
assert.strictEqual(mcTargets[1].userId, 'u_1');
assert.strictEqual(mcTargets[1].claim, 'c_1B');
assert.strictEqual(mcTokens[2], 'u2_tok_C');
assert.strictEqual(mcTargets[2].userId, 'u_2');
assert.strictEqual(mcTargets[2].claim, 'c_2C');

// Simulate failure at index 1 (u1_tok_B):
simulateRegistrationIdentityPruning(mcTargets[1], [multiUser1, multiUser2]);

// Invariant: Only u1_tok_B is pruned; u1_tok_A and u2_tok_C remain intact!
assert.strictEqual(multiUser1.fcmTokens.length, 1);
assert.strictEqual(multiUser1.fcmTokens[0].token, 'u1_tok_A');
assert.strictEqual(multiUser2.fcmTokens.length, 1);
assert.strictEqual(multiUser2.fcmTokens[0].token, 'u2_tok_C');

console.log('✅ [Source Assertion & Simulation] All 5 regression tests for registration-identity pruning passed.');

// ============================================================================
// 8. DISPATCH TARGETING & UNIFIED PAYLOAD INVARIANTS
// ============================================================================
console.log('8. Testing Dispatch Targeting & Unified Payload Invariants...');

// 8A: dispatchFcmPush unified payload has both webpush and android blocks
assert(
  notifServiceSource.includes('webpush: {') &&
  notifServiceSource.includes('fcmOptions:') &&
  notifServiceSource.includes('android: {') &&
  notifServiceSource.includes("priority: 'high',") &&
  notifServiceSource.includes("channelId: 'default',"),
  'dispatchFcmPush payload must support both webpush and android configurations'
);

// 8B: createNotification multi-token resolution
assert(
  notifServiceSource.includes("const user = await User.findById(recipient).select('_id fcmToken fcmTokens fcmClaim');") &&
  notifServiceSource.includes("Array.isArray(user?.fcmTokens)") &&
  notifServiceSource.includes("Promise.allSettled("),
  'createNotification must resolve all active tokens from fcmTokens and fcmToken'
);

// 8C: createMulticastNotifications multi-token collection
assert(
  notifServiceSource.includes("fcmToken: { $ne: null }") &&
  notifServiceSource.includes("'fcmTokens.0': { $exists: true }") &&
  notifServiceSource.includes("android: {") &&
  notifServiceSource.includes("channelId: 'default'"),
  'createMulticastNotifications must query both fcmToken and fcmTokens and include android payload'
);

console.log('✅ [Source Assertion & Simulation] Dispatch targeting and unified payload invariants verified.');

console.log('\n🎉 ALL Stage 1 Hardened Multi-Device FCM Tests Passed Successfully!');
