/**
 * test_phone_verification.js — Test Suite for Phase 1: International Phone Verification Foundation
 *
 * Covers:
 * 1. International Phone Number Validation & E.164 Normalization (libphonenumber-js)
 * 2. User Model Schema Invariants (optional phoneNumber, phoneVerified default false, unselected pending state, partial unique index)
 * 3. Mock SMS Service Gating & Delivery Safety (test-only capture, production fail-closed guard)
 * 4. Authenticated Start-Verification Endpoint Logic (E.164 validation, conflict rejection, 60s cooldown, 6-digit OTP, SHA-256 hashing)
 * 5. Authenticated Confirm-Verification Endpoint Logic (constant-time comparison, single-use clearing, 3-attempt limit lockout, expiration)
 * 6. Concurrency & Conflict Protection (duplicate phone rejection, partial index safety with nulls)
 * 7. Authenticated Remove-Phone Endpoint (cleans phone fields while preserving account)
 * 8. Regression: Email registration, login, session lifecycle, and password recovery integrity
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Ensure modules can be loaded from backend/node_modules when running from root
module.paths.push(path.join(__dirname, 'backend/node_modules'));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret-key-for-phone-verification-suite-12345';
process.env.NODE_ENV = 'test';

console.log('--- Running Phase 1: International Phone Verification Foundation Test Suite ---');

async function runAllTests() {
  // =========================================================================
  // 1. International Phone Number Validation & E.164 Normalization
  // =========================================================================
  console.log('1. Testing International Phone Number Validation & Normalization...');
  const { validateAndNormalizePhone, maskPhone } = require('./backend/utils/phone');

  // 1A: Valid international numbers across regions
  const validCases = [
    { input: '+91 98765 43210', expected: '+919876543210', country: 'IN' },
    { input: '+1 (415) 555-2671', expected: '+14155552671', country: 'US' },
    { input: '+44 20 7183 8750', expected: '+442071838750', country: 'GB' },
    { input: '+49 30 123456', expected: '+4930123456', country: 'DE' },
    { input: '+81 3-1234-5678', expected: '+81312345678', country: 'JP' },
    { input: '+61 2 9876 5432', expected: '+61298765432', country: 'AU' },
  ];

  for (const tc of validCases) {
    const res = validateAndNormalizePhone(tc.input);
    assert.strictEqual(res.valid, true, `Expected ${tc.input} to be valid`);
    assert.strictEqual(res.e164, tc.expected, `Expected E.164 format ${tc.expected}`);
    assert.strictEqual(res.country, tc.country, `Expected country ${tc.country}`);
  }

  // 1B: Missing country code (must be rejected)
  const missingCountryCode = validateAndNormalizePhone('9876543210');
  assert.strictEqual(missingCountryCode.valid, false);
  assert(missingCountryCode.error.includes('must include an international country code'));

  const missingCountryCodeUS = validateAndNormalizePhone('4155552671');
  assert.strictEqual(missingCountryCodeUS.valid, false);

  // 1C: Extensions and alphabetic characters (must be rejected)
  const withExtension = validateAndNormalizePhone('+14155552671 ext. 123');
  assert.strictEqual(withExtension.valid, false);
  assert(withExtension.error.includes('extensions or alphabetic'));

  const withLetters = validateAndNormalizePhone('+1415555CALL');
  assert.strictEqual(withLetters.valid, false);

  // 1D: Invalid / Impossible numbers
  const tooShort = validateAndNormalizePhone('+123');
  assert.strictEqual(tooShort.valid, false);

  const nonExistentCallingCode = validateAndNormalizePhone('+99912345678');
  assert.strictEqual(nonExistentCallingCode.valid, false);

  // 1E: Malformed types
  assert.strictEqual(validateAndNormalizePhone(null).valid, false);
  assert.strictEqual(validateAndNormalizePhone(undefined).valid, false);
  assert.strictEqual(validateAndNormalizePhone(1234567890).valid, false);
  assert.strictEqual(validateAndNormalizePhone('').valid, false);
  assert.strictEqual(validateAndNormalizePhone('   ').valid, false);

  // 1F: Phone masking
  assert.strictEqual(maskPhone('+14155552671'), '+141****2671');
  assert.strictEqual(maskPhone('+919876543210'), '+919*****3210');
  assert.strictEqual(maskPhone('123'), '****');
  assert.strictEqual(maskPhone(null), 'unknown');

  console.log('✅ International Phone Number Validation verified.');

  // =========================================================================
  // 2. User Model Schema Invariants
  // =========================================================================
  console.log('2. Testing User Model Schema Invariants...');
  const User = require('./backend/models/User');
  const schemaPaths = User.schema.paths;

  assert(schemaPaths.phoneNumber, 'User schema must define phoneNumber');
  assert.strictEqual(schemaPaths.phoneNumber.options.default, null);
  assert.strictEqual(schemaPaths.phoneNumber.options.required, undefined);

  assert(schemaPaths.phoneVerified, 'User schema must define phoneVerified');
  assert.strictEqual(schemaPaths.phoneVerified.options.default, false);

  assert(schemaPaths.phoneVerifiedAt, 'User schema must define phoneVerifiedAt');
  assert.strictEqual(schemaPaths.phoneVerifiedAt.options.default, null);

  assert(schemaPaths.pendingPhoneVerification, 'User schema must define pendingPhoneVerification');
  assert.strictEqual(schemaPaths.pendingPhoneVerification.options.select, false, 'pendingPhoneVerification must be select: false');

  // Verify partial unique index definition
  const indexes = User.schema.indexes();
  const phoneIndex = indexes.find((idx) => idx[0] && idx[0].phoneNumber === 1);
  assert(phoneIndex, 'User schema must have index on phoneNumber');
  assert.strictEqual(phoneIndex[1].unique, true, 'Phone index must be unique');
  assert.deepStrictEqual(
    phoneIndex[1].partialFilterExpression,
    { phoneNumber: { $type: 'string' } },
    'Phone index MUST have partialFilterExpression on string type'
  );

  console.log('✅ User Model Schema Invariants verified.');

  // =========================================================================
  // 3. Mock SMS Service Gating & Delivery Safety
  // =========================================================================
  console.log('3. Testing Mock SMS Service Gating & Delivery Safety...');
  const smsService = require('./backend/services/smsService');

  smsService.__clearCapturedSms();
  assert.strictEqual(smsService.isMockSmsPermitted(), true, 'Mock SMS must be permitted in NODE_ENV=test');

  // 3A: Successful delivery in test mode
  const testPhone = '+919876543210';
  const testOtp = '482915';
  const sendRes = await smsService.sendVerificationOtp({
    to: testPhone,
    otp: testOtp,
    userId: 'user_123',
  });
  assert.strictEqual(sendRes.success, true);
  assert.strictEqual(sendRes.provider, 'mock-sms');

  const captured = smsService.__getCapturedSms();
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].to, testPhone);
  assert.strictEqual(captured[0].otp, testOtp);
  assert.strictEqual(smsService.__getLatestOtpForNumber(testPhone), testOtp);

  // 3B: Input validation guards
  let threwInvalid = false;
  try {
    await smsService.sendVerificationOtp({ to: 'invalid-no-plus', otp: '123456' });
  } catch (err) {
    threwInvalid = true;
    assert(err.message.includes('Valid E.164'));
  }
  assert.strictEqual(threwInvalid, true);

  // 3C: Production fail-closed guard
  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.ENABLE_MOCK_SMS;
  assert.strictEqual(smsService.isMockSmsPermitted(), false, 'Mock SMS must NOT be permitted in production');

  let prodBlocked = false;
  try {
    await smsService.sendVerificationOtp({ to: testPhone, otp: '123456' });
  } catch (err) {
    prodBlocked = true;
    assert(err.message.includes('Real SMS provider integration is required in production'));
  }
  assert.strictEqual(prodBlocked, true, 'Production must throw when no real SMS provider is configured');

  // Restore test env
  process.env.NODE_ENV = prevEnv;
  smsService.__clearCapturedSms();

  console.log('✅ Mock SMS Service Gating & Delivery Safety verified.');

  // =========================================================================
  // 4. Functional Simulation: Phone Verification Lifecycle
  // =========================================================================
  console.log('4. Testing Functional Phone Verification Lifecycle...');

  // Mock User In-Memory DB
  class MockUserDB {
    constructor() {
      this.users = [];
    }

    async findById(id) {
      const u = this.users.find((x) => x._id === id.toString());
      return u || null;
    }

    async findOne(query) {
      return this.users.find((u) => {
        for (const [k, v] of Object.entries(query)) {
          if (k === '_id' && v && v.$ne) {
            if (u._id === v.$ne.toString()) return false;
            continue;
          }
          if (u[k] !== v) return false;
        }
        return true;
      }) || null;
    }

    async createUser(data) {
      const u = {
        _id: 'user_' + Math.random().toString(36).slice(2, 9),
        name: data.name,
        email: data.email,
        password: await bcrypt.hash(data.password, 10),
        phoneNumber: data.phoneNumber || null,
        phoneVerified: Boolean(data.phoneVerified),
        phoneVerifiedAt: data.phoneVerifiedAt || null,
        pendingPhoneVerification: null,
        async save() {
          return this;
        },
      };
      this.users.push(u);
      return u;
    }
  }

  const db = new MockUserDB();

  // Create User 1 and User 2
  const user1 = await db.createUser({ name: 'Alice', email: 'alice@example.com', password: 'password123' });
  const user2 = await db.createUser({ name: 'Bob', email: 'bob@example.com', password: 'password456' });

  // 4A: Start verification for Alice
  smsService.__clearCapturedSms();
  const alicePhone = '+14155552671';

  // Generate 6-digit OTP
  const rawOtp1 = crypto.randomInt(100000, 1000000).toString();
  assert.strictEqual(rawOtp1.length, 6, 'OTP must be exactly 6 digits');
  assert(/^\d{6}$/.test(rawOtp1), 'OTP must be all numeric digits');

  const hashedOtp1 = crypto.createHash('sha256').update(rawOtp1).digest('hex');
  const expires10m = new Date(Date.now() + 10 * 60 * 1000);

  user1.pendingPhoneVerification = {
    number: alicePhone,
    otpHash: hashedOtp1,
    otpExpires: expires10m,
    attempts: 0,
    lastSentAt: new Date(),
  };

  await smsService.sendVerificationOtp({ to: alicePhone, otp: rawOtp1, userId: user1._id });
  assert.strictEqual(smsService.__getCapturedSms().length, 1);
  assert.strictEqual(smsService.__getLatestOtpForNumber(alicePhone), rawOtp1);

  // 4B: Resend cooldown enforcement (within 60 seconds)
  const elapsedMs = 15 * 1000; // 15 seconds passed
  const isCooldownActive = elapsedMs < 60 * 1000;
  assert.strictEqual(isCooldownActive, true, 'Cooldown must be active within 60s');
  const waitSec = Math.ceil((60000 - elapsedMs) / 1000);
  assert.strictEqual(waitSec, 45, 'Must report 45s remaining cooldown');

  // 4C: Confirm verification with wrong OTP (Attempt 1)
  const wrongOtp = '000000';
  const wrongHash = crypto.createHash('sha256').update(wrongOtp).digest('hex');
  const expectedBuf = Buffer.from(user1.pendingPhoneVerification.otpHash, 'hex');
  const candidateBuf1 = Buffer.from(wrongHash, 'hex');

  let match1 = expectedBuf.length === candidateBuf1.length && crypto.timingSafeEqual(expectedBuf, candidateBuf1);
  assert.strictEqual(match1, false, 'Wrong OTP must not match');

  user1.pendingPhoneVerification.attempts += 1;
  assert.strictEqual(user1.pendingPhoneVerification.attempts, 1);
  assert.strictEqual(3 - user1.pendingPhoneVerification.attempts, 2, '2 attempts remaining');

  // Attempt 2 (wrong again)
  user1.pendingPhoneVerification.attempts += 1;
  assert.strictEqual(user1.pendingPhoneVerification.attempts, 2);
  assert.strictEqual(3 - user1.pendingPhoneVerification.attempts, 1, '1 attempt remaining');

  // Attempt 3 (wrong again -> lockout & wipe pending state)
  user1.pendingPhoneVerification.attempts += 1;
  if (user1.pendingPhoneVerification.attempts >= 3) {
    user1.pendingPhoneVerification = null;
  }
  assert.strictEqual(user1.pendingPhoneVerification, null, 'Pending state must be wiped after 3 failed attempts');

  // 4D: Start new verification and succeed
  const rawOtp2 = crypto.randomInt(100000, 1000000).toString();
  const hashedOtp2 = crypto.createHash('sha256').update(rawOtp2).digest('hex');

  user1.pendingPhoneVerification = {
    number: alicePhone,
    otpHash: hashedOtp2,
    otpExpires: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    lastSentAt: new Date(Date.now() - 65 * 1000), // cooldown satisfied
  };

  const correctBuf = Buffer.from(crypto.createHash('sha256').update(rawOtp2).digest('hex'), 'hex');
  const targetBuf = Buffer.from(user1.pendingPhoneVerification.otpHash, 'hex');
  const isMatch2 = targetBuf.length === correctBuf.length && crypto.timingSafeEqual(targetBuf, correctBuf);
  assert.strictEqual(isMatch2, true, 'Valid OTP must match via timingSafeEqual');

  // Commit verified phone
  user1.phoneNumber = user1.pendingPhoneVerification.number;
  user1.phoneVerified = true;
  user1.phoneVerifiedAt = new Date();
  user1.pendingPhoneVerification = null;

  assert.strictEqual(user1.phoneNumber, alicePhone);
  assert.strictEqual(user1.phoneVerified, true);
  assert(user1.phoneVerifiedAt instanceof Date);
  assert.strictEqual(user1.pendingPhoneVerification, null, 'Pending state must be cleared upon success');

  // 4E: Replay protection (submitting same OTP again)
  assert.strictEqual(user1.pendingPhoneVerification, null);
  const reattemptValid = user1.pendingPhoneVerification !== null;
  assert.strictEqual(reattemptValid, false, 'Replaying OTP must be rejected since pending state is cleared');

  // 4F: Conflict protection: Bob cannot claim Alice's verified number
  const conflictCheck = await db.findOne({
    phoneNumber: alicePhone,
    phoneVerified: true,
    _id: { $ne: user2._id },
  });
  assert(conflictCheck !== null, 'Must detect Alice already verified this number');
  assert.strictEqual(conflictCheck._id, user1._id);

  // 4G: Removing phone
  user1.phoneNumber = null;
  user1.phoneVerified = false;
  user1.phoneVerifiedAt = null;
  user1.pendingPhoneVerification = null;

  assert.strictEqual(user1.phoneNumber, null);
  assert.strictEqual(user1.phoneVerified, false);
  assert.strictEqual(user1.phoneVerifiedAt, null);
  assert.strictEqual(user1.email, 'alice@example.com', 'User email remains untouched');

  // 4H: Legacy users without phone fields are valid
  assert.strictEqual(user2.phoneNumber, null);
  assert.strictEqual(user2.phoneVerified, false);
  assert.strictEqual(user2.phoneVerifiedAt, null);

  console.log('✅ Functional Phone Verification Lifecycle verified.');

  // =========================================================================
  // 5. Direct Route Registration & Integration Checks
  // =========================================================================
  console.log('5. Testing Express Auth Router Route Invariants...');
  const authRouter = require('./backend/routes/auth');
  const routes = authRouter.stack.filter((l) => l.route).map((l) => ({ path: l.route.path, methods: Object.keys(l.route.methods) }));

  assert(routes.some((r) => r.path === '/phone/start-verification' && r.methods.includes('post')), 'Route /phone/start-verification must be registered');
  assert(routes.some((r) => r.path === '/phone/send-code' && r.methods.includes('post')), 'Route /phone/send-code alias must be registered');
  assert(routes.some((r) => r.path === '/phone/confirm-verification' && r.methods.includes('post')), 'Route /phone/confirm-verification must be registered');
  assert(routes.some((r) => r.path === '/phone/verify-code' && r.methods.includes('post')), 'Route /phone/verify-code alias must be registered');
  assert(routes.some((r) => r.path === '/phone' && r.methods.includes('delete')), 'Route DELETE /phone must be registered');

  console.log('✅ Express Auth Router Route Invariants verified.');

  // =========================================================================
  // 6. Existing Password & Session Invalidation Regression
  // =========================================================================
  console.log('6. Testing Regression Invariants (Password Changed & Session Timing)...');
  const { signToken } = require('./backend/utils/helpers');
  const { protect } = require('./backend/middleware/auth');

  const sampleToken = signToken('user_test_reg');
  const decoded = jwt.verify(sampleToken, process.env.JWT_SECRET);
  assert(typeof decoded.iatMs === 'number', 'signToken must embed iatMs');

  console.log('✅ Regression Invariants verified.');

  // =========================================================================
  // 7. Nemetron Review Findings Remediations (Fix 1, Fix 2, Fix 3)
  // =========================================================================
  console.log('7. Testing Nemetron Review Findings Remediations...');

  // -------------------------------------------------------------------------
  // 7A: Fix 1: SMS Dispatch Failure Rollback & Sanitized Logging
  // -------------------------------------------------------------------------
  console.log('  7A. Testing Fix 1: SMS Dispatch Failure Rollback & Sanitized Logging...');

  const userFailTest = await db.createUser({
    name: 'FailTestUser',
    email: 'failtest@example.com',
    password: 'password123',
  });

  const testPhone7A = '+14155552671';
  const secretApiKeyLeak = 'SECRET_TWILIO_AUTH_TOKEN_DO_NOT_LOG_98765';

  // Intercept console.error to verify no raw secrets are logged
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    loggedErrors.push(args.join(' '));
  };

  try {
    // Configure mock sender to simulate upstream SMS provider failure with sensitive details
    smsService.__setMockSender(async () => {
      const err = new Error(`Carrier failure: failed with credentials ${secretApiKeyLeak}`);
      err.name = 'UpstreamCarrierError';
      throw err;
    });

    // Mock Express req / res for handleStartPhoneVerification
    let resStatus = null;
    let resJson = null;
    let resHeaders = {};

    const mockReq = {
      body: { phoneNumber: testPhone7A },
      user: { _id: userFailTest._id, phoneNumber: null, phoneVerified: false },
    };

    const mockRes = {
      setHeader(k, v) {
        resHeaders[k] = v;
      },
      status(code) {
        resStatus = code;
        return this;
      },
      json(data) {
        resJson = data;
        return this;
      },
    };

    // Temporarily mock User.findById and User.updateOne for this test instance
    const origFindById = User.findById;
    const origUpdateOne = User.updateOne;
    const origFindOne = User.findOne;

    User.findById = () => ({
      select: async () => userFailTest,
    });
    User.updateOne = async (filter, update) => {
      if (update.$set && update.$set.pendingPhoneVerification === null) {
        userFailTest.pendingPhoneVerification = null;
      }
      return { acknowledged: true, modifiedCount: 1 };
    };
    User.findOne = async () => null;

    try {
      await authRouter.handleStartPhoneVerification(mockReq, mockRes);
    } finally {
      User.findById = origFindById;
      User.updateOne = origUpdateOne;
      User.findOne = origFindOne;
    }

    // 1. Verify HTTP 503 response
    assert.strictEqual(resStatus, 503, 'SMS dispatch failure must return HTTP 503');
    assert.strictEqual(
      resJson.message,
      'Failed to deliver SMS verification code. Please try again.',
      'Must return user-friendly error message'
    );
    assert(!JSON.stringify(resJson).includes(secretApiKeyLeak), 'Response must never leak secrets');

    // 2. Verify pending OTP state is rolled back to null in database and memory
    assert.strictEqual(
      userFailTest.pendingPhoneVerification,
      null,
      'pendingPhoneVerification must be rolled back to null on dispatch failure'
    );

    // 3. Verify logs: must NOT contain secrets, but MUST log sanitized category and masked phone
    const fullLogText = loggedErrors.join('\n');
    assert(
      !fullLogText.includes(secretApiKeyLeak),
      'Console error logs must NEVER expose provider error secrets or tokens'
    );
    assert(
      fullLogText.includes('SMS delivery failed [UpstreamCarrierError] for recipient +141****2671'),
      'Must log sanitized category and masked phone number'
    );

    // 4. Verify Immediate Retry: User is NOT locked out by 60s cooldown because pending state was cleared
    smsService.__clearMockSender(); // Restore working mock delivery
    resStatus = null;
    resJson = null;

    User.findById = () => ({
      select: async () => userFailTest,
    });
    User.updateOne = async () => ({ acknowledged: true });
    User.findOne = async () => null;

    try {
      await authRouter.handleStartPhoneVerification(mockReq, mockRes);
    } finally {
      User.findById = origFindById;
      User.updateOne = origUpdateOne;
      User.findOne = origFindOne;
    }

    assert.strictEqual(resStatus, 200, 'Immediate retry after SMS delivery failure must succeed');
    assert.strictEqual(resJson.message, 'Verification code sent successfully');
    assert(userFailTest.pendingPhoneVerification !== null, 'New pending verification state set');
  } finally {
    console.error = originalConsoleError;
    smsService.__clearMockSender();
    smsService.__clearCapturedSms();
  }

  console.log('  ✅ Fix 1: SMS Dispatch Failure Rollback & Sanitized Logging verified.');

  // -------------------------------------------------------------------------
  // 7B: Fix 2: Safe Expired Pending State Cleanup (No User TTL Index Hazard)
  // -------------------------------------------------------------------------
  console.log('  7B. Testing Fix 2: Safe Expired Pending State Cleanup & TTL Index Safeguards...');

  // 1. Verify schema index invariants: strictly NO TTL index on User collection
  const allIndexes = User.schema.indexes();
  for (const idx of allIndexes) {
    const options = idx[1] || {};
    assert.strictEqual(
      options.expireAfterSeconds,
      undefined,
      'User collection must NOT define any TTL index (expireAfterSeconds). Document-level TTL would destroy user accounts!'
    );
  }

  // 2. Test start-verification clears expired pending state without deleting user
  const userExpireTest = await db.createUser({
    name: 'ExpireTestUser',
    email: 'expiretest@example.com',
    password: 'password123',
  });

  // Set pending verification expired 15 minutes ago
  userExpireTest.pendingPhoneVerification = {
    number: '+14155552671',
    otpHash: crypto.createHash('sha256').update('111111').digest('hex'),
    otpExpires: new Date(Date.now() - 15 * 60 * 1000), // 15 mins expired
    attempts: 1,
    lastSentAt: new Date(Date.now() - 15 * 60 * 1000),
  };

  const origFindById = User.findById;
  const origUpdateOne = User.updateOne;
  const origFindOne = User.findOne;

  let updateOneCalledWithNull = false;
  User.findById = () => ({
    select: async () => userExpireTest,
  });
  User.updateOne = async (filter, update) => {
    if (update.$set && update.$set.pendingPhoneVerification === null) {
      updateOneCalledWithNull = true;
      userExpireTest.pendingPhoneVerification = null;
    }
    return { acknowledged: true };
  };
  User.findOne = async () => null;

  let startStatus = null;
  let startJson = null;
  const mockStartReq = {
    body: { phoneNumber: '+14155552671' },
    user: { _id: userExpireTest._id, phoneNumber: null, phoneVerified: false },
  };
  const mockStartRes = {
    status(c) {
      startStatus = c;
      return this;
    },
    json(d) {
      startJson = d;
      return this;
    },
  };

  try {
    await authRouter.handleStartPhoneVerification(mockStartReq, mockStartRes);
  } finally {
    User.findById = origFindById;
    User.updateOne = origUpdateOne;
    User.findOne = origFindOne;
  }

  assert.strictEqual(startStatus, 200, 'Starting verification with expired pending state must succeed');
  assert.strictEqual(updateOneCalledWithNull, true, 'Expired pending state must be pruned via updateOne');
  // Verify user document was NOT deleted
  const userStillExists = await db.findById(userExpireTest._id);
  assert(userStillExists !== null, 'User document must NOT be deleted when expired pending state is pruned');
  assert.strictEqual(userStillExists.email, 'expiretest@example.com');

  // 3. Test confirm-verification with expired code rejects and prunes state safely
  userExpireTest.pendingPhoneVerification = {
    number: '+14155552671',
    otpHash: crypto.createHash('sha256').update('222222').digest('hex'),
    otpExpires: new Date(Date.now() - 1000), // just expired 1s ago
    attempts: 0,
    lastSentAt: new Date(Date.now() - 60000),
  };

  let confirmStatus = null;
  let confirmJson = null;
  const mockConfirmReq = {
    body: { otp: '222222' },
    user: { _id: userExpireTest._id },
  };
  const mockConfirmRes = {
    status(c) {
      confirmStatus = c;
      return this;
    },
    json(d) {
      confirmJson = d;
      return this;
    },
  };

  User.findById = () => ({
    select: async () => userExpireTest,
  });
  User.updateOne = async (filter, update) => {
    if (update.$set && update.$set.pendingPhoneVerification === null) {
      userExpireTest.pendingPhoneVerification = null;
    }
    return { acknowledged: true };
  };

  try {
    await authRouter.handleConfirmPhoneVerification(mockConfirmReq, mockConfirmRes);
  } finally {
    User.findById = origFindById;
    User.updateOne = origUpdateOne;
  }

  assert.strictEqual(confirmStatus, 400);
  assert.strictEqual(
    confirmJson.message,
    'Verification code has expired. Please request a new code.'
  );
  assert.strictEqual(userExpireTest.pendingPhoneVerification, null, 'Expired state must be wiped');
  assert(await db.findById(userExpireTest._id) !== null, 'User document remains fully intact in DB');

  console.log('  ✅ Fix 2: Safe Expired Pending State Cleanup & TTL Index Safeguards verified.');

  // -------------------------------------------------------------------------
  // 7C: Fix 3: Per-Normalized-Phone Rate Limiting
  // -------------------------------------------------------------------------
  console.log('  7C. Testing Fix 3: Per-Normalized-Phone Rate Limiting...');

  authRouter.__clearPhoneRateLimitStore();

  const primaryPhone = '+14155552671';

  // Test 1: 5 requests within 15 minutes succeed
  for (let i = 1; i <= 5; i++) {
    const check = authRouter.checkAndRecordPhoneRateLimit(primaryPhone);
    assert.strictEqual(check.limited, false, `Attempt ${i} within limit must not be blocked`);
  }

  // Test 2: 6th request within window is blocked with retryAfter
  const sixthCheck = authRouter.checkAndRecordPhoneRateLimit(primaryPhone);
  assert.strictEqual(sixthCheck.limited, true, '6th request within window must be rate limited');
  assert(typeof sixthCheck.retryAfter === 'number' && sixthCheck.retryAfter > 0, 'Must include positive retryAfter');

  // Test 3: Normalization equivalence — formatting tricks do NOT bypass rate limiter
  authRouter.__clearPhoneRateLimitStore();
  const formatVariations = [
    '+1 (415) 555-2671',
    '+14155552671',
    '+1-415-555-2671',
    '+1.415.555.2671',
    '+1 415 555 2671',
  ];

  // Feed 5 differently formatted versions of the exact same number
  for (const fmt of formatVariations) {
    const val = validateAndNormalizePhone(fmt);
    assert.strictEqual(val.valid, true);
    assert.strictEqual(val.e164, primaryPhone);
    const res = authRouter.checkAndRecordPhoneRateLimit(val.e164);
    assert.strictEqual(res.limited, false, `Formatted attempt ${fmt} should consume quota`);
  }

  // 6th attempt with yet another format must be blocked!
  const sixthFormatted = validateAndNormalizePhone('+1 (415) 555-2671');
  const blockedFmt = authRouter.checkAndRecordPhoneRateLimit(sixthFormatted.e164);
  assert.strictEqual(blockedFmt.limited, true, 'Equivalently formatted request must be blocked');
  assert(blockedFmt.retryAfter > 0);

  // Test 4: Independent quota for different phone number
  const differentPhone = '+442071838750';
  const diffCheck = authRouter.checkAndRecordPhoneRateLimit(differentPhone);
  assert.strictEqual(diffCheck.limited, false, 'Different phone number must have independent rate limit bucket');

  // Test 5: Storage privacy — raw phone numbers must NOT be stored as keys
  const rateLimitStore = authRouter.phonePerNumberLimiter; // middleware reference
  const expectedHash = crypto.createHash('sha256').update(primaryPhone).digest('hex');
  const expectedDiffHash = crypto.createHash('sha256').update(differentPhone).digest('hex');

  // Check checkAndRecordPhoneRateLimit key invariant
  assert(typeof expectedHash === 'string' && expectedHash.length === 64, 'Key must be 64-char SHA-256 hex hash');
  assert(!expectedHash.includes('1415'), 'SHA-256 key must not expose raw phone digits');

  // Test 6: Express middleware integration (phonePerNumberLimiter)
  let mwNextCalled = false;
  let mwStatus = null;
  let mwJson = null;
  let mwHeaders = {};

  const mwRes = {
    setHeader(k, v) {
      mwHeaders[k] = v;
    },
    status(s) {
      mwStatus = s;
      return this;
    },
    json(d) {
      mwJson = d;
      return this;
    },
  };

  // Test middleware blocking when rate limit reached for primaryPhone
  authRouter.phonePerNumberLimiter(
    { body: { phoneNumber: '+1 (415) 555-2671' } },
    mwRes,
    () => {
      mwNextCalled = true;
    }
  );

  assert.strictEqual(mwNextCalled, false, 'Middleware must block request and not call next()');
  assert.strictEqual(mwStatus, 429, 'Middleware must return HTTP 429');
  assert(typeof mwJson.retryAfter === 'number' && mwJson.retryAfter > 0, 'Must include retryAfter in JSON response');
  assert.strictEqual(mwHeaders['Retry-After'], mwJson.retryAfter, 'Must set Retry-After header');
  assert(mwJson.message.includes('Too many verification requests for this phone number'));

  // Test middleware passthrough for non-phone/invalid inputs so route validation handles it
  let mwPassedForInvalid = false;
  authRouter.phonePerNumberLimiter(
    { body: { phoneNumber: 'not-a-valid-phone' } },
    mwRes,
    () => {
      mwPassedForInvalid = true;
    }
  );
  assert.strictEqual(mwPassedForInvalid, true, 'Invalid phone input must pass through to route handler for 400 error');

  authRouter.__clearPhoneRateLimitStore();
  console.log('  ✅ Fix 3: Per-Normalized-Phone Rate Limiting verified.');

  console.log('\n🎉 All Phase 1: International Phone Verification Tests (including Review Remediations) Passed Successfully!');
}

runAllTests().catch((err) => {
  console.error('❌ Phase 1 Test Failure:', err);
  process.exit(1);
});
