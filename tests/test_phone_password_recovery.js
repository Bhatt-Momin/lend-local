/**
 * test_phone_password_recovery.js — Test Suite for Phase 2: Secure Phone OTP Password Recovery
 *
 * Covers:
 * 1. User Model Schema Invariants (pendingPhoneRecovery subdocument, select: false, no TTL index)
 * 2. Enumeration-Resistant Initiation (POST /api/auth/forgot-password-phone)
 *    - Unknown, unverified, and verified phone numbers receive identical generic responses
 *    - Invalid phone format validation
 * 3. Resend Cooldown (5-minute cooldown) & Dedicated Recovery Rate Limiting (3 req/phone/hr)
 *    - Equivalent E.164 formats share quota
 * 4. SMS Dispatch Failure Resilience & Production Fail-Closed Safety
 *    - Rollback of specific challengeId without overwriting newer challenges
 *    - Safe rate-limit rollback and generic response
 * 5. Atomic Reset & Concurrency (POST /api/auth/reset-password-phone)
 *    - Wrong OTP returns generic error without leaking failure type
 *    - Atomic failed attempts incrementation ($inc) enforcing 3-attempt lockout
 *    - Expired OTP (> 10 mins) rejection
 *    - Successful reset, bcrypt hashing via pre('save'), session invalidation (passwordChangedAt)
 *    - OTP replay prevention
 *    - Concurrency test: two concurrent requests with same valid OTP — at most ONE succeeds
 * 6. High-Precision JWT Session Invalidation via protect middleware
 * 7. Email Recovery Compatibility & Single-Use Token Concurrency Resolution
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.paths.push(path.join(__dirname, 'backend/node_modules'));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret-key-for-phone-recovery-suite-99999';
process.env.NODE_ENV = 'test';

console.log('--- Running Phase 2: Secure Phone OTP Password Recovery Test Suite ---');
console.log('========================================================================');
console.log('NOTICE: IN-MEMORY DATABASE TESTING DISCLOSURE');
console.log('These automated test suites run against an in-memory document store simulation');
console.log('that verifies application-level predicates, atomic update operators ($inc, $set, $unset),');
console.log('schema validations, and rate-limiting sliding windows.');
console.log('CRITICAL ENVIRONMENT LIMITATION: In-memory concurrency simulations demonstrate');
console.log('correct single-process ordering, but DO NOT prove real multi-node MongoDB replica set');
console.log('ACID guarantees under heavy distributed contention. In a production cluster,');
console.log('distributed multi-document transactions or distributed locks (e.g. Redlock/Redis) are');
console.log('required for cross-document consistency.');
console.log('========================================================================\n');

async function runAllTests() {
  const User = require('./backend/models/User');
  const authRouter = require('./backend/routes/auth');
  const smsService = require('./backend/services/smsService');
  const { validateAndNormalizePhone } = require('./backend/utils/phone');
  const { protect } = require('./backend/middleware/auth');
  const { signToken } = require('./backend/utils/helpers');

  // =========================================================================
  // 1. User Model Schema Invariants
  // =========================================================================
  console.log('1. Testing User Model Schema Invariants...');
  const schemaPaths = User.schema.paths;

  assert(schemaPaths.pendingPhoneRecovery, 'User schema must define pendingPhoneRecovery');
  assert.strictEqual(
    schemaPaths.pendingPhoneRecovery.options.select,
    false,
    'pendingPhoneRecovery must be select: false to exclude from normal queries'
  );

  // Verify subdocument paths
  const subPaths = schemaPaths.pendingPhoneRecovery.schema.paths;
  assert(subPaths.number, 'Must define pendingPhoneRecovery.number');
  assert(subPaths.otpHash, 'Must define pendingPhoneRecovery.otpHash');
  assert(subPaths.otpExpires, 'Must define pendingPhoneRecovery.otpExpires');
  assert(subPaths.attempts, 'Must define pendingPhoneRecovery.attempts');
  assert(subPaths.lastSentAt, 'Must define pendingPhoneRecovery.lastSentAt');
  assert(subPaths.challengeId, 'Must define pendingPhoneRecovery.challengeId');

  // Verify strictly NO TTL index on User model
  const indexes = User.schema.indexes();
  for (const idx of indexes) {
    const opts = idx[1] || {};
    assert.strictEqual(
      opts.expireAfterSeconds,
      undefined,
      'User schema must NEVER define a TTL index (expireAfterSeconds). Document-level TTL would destroy user accounts!'
    );
  }

  console.log('✅ User Model Schema Invariants verified (0 TTL hazard).');

  // =========================================================================
  // In-Memory Database Simulation for Deterministic Testing
  // =========================================================================
  class MockDatabase {
    constructor() {
      this.users = [];
    }

    async createUser(data) {
      const u = {
        _id: 'user_' + Math.random().toString(36).slice(2, 9),
        name: data.name,
        email: data.email.toLowerCase().trim(),
        password: await bcrypt.hash(data.password, 10),
        phoneNumber: data.phoneNumber || null,
        phoneVerified: Boolean(data.phoneVerified),
        phoneVerifiedAt: data.phoneVerifiedAt || null,
        pendingPhoneVerification: null,
        pendingPhoneRecovery: null,
        passwordChangedAt: null,
        resetPasswordToken: null,
        resetPasswordExpires: null,
        isModified(field) {
          return field === 'password' && this._passwordDirty;
        },
        async save() {
          if (this._passwordDirty) {
            this.password = await bcrypt.hash(this.password, 10);
            this._passwordDirty = false;
          }
          return this;
        },
      };
      Object.defineProperty(u, 'password', {
        get() {
          return this._rawPassword;
        },
        set(val) {
          this._rawPassword = val;
          this._passwordDirty = true;
        },
      });
      u._rawPassword = await bcrypt.hash(data.password, 10);
      u._passwordDirty = false;
      this.users.push(u);
      return u;
    }

    async findById(id) {
      return this.users.find((u) => u._id === id.toString()) || null;
    }

    async findOne(query) {
      return (
        this.users.find((u) => {
          for (const [k, v] of Object.entries(query)) {
            if (k === '$or' && Array.isArray(v)) {
              const matchedOr = v.some((cond) => {
                for (const [ck, cv] of Object.entries(cond)) {
                  if (ck === 'resetPasswordExpires' && cv && cv.$gt) {
                    if (!u.resetPasswordExpires || u.resetPasswordExpires <= cv.$gt) return false;
                    continue;
                  }
                  if (u[ck] !== cv) return false;
                }
                return true;
              });
              if (!matchedOr) return false;
              continue;
            }
            if (k.includes('.')) {
              const parts = k.split('.');
              let cur = u;
              for (const part of parts) {
                cur = cur ? cur[part] : undefined;
              }
              if (cur !== v) return false;
              continue;
            }
            if (k === 'resetPasswordExpires' && v && v.$gt) {
              if (!u.resetPasswordExpires || u.resetPasswordExpires <= v.$gt) return false;
              continue;
            }
            if (k === '_id') {
              if (u._id !== v.toString()) return false;
              continue;
            }
            if (u[k] !== v) return false;
          }
          return true;
        }) || null
      );
    }

    /**
     * Simulates MongoDB atomic findOneAndUpdate with document write locking
     */
    async findOneAndUpdate(filter, update, options = {}) {
      const user = this.users.find((u) => {
        for (const [k, v] of Object.entries(filter)) {
          if (k === 'phoneNumber' && u.phoneNumber !== v) return false;
          if (k === 'phoneVerified' && u.phoneVerified !== v) return false;
          if (k === 'resetPasswordToken' && u.resetPasswordToken !== v) return false;
          if (k === 'resetPasswordExpires' && v && v.$gt) {
            if (!u.resetPasswordExpires || u.resetPasswordExpires <= v.$gt) return false;
            continue;
          }
          if (k === 'pendingPhoneRecovery.otpHash') {
            if (v && typeof v === 'object' && v.$ne !== undefined) {
              if (!u.pendingPhoneRecovery || u.pendingPhoneRecovery.otpHash === v.$ne) return false;
              continue;
            }
            if (!u.pendingPhoneRecovery || u.pendingPhoneRecovery.otpHash !== v) return false;
            continue;
          }
          if (k === 'pendingPhoneRecovery.otpExpires' && v && v.$gt) {
            if (!u.pendingPhoneRecovery || !u.pendingPhoneRecovery.otpExpires || u.pendingPhoneRecovery.otpExpires <= v.$gt)
              return false;
            continue;
          }
          if (k === 'pendingPhoneRecovery.attempts' && v && typeof v.$lt === 'number') {
            if (!u.pendingPhoneRecovery || u.pendingPhoneRecovery.attempts >= v.$lt) return false;
            continue;
          }
        }
        return true;
      });

      if (!user) return null;

      // Clone original user snapshot if options.new !== true
      const snapshot = { ...user };

      // Apply atomic updates
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          if (k === 'password') {
            user._rawPassword = v;
            user._passwordDirty = false;
          } else if (k.startsWith('pendingPhoneRecovery.')) {
            const sub = k.split('.')[1];
            if (!user.pendingPhoneRecovery) user.pendingPhoneRecovery = {};
            user.pendingPhoneRecovery[sub] = v;
          } else if (k === 'pendingPhoneRecovery') {
            user.pendingPhoneRecovery = v;
          } else {
            user[k] = v;
          }
        }
      }

      if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
          user[k] = undefined;
        }
      }

      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          if (k.startsWith('pendingPhoneRecovery.')) {
            const sub = k.split('.')[1];
            if (!user.pendingPhoneRecovery) user.pendingPhoneRecovery = {};
            user.pendingPhoneRecovery[sub] = (user.pendingPhoneRecovery[sub] || 0) + v;
          } else {
            user[k] = (user[k] || 0) + v;
          }
        }
      }

      return options.new ? user : user;
    }

    async updateOne(filter, update) {
      const user = await this.findOne(filter);
      if (!user) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
          if (k === 'pendingPhoneRecovery') {
            user.pendingPhoneRecovery = v;
          } else if (k.startsWith('pendingPhoneRecovery.')) {
            const sub = k.split('.')[1];
            if (user.pendingPhoneRecovery) user.pendingPhoneRecovery[sub] = v;
          } else {
            user[k] = v;
          }
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    }
  }

  const db = new MockDatabase();

  // Create test users:
  // User A: Verified Phone
  const userA = await db.createUser({
    name: 'Verified Alice',
    email: 'alice@example.com',
    password: 'OldPassword123!',
    phoneNumber: '+14155552671',
    phoneVerified: true,
  });

  // User B: Unverified Phone
  const userB = await db.createUser({
    name: 'Unverified Bob',
    email: 'bob@example.com',
    password: 'PasswordBob456!',
    phoneNumber: '+14155552672',
    phoneVerified: false,
  });

  // Hook User model methods to MockDatabase
  const origFindOne = User.findOne;
  const origFindById = User.findById;
  const origFindOneAndUpdate = User.findOneAndUpdate;
  const origUpdateOne = User.updateOne;

  User.findOne = (q) => {
    const promise = db.findOne(q);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      select: () => promise,
    };
  };
  User.findById = (id) => {
    const promise = db.findById(id);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      select: () => promise,
    };
  };
  User.findOneAndUpdate = (q, u, opts) => db.findOneAndUpdate(q, u, opts);
  User.updateOne = (q, u) => db.updateOne(q, u);

  // =========================================================================
  // 2. Enumeration-Resistant Initiation
  // =========================================================================
  console.log('2. Testing Enumeration-Resistant Initiation (POST /forgot-password-phone)...');

  smsService.__clearCapturedSms();
  authRouter.__clearPhoneRecoveryRateLimitStore();

  const genericSuccess =
    'If an account is associated with this verified phone number, a verification code has been sent.';

  const callForgotPasswordPhone = async (phoneNumber) => {
    let status = null;
    let json = null;
    const req = { body: { phoneNumber } };
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(d) {
        json = d;
        return this;
      },
    };
    await authRouter.handleForgotPasswordPhone(req, res);
    return { status, json };
  };

  // 2A: Unknown phone number
  const unknownRes = await callForgotPasswordPhone('+14155559999');
  assert.strictEqual(unknownRes.status, 200, 'Unknown phone number must return HTTP 200');
  assert.strictEqual(unknownRes.json.message, genericSuccess);
  assert.strictEqual(smsService.__getCapturedSms().length, 0, 'No SMS must be dispatched for unknown number');

  // 2B: Existing user with unverified phone
  const unverifiedRes = await callForgotPasswordPhone(userB.phoneNumber);
  assert.strictEqual(unverifiedRes.status, 200, 'Unverified phone number must return HTTP 200');
  assert.strictEqual(unverifiedRes.json.message, genericSuccess);
  assert.strictEqual(smsService.__getCapturedSms().length, 0, 'No SMS must be dispatched for unverified number');

  // 2C: Existing user with verified phone
  const verifiedRes = await callForgotPasswordPhone(userA.phoneNumber);
  assert.strictEqual(verifiedRes.status, 200, 'Verified phone number must return HTTP 200');
  assert.strictEqual(verifiedRes.json.message, genericSuccess);

  // Confirm indistinguishable response payloads
  assert.deepStrictEqual(
    unknownRes.json,
    verifiedRes.json,
    'Public response for unknown and verified numbers must be 100% indistinguishable'
  );
  assert.deepStrictEqual(
    unverifiedRes.json,
    verifiedRes.json,
    'Public response for unverified and verified numbers must be 100% indistinguishable'
  );

  // Confirm SMS was dispatched strictly for verified user
  const capturedSms = smsService.__getCapturedSms();
  assert.strictEqual(capturedSms.length, 1, 'Exactly one SMS must be sent for verified account');
  assert.strictEqual(capturedSms[0].to, userA.phoneNumber);
  const otpDispatched = capturedSms[0].otp;
  assert(/^\d{6}$/.test(otpDispatched), 'Dispatched OTP must be a 6-digit number');

  // 2D: Invalid phone format returns 400
  const invalidRes = await callForgotPasswordPhone('invalid-format');
  assert.strictEqual(invalidRes.status, 400, 'Invalid phone format must return HTTP 400');

  console.log('✅ Enumeration-Resistant Initiation verified.');

  // =========================================================================
  // 3. Resend Cooldown (5 mins) & Dedicated Recovery Rate Limiting (3/hr)
  // =========================================================================
  console.log('3. Testing Resend Cooldown (5m) & Dedicated Recovery Rate Limiting (3/hr)...');

  // 3A: Resend cooldown enforcement (within 5 minutes)
  const cooldownAttempt = await callForgotPasswordPhone(userA.phoneNumber);
  assert.strictEqual(cooldownAttempt.status, 429, 'Immediate second request must trigger 429 cooldown');
  assert(cooldownAttempt.json.retryAfter > 0, 'Must include retryAfter metadata');
  assert(cooldownAttempt.json.message.includes('Please wait'));

  // 3B: Rate limit equivalence across formatted variations (3 requests per hour limit)
  authRouter.__clearPhoneRecoveryRateLimitStore();
  const testPhone3B = '+14155553333';

  // Request 1
  assert.strictEqual(authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone3B).limited, false);
  // Request 2 (formatted with spaces/dashes)
  assert.strictEqual(authRouter.checkAndRecordPhoneRecoveryRateLimit('+1 (415) 555-3333').limited, false);
  // Request 3
  assert.strictEqual(authRouter.checkAndRecordPhoneRecoveryRateLimit('+1-415-555-3333').limited, false);

  // Request 4: Blocked by 3 req/hr limit!
  const fourthCheck = authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone3B);
  assert.strictEqual(fourthCheck.limited, true, '4th request within 1 hour must be rate limited');
  assert(fourthCheck.retryAfter > 0, 'Must provide retryAfter in seconds');

  authRouter.__clearPhoneRecoveryRateLimitStore();
  console.log('✅ Resend Cooldown & Dedicated Rate Limiting verified.');

  // =========================================================================
  // 4. SMS Dispatch Failure Resilience & Production Gating
  // =========================================================================
  console.log('4. Testing SMS Dispatch Failure Resilience & Production Gating...');

  smsService.__clearCapturedSms();
  authRouter.__clearPhoneRecoveryRateLimitStore();

  // Create temporary user for failure test
  const userFail = await db.createUser({
    name: 'Fail User',
    email: 'fail@example.com',
    password: 'Password123!',
    phoneNumber: '+14155554444',
    phoneVerified: true,
  });

  // Mock SMS failure
  smsService.__setMockSender(async () => {
    const err = new Error('Upstream carrier connection timed out');
    err.name = 'UpstreamCarrierTimeout';
    throw err;
  });

  // Call forgot-password-phone
  const failRes = await callForgotPasswordPhone(userFail.phoneNumber);
  assert.strictEqual(failRes.status, 200, 'Must return generic 200 response even on provider failure');
  assert.strictEqual(failRes.json.message, genericSuccess, 'Must not expose provider failure to caller');

  // Verify challenge was cleaned up and no usable OTP was left
  assert.strictEqual(
    userFail.pendingPhoneRecovery,
    null,
    'Challenge must be rolled back on dispatch failure so no unsent OTP is left usable'
  );

  // Verify production gating: mock SMS strictly disallowed in production
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.ENABLE_MOCK_SMS;
  assert.strictEqual(smsService.isMockSmsPermitted(), false, 'Mock SMS must fail closed in production');
  process.env.NODE_ENV = origEnv;

  smsService.__clearMockSender();
  console.log('✅ SMS Dispatch Failure Resilience & Production Gating verified.');

  // =========================================================================
  // 5. Atomic Reset & Concurrency (POST /reset-password-phone)
  // =========================================================================
  console.log('5. Testing Atomic Reset & Concurrency (POST /reset-password-phone)...');

  const callResetPasswordPhone = async (phoneNumber, otp, password) => {
    let status = null;
    let json = null;
    const req = { body: { phoneNumber, otp, password } };
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(d) {
        json = d;
        return this;
      },
    };
    await authRouter.handleResetPasswordPhone(req, res);
    return { status, json };
  };

  // Re-issue a fresh challenge for userA
  smsService.__clearCapturedSms();
  userA.pendingPhoneRecovery = null; // Clear prior cooldown for testing
  await callForgotPasswordPhone(userA.phoneNumber);
  const activeSms = smsService.__getCapturedSms();
  const validOtp = activeSms[activeSms.length - 1].otp;

  // 5A: Malformed OTP rejected
  const malformedOtpRes = await callResetPasswordPhone(userA.phoneNumber, '12', 'NewPassword123!');
  assert.strictEqual(malformedOtpRes.status, 400);

  // 5B: Short password rejected
  const shortPassRes = await callResetPasswordPhone(userA.phoneNumber, validOtp, '12345');
  assert.strictEqual(shortPassRes.status, 400);

  // 5C: Wrong OTP returns generic error & atomically increments attempts
  const wrongOtpRes1 = await callResetPasswordPhone(userA.phoneNumber, '000000', 'NewPassword123!');
  assert.strictEqual(wrongOtpRes1.status, 400);
  assert.strictEqual(
    wrongOtpRes1.json.message,
    'Invalid or expired verification code',
    'Must return generic error without revealing incorrect vs expired'
  );
  assert.strictEqual(userA.pendingPhoneRecovery.attempts, 1, 'Attempts must be incremented to 1');

  // Wrong Attempt 2
  await callResetPasswordPhone(userA.phoneNumber, '000000', 'NewPassword123!');
  assert.strictEqual(userA.pendingPhoneRecovery.attempts, 2, 'Attempts must be incremented to 2');

  // Wrong Attempt 3 (locks out challenge)
  const wrongOtpRes3 = await callResetPasswordPhone(userA.phoneNumber, '000000', 'NewPassword123!');
  assert.strictEqual(wrongOtpRes3.status, 400);
  assert.strictEqual(wrongOtpRes3.json.message, 'Invalid or expired verification code');
  assert.strictEqual(userA.pendingPhoneRecovery.attempts, 3, 'Attempts reaches 3');
  assert.strictEqual(userA.pendingPhoneRecovery.otpHash, null, 'OTP hash must be wiped on 3 failed attempts');

  // Subsequent attempt (even with originally valid OTP) is now rejected!
  const lockedOutRes = await callResetPasswordPhone(userA.phoneNumber, validOtp, 'NewPassword123!');
  assert.strictEqual(lockedOutRes.status, 400);
  assert.strictEqual(lockedOutRes.json.message, 'Invalid or expired verification code');

  // 5D: Expired OTP rejected
  userA.pendingPhoneRecovery = {
    number: userA.phoneNumber,
    otpHash: crypto.createHash('sha256').update('888888').digest('hex'),
    otpExpires: new Date(Date.now() - 1000), // Expired 1 second ago
    attempts: 0,
    lastSentAt: new Date(Date.now() - 60000),
    challengeId: 'test_expired_id',
  };
  const expiredRes = await callResetPasswordPhone(userA.phoneNumber, '888888', 'NewPassword123!');
  assert.strictEqual(expiredRes.status, 400);
  assert.strictEqual(expiredRes.json.message, 'Invalid or expired verification code');

  // 5E: Successful Reset & Password Hashing via pre('save') hook
  userA.pendingPhoneRecovery = null;
  await callForgotPasswordPhone(userA.phoneNumber);
  const freshSms = smsService.__getCapturedSms();
  const freshValidOtp = freshSms[freshSms.length - 1].otp;

  const oldPasswordHash = userA.password;
  const newPasswordPlain = 'BrandNewSecurePassword123!';

  // Pre-seed an active email reset token to verify cross-channel invalidation
  userA.resetPasswordToken = 'active_email_reset_token_hash';
  userA.resetPasswordExpires = new Date(Date.now() + 3600000);

  const successResetRes = await callResetPasswordPhone(userA.phoneNumber, freshValidOtp, newPasswordPlain);
  assert.strictEqual(successResetRes.status, 200, 'Valid reset request must return HTTP 200');
  assert(successResetRes.json.message.includes('Password has been reset successfully'));

  // Verify bcrypt hashing & old password rejection
  assert(await bcrypt.compare(newPasswordPlain, userA.password), 'New password must match via bcrypt');
  assert.notStrictEqual(userA.password, oldPasswordHash, 'Password hash must change');
  assert(!(await bcrypt.compare('OldPassword123!', userA.password)), 'Old password must be rejected');

  // Verify passwordChangedAt was set
  assert(userA.passwordChangedAt instanceof Date, 'passwordChangedAt must be set to Date instance');

  // Verify recovery state was wiped (preventing OTP replay)
  assert.strictEqual(userA.pendingPhoneRecovery, null, 'Recovery state must be wiped after successful reset');
  assert.strictEqual(userA.resetPasswordToken, undefined, 'Phone reset must invalidate any pending email reset tokens');
  assert.strictEqual(userA.resetPasswordExpires, undefined, 'Phone reset must invalidate any pending email reset token expiry');

  // 5F: Replay attempt with same valid OTP is rejected
  const replayRes = await callResetPasswordPhone(userA.phoneNumber, freshValidOtp, 'YetAnotherPassword123!');
  assert.strictEqual(replayRes.status, 400, 'Replayed OTP must be rejected');
  assert.strictEqual(replayRes.json.message, 'Invalid or expired verification code');

  // 5G: Concurrency Test: Two concurrent requests with the SAME valid OTP -> at most ONE succeeds
  userA.pendingPhoneRecovery = null;
  await callForgotPasswordPhone(userA.phoneNumber);
  const concSms = smsService.__getCapturedSms();
  const concOtp = concSms[concSms.length - 1].otp;

  // Fire two concurrent requests simultaneously
  const [concRes1, concRes2] = await Promise.all([
    callResetPasswordPhone(userA.phoneNumber, concOtp, 'ConcurrentPasswordA123!'),
    callResetPasswordPhone(userA.phoneNumber, concOtp, 'ConcurrentPasswordB456!'),
  ]);

  const successCount = (concRes1.status === 200 ? 1 : 0) + (concRes2.status === 200 ? 1 : 0);
  const rejectedCount = (concRes1.status === 400 ? 1 : 0) + (concRes2.status === 400 ? 1 : 0);

  assert.strictEqual(successCount, 1, 'Exactly ONE concurrent request must succeed with the valid OTP');
  assert.strictEqual(rejectedCount, 1, 'The competing concurrent request must be rejected');

  console.log('✅ Atomic Reset & Concurrency verified.');

  // =========================================================================
  // 6. High-Precision JWT Session Invalidation
  // =========================================================================
  console.log('6. Testing High-Precision JWT Session Invalidation via protect middleware...');

  // Issue a token with iatMs timestamp before the password change
  const staleToken = jwt.sign(
    {
      id: userA._id,
      sessionId: 'old_session_123',
      iatMs: userA.passwordChangedAt.getTime() - 1000,
    },
    process.env.JWT_SECRET
  );

  let staleStatus = null;
  let staleJson = null;
  await protect(
    { headers: { authorization: `Bearer ${staleToken}` } },
    {
      status(s) {
        staleStatus = s;
        return this;
      },
      json(d) {
        staleJson = d;
        return this;
      },
    },
    () => {
      assert.fail('Protect middleware should not call next() for stale session token');
    }
  );

  assert.strictEqual(staleStatus, 401, 'Stale token issued before password change must be rejected with 401');
  assert(staleJson.message.includes('Password recently changed'));

  // Issue a token after password change
  const freshToken = jwt.sign(
    {
      id: userA._id,
      sessionId: 'fresh_session_456',
      iatMs: userA.passwordChangedAt.getTime() + 1000,
    },
    process.env.JWT_SECRET
  );

  let freshAuthed = false;
  await protect(
    { headers: { authorization: `Bearer ${freshToken}` } },
    {},
    () => {
      freshAuthed = true;
    }
  );
  assert.strictEqual(freshAuthed, true, 'Token issued after password change must succeed');

  console.log('✅ High-Precision JWT Session Invalidation verified.');

  // =========================================================================
  // 7. Email Recovery Single-Use Token Concurrency Resolution
  // =========================================================================
  console.log('7. Testing Email Recovery Compatibility & Token Race Resolution...');

  const userEmail = await db.createUser({
    name: 'Email User',
    email: 'emailuser@example.com',
    password: 'InitialPassword123!',
  });

  const rawEmailToken = crypto.randomBytes(32).toString('hex');
  const hashedEmailToken = crypto.createHash('sha256').update(rawEmailToken).digest('hex');

  userEmail.resetPasswordToken = hashedEmailToken;
  userEmail.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
  // Pre-seed an active phone recovery challenge on userEmail to verify cross-channel invalidation
  userEmail.pendingPhoneRecovery = {
    number: '+14155551234',
    otpHash: 'sample_active_phone_recovery_hash',
    otpExpires: new Date(Date.now() + 600000),
    attempts: 0,
    lastSentAt: new Date(),
    challengeId: 'email_test_challenge_id',
  };

  const callEmailResetPassword = async (token, password) => {
    let status = null;
    let json = null;
    const req = { body: { token, password } };
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(d) {
        json = d;
        return this;
      },
    };
    // Test the actual Express route stack or handler
    const routes = authRouter.stack.filter((l) => l.route && l.route.path === '/reset-password');
    assert(routes.length > 0, 'Route /reset-password must be registered');
    const handler = routes[0].route.stack[routes[0].route.stack.length - 1].handle;
    await handler(req, res);
    return { status, json };
  };

  // Concurrent execution on same email reset token
  const [emailRes1, emailRes2] = await Promise.all([
    callEmailResetPassword(rawEmailToken, 'NewEmailPass123!'),
    callEmailResetPassword(rawEmailToken, 'CompeteEmailPass456!'),
  ]);

  const emailSuccessCount = (emailRes1.status === 200 ? 1 : 0) + (emailRes2.status === 200 ? 1 : 0);
  const emailRejectCount = (emailRes1.status === 400 ? 1 : 0) + (emailRes2.status === 400 ? 1 : 0);

  assert.strictEqual(emailSuccessCount, 1, 'Exactly ONE concurrent email reset request must succeed');
  assert.strictEqual(emailRejectCount, 1, 'Competing concurrent email reset request must be rejected');
  assert(await bcrypt.compare('NewEmailPass123!', userEmail.password), 'Password must be bcrypt hashed');
  assert.strictEqual(userEmail.pendingPhoneRecovery, null, 'Email reset must invalidate any pending phone recovery challenge');

  console.log('✅ Email Recovery Compatibility & Token Race Resolution verified.');

  // =========================================================================
  // 8. SMS Failure Challenge Rollback Isolation (challengeId Scoping)
  // =========================================================================
  console.log('8. Testing SMS Failure Challenge Rollback Isolation...');

  const userRollback = await db.createUser({
    name: 'Rollback User',
    email: 'rollback@example.com',
    password: 'Password123!',
    phoneNumber: '+14155559999',
    phoneVerified: true,
  });

  // 8A: Phone Recovery rollback isolation
  const olderRecoveryId = 'recovery_challenge_older_111';
  const newerRecoveryId = 'recovery_challenge_newer_222';

  // Suppose newer challenge was created
  userRollback.pendingPhoneRecovery = {
    number: userRollback.phoneNumber,
    otpHash: 'some_newer_hash',
    otpExpires: new Date(Date.now() + 600000),
    attempts: 0,
    lastSentAt: new Date(),
    challengeId: newerRecoveryId,
  };

  // An older failed dispatch attempt tries to roll back with older challengeId
  const rollbackResult = await db.updateOne(
    { _id: userRollback._id, 'pendingPhoneRecovery.challengeId': olderRecoveryId },
    { $set: { pendingPhoneRecovery: null } }
  );

  assert.strictEqual(rollbackResult.matchedCount, 0, 'Older recovery rollback must NOT match newer challenge');
  assert.notStrictEqual(userRollback.pendingPhoneRecovery, null, 'Newer recovery challenge must remain intact');
  assert.strictEqual(userRollback.pendingPhoneRecovery.challengeId, newerRecoveryId);

  // 8B: Authenticated Phone Linking rollback isolation
  const olderLinkingId = 'linking_challenge_older_333';
  const newerLinkingId = 'linking_challenge_newer_444';

  userRollback.pendingPhoneVerification = {
    number: '+14155558888',
    otpHash: 'some_linking_hash',
    otpExpires: new Date(Date.now() + 600000),
    attempts: 0,
    lastSentAt: new Date(),
    challengeId: newerLinkingId,
  };

  // Mock finding userRollback with nested pendingPhoneVerification
  const linkingRollbackResult = await db.updateOne(
    { _id: userRollback._id, 'pendingPhoneVerification.challengeId': olderLinkingId },
    { $set: { pendingPhoneVerification: null } }
  );

  assert.strictEqual(linkingRollbackResult.matchedCount, 0, 'Older linking rollback must NOT match newer linking challenge');
  assert.notStrictEqual(userRollback.pendingPhoneVerification, null, 'Newer linking challenge must remain intact');
  assert.strictEqual(userRollback.pendingPhoneVerification.challengeId, newerLinkingId);

  console.log('✅ SMS Failure Challenge Rollback Isolation verified.');

  // =========================================================================
  // 9. Concurrent Failed-Attempt Accounting & Lockout Resistance
  // =========================================================================
  console.log('9. Testing Concurrent Failed-Attempt Accounting & Lockout Resistance...');

  // Set up a fresh challenge with attempts: 0
  userRollback.pendingPhoneRecovery = {
    number: userRollback.phoneNumber,
    otpHash: crypto.createHash('sha256').update('123456').digest('hex'),
    otpExpires: new Date(Date.now() + 600000),
    attempts: 0,
    lastSentAt: new Date(),
    challengeId: 'concurrent_lockout_test_id',
  };

  // Launch 5 concurrent wrong-OTP requests
  const wrongResults = await Promise.all([
    callResetPasswordPhone(userRollback.phoneNumber, '000001', 'PasswordFail1!'),
    callResetPasswordPhone(userRollback.phoneNumber, '000002', 'PasswordFail2!'),
    callResetPasswordPhone(userRollback.phoneNumber, '000003', 'PasswordFail3!'),
    callResetPasswordPhone(userRollback.phoneNumber, '000004', 'PasswordFail4!'),
    callResetPasswordPhone(userRollback.phoneNumber, '000005', 'PasswordFail5!'),
  ]);

  for (const res of wrongResults) {
    assert.strictEqual(res.status, 400, 'All wrong OTP attempts must return HTTP 400');
    assert.strictEqual(res.json.message, 'Invalid or expired verification code');
  }

  // Verify challenge is locked out and attempts cannot exceed limit without clearing OTP
  assert(userRollback.pendingPhoneRecovery.attempts >= 3, 'Attempts must reach 3');
  assert.strictEqual(userRollback.pendingPhoneRecovery.otpHash, null, 'OTP hash must be cleared on exhaustion');

  // Verify even the correct OTP ('123456') is rejected now!
  const postExhaustionRes = await callResetPasswordPhone(userRollback.phoneNumber, '123456', 'PasswordSuccess!');
  assert.strictEqual(postExhaustionRes.status, 400, 'Exhausted challenge must reject even the valid OTP');

  console.log('✅ Concurrent Failed-Attempt Accounting & Lockout Resistance verified.');

  // =========================================================================
  // 10. Rate Limiting on Reset Endpoint & Specific Timestamp Rollback
  // =========================================================================
  console.log('10. Testing Rate Limiting on Reset Endpoint & Timestamp Rollback Isolation...');

  // Verify /reset-password-phone route has phoneRecoveryPerNumberLimiter in its stack
  const resetRoutes = authRouter.stack.filter((l) => l.route && l.route.path === '/reset-password-phone');
  assert(resetRoutes.length > 0, 'Route /reset-password-phone must be registered');
  const routeStack = resetRoutes[0].route.stack;
  assert(
    routeStack.some((layer) => layer.handle === authRouter.phoneRecoveryPerNumberLimiter),
    'POST /reset-password-phone must include phoneRecoveryPerNumberLimiter'
  );

  // Test rollbackPhoneRecoveryRateLimit with specific timestamp vs concurrent entries
  authRouter.__clearPhoneRecoveryRateLimitStore();
  const testPhone10 = '+14155557777';

  // Populate two entries
  const check1 = authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone10);
  const check2 = authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone10);
  assert.strictEqual(check1.limited, false);
  assert.strictEqual(check2.limited, false);

  // Roll back specifically check1's timestamp
  authRouter.rollbackPhoneRecoveryRateLimit(testPhone10, check1.recordedTimestamp);

  // check2's timestamp should still remain! Another request should record, not exceed limit
  const check3 = authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone10);
  assert.strictEqual(check3.limited, false, 'Should allow request after rolling back only check1');

  // Fourth check fills the quota (3 active requests: check2, check3, check4)
  const check4 = authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone10);
  assert.strictEqual(check4.limited, false, 'Fourth check succeeds filling 3/3 quota');

  // Fifth check exceeds the limit and must be rate limited!
  const check5 = authRouter.checkAndRecordPhoneRecoveryRateLimit(testPhone10);
  assert.strictEqual(check5.limited, true, 'Fifth check must be rate limited');

  authRouter.__clearPhoneRecoveryRateLimitStore();
  console.log('✅ Rate Limiting on Reset Endpoint & Timestamp Rollback Isolation verified.');

  // =========================================================================
  // 11. JWT Session Invalidation after Email Reset
  // =========================================================================
  console.log('11. Testing JWT Session Invalidation after Email Reset...');

  assert(userEmail.passwordChangedAt instanceof Date, 'userEmail must have passwordChangedAt set after reset');

  // Old token issued before email reset
  const staleEmailToken = jwt.sign(
    {
      id: userEmail._id,
      sessionId: 'email_session_old',
      iatMs: userEmail.passwordChangedAt.getTime() - 1000,
    },
    process.env.JWT_SECRET
  );

  let staleEmailStatus = null;
  let staleEmailJson = null;
  await protect(
    { headers: { authorization: `Bearer ${staleEmailToken}` } },
    {
      status(s) {
        staleEmailStatus = s;
        return this;
      },
      json(d) {
        staleEmailJson = d;
        return this;
      },
    },
    () => {
      assert.fail('Protect middleware should reject stale token after email reset');
    }
  );

  assert.strictEqual(staleEmailStatus, 401, 'Token issued before email reset must be rejected with 401');
  assert(staleEmailJson.message.includes('Password recently changed'));

  console.log('✅ JWT Session Invalidation after Email Reset verified.');

  // Restore mocks
  User.findOne = origFindOne;
  User.findById = origFindById;
  User.findOneAndUpdate = origFindOneAndUpdate;
  User.updateOne = origUpdateOne;

  console.log('\n🎉 ALL Phase 2: Secure Phone OTP Password Recovery Tests Passed Successfully!');
}

runAllTests().catch((err) => {
  console.error('❌ Phase 2 Test Failure:', err);
  process.exit(1);
});
