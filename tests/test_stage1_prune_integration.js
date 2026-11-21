/**
 * test_stage1_prune_integration.js
 *
 * LendLocal Stage 1: MongoDB Integration Validation for pruneInvalidFcmToken()
 *
 * Exercises real Mongoose / MongoDB updates against an isolated ephemeral test database:
 * 1. An old invalid-token error after token transfer from User A to User B does not delete User B's registration.
 * 2. An old error after same-user re-registration does not delete the newer claim.
 * 3. A genuinely invalid current registration is removed correctly.
 * 4. A legacy scalar-only token is cleaned up safely without affecting newer claimed array entries.
 * 5. Scalar token promotion preserves the correct token/session/claim tuple.
 *
 * SAFETY INVARIANTS:
 * - Uses ONLY an isolated, dedicated test database with a unique timestamped name.
 * - Refuses to run against production or normal development database ('lendlocal').
 * - Drops the test database completely upon completion.
 * - Credentials and connection secrets are never printed or exposed.
 */

const assert = require('assert');
const path = require('path');

// Ensure modules can be loaded from backend/node_modules when running from root
module.paths.push(path.join(__dirname, 'backend/node_modules'));

const mongoose = require('mongoose');

const User = require('./backend/models/User');
const { pruneInvalidFcmToken } = require('./backend/services/notificationService');

console.log('--- LendLocal Stage 1: MongoDB Integration Validation (pruneInvalidFcmToken) ---');

// ============================================================================
// 1. ISOLATED TEST DATABASE CONFIGURATION & STRICT SAFETY CHECKS
// ============================================================================
function getIsolatedTestDbUri() {
  // Check for explicit test database URI first
  let baseUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_TEST_URI;

  if (!baseUri) {
    // If not explicitly set, derive strictly from local MONGODB_URI or default local instance
    const localUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lendlocal';

    // Parse URL safely to extract protocol, host, and port without logging credentials
    const proto = localUri.split('://')[0];
    const rest = localUri.split('://')[1] || '';
    const atIdx = rest.indexOf('@');
    const hostAndDb = atIdx >= 0 ? rest.substring(atIdx + 1) : rest;
    const slashIdx = hostAndDb.indexOf('/');
    const host = slashIdx >= 0 ? hostAndDb.substring(0, slashIdx) : hostAndDb;

    // Safety: only allow automatic local derivations on localhost/127.0.0.1
    if (!host.includes('127.0.0.1') && !host.includes('localhost')) {
      throw new Error(
        'Prerequisite missing: Non-local MongoDB host detected without dedicated TEST_MONGODB_URI. ' +
        'Refusing to connect to an unknown or remote database.'
      );
    }

    const testDbName = `lendlocal_test_prune_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    baseUri = `${proto}://${host}/${testDbName}`;
  }

  // Final sanity validation: DB name must NOT be empty, must NOT be 'lendlocal', and MUST contain 'test'
  const parsedPath = baseUri.split('?')[0];
  const dbName = parsedPath.substring(parsedPath.lastIndexOf('/') + 1);

  if (!dbName || dbName === 'lendlocal' || !dbName.includes('test')) {
    throw new Error(`Safety violation: Refusing to run tests against non-test database "${dbName}"`);
  }

  return { testUri: baseUri, testDbName: dbName };
}

async function runIntegrationTests() {
  const { testUri, testDbName } = getIsolatedTestDbUri();

  // Log safe sanitized host info without credentials
  const safeHost = testUri.split('@').pop().split('?')[0];
  console.log(`Configured isolated test database: ${safeHost}`);

  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 });

  // Assert mongoose connected to the exact intended test database
  assert.strictEqual(
    mongoose.connection.name,
    testDbName,
    `Active connection must match isolated test DB name "${testDbName}"`
  );
  assert.notStrictEqual(
    mongoose.connection.name,
    'lendlocal',
    'Safety guard: Must never connect to normal development database "lendlocal"'
  );

  console.log(`Connected to isolated test database. State: ${mongoose.connection.readyState}\n`);

  let passedCount = 0;

  try {
    // Clean initial state in test DB
    await User.deleteMany({});

    // ========================================================================
    // TEST 1: Token transfer between users
    // An old invalid-token error after token transfers from User A to User B
    // does not delete User B's registration.
    // ========================================================================
    console.log('1. Testing cross-user token transfer invalid-error isolation...');
    {
      const sharedToken = 'fcm_tok_shared_transferred_101';
      const claimA = 'claim_user_a_initial';
      const claimB = 'claim_user_b_fresh';

      // User A (original owner who transferred the device away)
      const userA = await User.create({
        name: 'User A',
        email: `usera_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [],
        fcmToken: null,
        fcmSessionId: null,
        fcmClaim: null,
      });

      // User B (current active owner of the device)
      const userB = await User.create({
        name: 'User B',
        email: `userb_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          {
            token: sharedToken,
            platform: 'web',
            sessionId: 'session_b_active',
            claim: claimB,
            updatedAt: new Date(),
          },
        ],
        fcmToken: sharedToken,
        fcmSessionId: 'session_b_active',
        fcmClaim: claimB,
      });

      // Delayed Firebase error arrives from an old send initiated when User A had the token
      await pruneInvalidFcmToken({
        userId: userA._id,
        token: sharedToken,
        claim: claimA,
        isLegacyScalarOnly: false,
      });

      // Also verify unscoped string caller does not prune User B's token
      await pruneInvalidFcmToken(sharedToken);

      // Verify User B's registration is completely untouched in MongoDB
      const refreshedB = await User.findById(userB._id).lean();
      assert.strictEqual(refreshedB.fcmTokens.length, 1, 'User B must retain their fcmTokens entry');
      assert.strictEqual(refreshedB.fcmTokens[0].token, sharedToken);
      assert.strictEqual(refreshedB.fcmTokens[0].claim, claimB);
      assert.strictEqual(refreshedB.fcmToken, sharedToken, 'User B scalar fcmToken must be preserved');
      assert.strictEqual(refreshedB.fcmClaim, claimB, 'User B scalar fcmClaim must be preserved');
      assert.strictEqual(refreshedB.fcmSessionId, 'session_b_active', 'User B session must be preserved');

      console.log('✅ [Integration] Cross-user transfer isolation verified: User B registration preserved.');
      passedCount++;
    }

    // ========================================================================
    // TEST 2: Same-user re-registration claim versioning
    // An old error after same-user re-registration does not delete the newer claim.
    // ========================================================================
    console.log('\n2. Testing same-user re-registration claim versioning...');
    {
      const tokenC = 'fcm_tok_re_registered_202';
      const staleClaim = 'claim_v1_stale';
      const freshClaim = 'claim_v2_fresh';

      // User C re-registered with a fresh claim
      const userC = await User.create({
        name: 'User C',
        email: `userc_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          {
            token: tokenC,
            platform: 'android',
            sessionId: 'session_c_fresh',
            claim: freshClaim,
            updatedAt: new Date(),
          },
        ],
        fcmToken: tokenC,
        fcmSessionId: 'session_c_fresh',
        fcmClaim: freshClaim,
      });

      // Delayed error from old send carrying stale claim
      await pruneInvalidFcmToken({
        userId: userC._id,
        token: tokenC,
        claim: staleClaim,
        isLegacyScalarOnly: false,
      });

      // Verify User C's fresh registration is completely intact in MongoDB
      const refreshedC = await User.findById(userC._id).lean();
      assert.strictEqual(refreshedC.fcmTokens.length, 1, 'User C must retain updated fcmTokens entry');
      assert.strictEqual(refreshedC.fcmTokens[0].claim, freshClaim, 'Claim must remain v2 fresh');
      assert.strictEqual(refreshedC.fcmToken, tokenC, 'Scalar fcmToken must not be cleared');
      assert.strictEqual(refreshedC.fcmClaim, freshClaim, 'Scalar fcmClaim must remain v2 fresh');

      console.log('✅ [Integration] Re-registration claim protection verified: Fresh claim preserved.');
      passedCount++;
    }

    // ========================================================================
    // TEST 3: Genuinely invalid current registration removal
    // A genuinely invalid current registration is removed correctly.
    // ========================================================================
    console.log('\n3. Testing removal of genuinely invalid registration...');
    {
      const deadToken = 'fcm_tok_dead_303';
      const validClaim = 'claim_d_matching';

      const userD = await User.create({
        name: 'User D',
        email: `userd_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          {
            token: deadToken,
            platform: 'web',
            sessionId: 'session_d_dead',
            claim: validClaim,
            updatedAt: new Date(),
          },
        ],
        fcmToken: deadToken,
        fcmSessionId: 'session_d_dead',
        fcmClaim: validClaim,
      });

      // Error arrives matching current identity and claim
      await pruneInvalidFcmToken({
        userId: userD._id,
        token: deadToken,
        claim: validClaim,
        isLegacyScalarOnly: false,
      });

      // Verify token and scalars were cleanly wiped in MongoDB
      const refreshedD = await User.findById(userD._id).lean();
      assert.strictEqual(refreshedD.fcmTokens.length, 0, 'fcmTokens array must be empty');
      assert.strictEqual(refreshedD.fcmToken, null, 'Scalar fcmToken must be null');
      assert.strictEqual(refreshedD.fcmSessionId, null, 'Scalar fcmSessionId must be null');
      assert.strictEqual(refreshedD.fcmClaim, null, 'Scalar fcmClaim must be null');

      console.log('✅ [Integration] Genuine invalid registration cleanup verified: Tokens and scalars wiped.');
      passedCount++;
    }

    // ========================================================================
    // TEST 4: Legacy scalar-only token cleanup safety
    // A legacy scalar-only token is cleaned up safely without affecting newer claimed array entries.
    // ========================================================================
    console.log('\n4. Testing legacy scalar-only cleanup safety with active claimed entries...');
    {
      const legacyToken = 'fcm_tok_legacy_scalar_only_404';
      const activeAndroidToken = 'fcm_tok_active_android_405';
      const activeClaim = 'claim_android_active_valid';

      // User E has legacy scalar token (no claim) AND an active claimed device in fcmTokens
      const userE = await User.create({
        name: 'User E',
        email: `usere_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          {
            token: activeAndroidToken,
            platform: 'android',
            sessionId: 'session_android_active',
            claim: activeClaim,
            updatedAt: new Date(),
          },
        ],
        fcmToken: legacyToken,
        fcmSessionId: 'session_legacy',
        fcmClaim: null,
      });

      // Legacy scalar token dispatch error arrives
      await pruneInvalidFcmToken({
        userId: userE._id,
        token: legacyToken,
        claim: null,
        isLegacyScalarOnly: true,
      });

      // Verify active claimed Android entry in fcmTokens was NOT touched
      const refreshedE = await User.findById(userE._id).lean();
      assert.strictEqual(refreshedE.fcmTokens.length, 1, 'Active android token must remain in fcmTokens');
      assert.strictEqual(refreshedE.fcmTokens[0].token, activeAndroidToken);
      assert.strictEqual(refreshedE.fcmTokens[0].claim, activeClaim);

      // Verify legacy scalar was cleared and promoted the remaining active android device
      assert.strictEqual(refreshedE.fcmToken, activeAndroidToken, 'Scalar must be promoted to remaining device');
      assert.strictEqual(refreshedE.fcmSessionId, 'session_android_active');
      assert.strictEqual(refreshedE.fcmClaim, activeClaim);

      // Subcase 4B: Even if an array entry shares the same token string, a legacy scalar error
      // (claim: null) must NOT prune array entries that possess valid claims
      const sharedNameToken = 'fcm_tok_shared_name_406';
      const validArrayClaim = 'claim_valid_array_version';

      const userE2 = await User.create({
        name: 'User E2',
        email: `usere2_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          {
            token: sharedNameToken,
            platform: 'web',
            sessionId: 'session_web_valid',
            claim: validArrayClaim,
            updatedAt: new Date(),
          },
        ],
        fcmToken: sharedNameToken,
        fcmSessionId: 'session_legacy',
        fcmClaim: null,
      });

      // Legacy scalar error with isLegacyScalarOnly: true and claim: null
      await pruneInvalidFcmToken({
        userId: userE2._id,
        token: sharedNameToken,
        claim: null,
        isLegacyScalarOnly: true,
      });

      const refreshedE2 = await User.findById(userE2._id).lean();
      // The array entry MUST NOT be pulled because it has a valid non-null claim!
      assert.strictEqual(refreshedE2.fcmTokens.length, 1, 'Array entry with claim must NOT be pulled by legacy scalar error');
      assert.strictEqual(refreshedE2.fcmTokens[0].token, sharedNameToken);
      assert.strictEqual(refreshedE2.fcmTokens[0].claim, validArrayClaim);

      console.log('✅ [Integration] Legacy scalar cleanup safety verified: Claimed array entries protected.');
      passedCount++;
    }

    // ========================================================================
    // TEST 5: Scalar token promotion preserves the correct token/session/claim tuple
    // ========================================================================
    console.log('\n5. Testing scalar token promotion tuple consistency...');
    {
      const tokenWeb = 'fcm_tok_web_501';
      const tokenAndroid = 'fcm_tok_android_502';
      const claimWeb = 'claim_web_501';
      const claimAndroid = 'claim_android_502';

      // User F has two devices (Web and Android), currently pointing to Web on scalar
      const userF = await User.create({
        name: 'User F',
        email: `userf_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          {
            token: tokenWeb,
            platform: 'web',
            sessionId: 'sess_web_f',
            claim: claimWeb,
            updatedAt: new Date(),
          },
          {
            token: tokenAndroid,
            platform: 'android',
            sessionId: 'sess_android_f',
            claim: claimAndroid,
            updatedAt: new Date(),
          },
        ],
        fcmToken: tokenWeb,
        fcmSessionId: 'sess_web_f',
        fcmClaim: claimWeb,
      });

      // Prune Web token
      await pruneInvalidFcmToken({
        userId: userF._id,
        token: tokenWeb,
        claim: claimWeb,
        isLegacyScalarOnly: false,
      });

      // Verify Web token removed and Android token promoted with exact matching tuple
      const refreshedF = await User.findById(userF._id).lean();
      assert.strictEqual(refreshedF.fcmTokens.length, 1, 'fcmTokens must contain 1 remaining device');
      assert.strictEqual(refreshedF.fcmTokens[0].token, tokenAndroid);

      // Assert complete tuple consistency across all 3 scalar fields
      assert.strictEqual(refreshedF.fcmToken, tokenAndroid, 'Scalar fcmToken must match remaining token');
      assert.strictEqual(refreshedF.fcmSessionId, 'sess_android_f', 'Scalar fcmSessionId must match remaining session');
      assert.strictEqual(refreshedF.fcmClaim, claimAndroid, 'Scalar fcmClaim must match remaining claim');

      // Subcase 5B: Verify Web priority on promotion when multiple devices remain
      const tokAndroid1 = 'fcm_android_1_503';
      const tokWebRemaining = 'fcm_web_rem_504';
      const tokAndroid2 = 'fcm_android_2_505';

      const userG = await User.create({
        name: 'User G',
        email: `userg_${Date.now()}@integration.test`,
        password: 'password123',
        fcmTokens: [
          { token: tokAndroid1, platform: 'android', sessionId: 'sess_g1', claim: 'claim_g1', updatedAt: new Date() },
          { token: tokWebRemaining, platform: 'web', sessionId: 'sess_web_g', claim: 'claim_web_g', updatedAt: new Date() },
          { token: tokAndroid2, platform: 'android', sessionId: 'sess_g2', claim: 'claim_g2', updatedAt: new Date() },
        ],
        fcmToken: tokAndroid1,
        fcmSessionId: 'sess_g1',
        fcmClaim: 'claim_g1',
      });

      // Prune Android 1
      await pruneInvalidFcmToken({
        userId: userG._id,
        token: tokAndroid1,
        claim: 'claim_g1',
        isLegacyScalarOnly: false,
      });

      const refreshedG = await User.findById(userG._id).lean();
      assert.strictEqual(refreshedG.fcmTokens.length, 2);
      // Promotion MUST choose the web token rather than Android 2
      assert.strictEqual(refreshedG.fcmToken, tokWebRemaining, 'Promotion must prioritize web token');
      assert.strictEqual(refreshedG.fcmSessionId, 'sess_web_g');
      assert.strictEqual(refreshedG.fcmClaim, 'claim_web_g');

      console.log('✅ [Integration] Scalar promotion tuple consistency & web priority verified.');
      passedCount++;
    }

    console.log(`\n🎉 ALL ${passedCount}/5 pruneInvalidFcmToken integration tests passed successfully!`);

  } finally {
    // Teardown: strictly drop the test database and close connection
    if (mongoose.connection.readyState === 1 && mongoose.connection.name.includes('test')) {
      await mongoose.connection.dropDatabase();
      console.log(`Cleaned up and dropped isolated test database "${mongoose.connection.name}".`);
    }
    await mongoose.disconnect();
    console.log('Mongoose connection disconnected.');
  }
}

runIntegrationTests().catch((err) => {
  console.error('\n❌ Integration Test Error:', err);
  process.exit(1);
});
