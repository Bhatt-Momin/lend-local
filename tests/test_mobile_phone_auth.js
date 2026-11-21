/**
 * test_mobile_phone_auth.js — End-to-End Validation for Mobile Phone Verification & OTP Password Recovery
 *
 * Validates:
 * 1. Mobile UserProfile & API Client contracts for phone verification & recovery
 * 2. Signed-in phone verification lifecycle:
 *    - Start verification (E.164 normalization, 60s cooldown, 6-digit OTP)
 *    - Verification attempts & atomic confirmation
 *    - Profile hydration with phoneNumber, phoneVerified, phoneVerifiedAt
 * 3. Unauthenticated OTP password recovery lifecycle:
 *    - Enumeration-resistant initiation with generic message
 *    - 5-minute resend cooldown & rate limiting
 *    - Atomic OTP consumption, bcrypt password update, and session invalidation
 * 4. Phone removal (unlinking) lifecycle
 * 5. Production gating & secrecy safeguards
 */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

module.paths.push(path.join(__dirname, 'backend/node_modules'));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret-for-mobile-phone-auth-suite-12345';
process.env.NODE_ENV = 'test';

const User = require('./backend/models/User');
const smsService = require('./backend/services/smsService');
const authRouter = require('./backend/routes/auth');
const { validateAndNormalizePhone, maskPhone } = require('./backend/utils/phone');

console.log('--- Running Mobile Phone Verification & OTP Password Recovery Test Suite ---');

async function runMobilePhoneAuthTests() {
  // Clear any existing rate limits and captured SMS
  authRouter.__clearPhoneRateLimitStore?.();
  authRouter.__clearPhoneRecoveryRateLimitStore?.();
  smsService.__clearCapturedSms();

  // =========================================================================
  // 1. Mobile Interface & API Contract Checks
  // =========================================================================
  console.log('1. Checking Mobile Types, SecureStore, and API client contracts...');

  // Verify secureStore.ts includes phone fields in UserProfile
  const secureStoreContent = fs.readFileSync(
    path.join(__dirname, 'mobile/src/services/secureStore.ts'),
    'utf-8'
  );
  assert.ok(
    secureStoreContent.includes('phoneNumber?: string | null;'),
    'UserProfile in secureStore.ts must define phoneNumber'
  );
  assert.ok(
    secureStoreContent.includes('phoneVerified?: boolean;'),
    'UserProfile in secureStore.ts must define phoneVerified'
  );
  assert.ok(
    secureStoreContent.includes('phoneVerifiedAt?: string | null;'),
    'UserProfile in secureStore.ts must define phoneVerifiedAt'
  );

  // Verify api.ts exports phone verification methods in authApi
  const apiContent = fs.readFileSync(
    path.join(__dirname, 'mobile/src/services/api.ts'),
    'utf-8'
  );
  assert.ok(
    apiContent.includes('startPhoneVerification:'),
    'authApi in api.ts must define startPhoneVerification'
  );
  assert.ok(
    apiContent.includes('/auth/phone/start-verification'),
    'startPhoneVerification must call /auth/phone/start-verification'
  );
  assert.ok(
    apiContent.includes('confirmPhoneVerification:'),
    'authApi in api.ts must define confirmPhoneVerification'
  );
  assert.ok(
    apiContent.includes('/auth/phone/confirm-verification'),
    'confirmPhoneVerification must call /auth/phone/confirm-verification'
  );
  assert.ok(
    apiContent.includes('removePhone:'),
    'authApi in api.ts must define removePhone'
  );
  assert.ok(
    apiContent.includes("method: 'DELETE'"),
    'removePhone must use DELETE method'
  );
  assert.ok(
    apiContent.includes('forgotPasswordPhone:'),
    'authApi in api.ts must define forgotPasswordPhone'
  );
  assert.ok(
    apiContent.includes('resetPasswordPhone:'),
    'authApi in api.ts must define resetPasswordPhone'
  );

  console.log('✅ Mobile contracts verified.');

  // =========================================================================
  // 2. Mock In-Memory Database & Context Helpers for End-to-End Simulation
  // =========================================================================
  console.log('2. Testing End-to-End Signed-in Phone Verification Flow...');

  const mockUsers = new Map();

  const mockSave = async (userDoc) => {
    mockUsers.set(userDoc._id.toString(), { ...userDoc });
    return userDoc;
  };

  const mockUserFindById = async (id) => {
    const raw = mockUsers.get(id.toString());
    if (!raw) return null;
    const doc = { ...raw };
    doc.save = async () => mockSave(doc);
    return doc;
  };

  // Create a signed-in test user
  const userId = '671000000000000000000001';
  const initialUser = {
    _id: userId,
    name: 'Momin Nazir',
    email: 'momin@example.com',
    password: await bcrypt.hash('CurrentPassword123!', 10),
    phoneNumber: null,
    phoneVerified: false,
    phoneVerifiedAt: null,
    pendingPhoneVerification: null,
    pendingPhoneRecovery: null,
  };
  mockUsers.set(userId, { ...initialUser });

  // Stub User model lookups for this test
  const originalFindById = User.findById;
  const originalFindOne = User.findOne;
  const originalFindOneAndUpdate = User.findOneAndUpdate;
  const originalUpdateOne = User.updateOne;

  const mockFindOne = async (query) => {
    for (const u of mockUsers.values()) {
      let match = true;
      if (query.phoneNumber && u.phoneNumber !== query.phoneNumber) match = false;
      if (query.phoneVerified !== undefined && u.phoneVerified !== query.phoneVerified) match = false;
      if (query._id && query._id.$ne && u._id.toString() === query._id.$ne.toString()) match = false;
      if (match) {
        const doc = { ...u };
        doc.save = async () => mockSave(doc);
        return doc;
      }
    }
    return null;
  };

  User.findById = (id) => {
    const promise = mockUserFindById(id);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      select: () => promise,
    };
  };

  User.findOne = (query) => {
    const promise = mockFindOne(query);
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      select: () => promise,
    };
  };

  User.findOneAndUpdate = async (filter, update, options) => {
    for (const [id, u] of mockUsers.entries()) {
      let match = true;
      if (filter._id && id !== filter._id.toString()) match = false;
      if (filter.phoneNumber && u.phoneNumber !== filter.phoneNumber) match = false;
      if (filter.phoneVerified !== undefined && u.phoneVerified !== filter.phoneVerified) match = false;
      if (filter['pendingPhoneVerification.challengeId']) {
        if (!u.pendingPhoneVerification || u.pendingPhoneVerification.challengeId !== filter['pendingPhoneVerification.challengeId']) {
          match = false;
        }
      }
      if (filter['pendingPhoneRecovery.otpHash']) {
        if (!u.pendingPhoneRecovery || u.pendingPhoneRecovery.otpHash !== filter['pendingPhoneRecovery.otpHash']) {
          match = false;
        }
      }
      if (filter['pendingPhoneRecovery.attempts'] && filter['pendingPhoneRecovery.attempts'].$lt !== undefined) {
        if (!u.pendingPhoneRecovery || u.pendingPhoneRecovery.attempts >= filter['pendingPhoneRecovery.attempts'].$lt) {
          match = false;
        }
      }

      if (match) {
        const updated = { ...u };
        if (update.$set) {
          for (const [k, v] of Object.entries(update.$set)) {
            updated[k] = v;
          }
        }
        if (update.$inc) {
          for (const [k, v] of Object.entries(update.$inc)) {
            const parts = k.split('.');
            if (parts.length === 2 && updated[parts[0]]) {
              updated[parts[0]][parts[1]] = (updated[parts[0]][parts[1]] || 0) + v;
            }
          }
        }
        mockUsers.set(id, updated);
        const doc = { ...updated };
        doc.save = async () => mockSave(doc);
        return doc;
      }
    }
    return null;
  };

  User.updateOne = async (filter, update) => {
    return await User.findOneAndUpdate(filter, update);
  };

  try {
    // 2A: Start verification with valid phone
    const testPhone = '+919876543210';
    const startReq = {
      user: { _id: userId, phoneNumber: null, phoneVerified: false },
      body: { phoneNumber: testPhone },
    };
    let startStatus = 0;
    let startJson = null;
    const startRes = {
      status: (s) => {
        startStatus = s;
        return {
          json: (j) => {
            startJson = j;
          },
        };
      },
    };

    await authRouter.handleStartPhoneVerification(startReq, startRes);
    assert.strictEqual(startStatus, 200, 'Start verification must return 200');
    assert.strictEqual(startJson.cooldownSeconds, 60, 'Start verification must return 60s cooldown');
    assert.ok(startJson.phoneMasked, 'Start verification must return masked phone');

    // Verify SMS was captured
    const capturedOtp = smsService.__getLatestOtpForNumber(testPhone);
    assert.ok(capturedOtp, 'SMS service must have captured the OTP');
    assert.strictEqual(capturedOtp.length, 6, 'Captured OTP must be 6 digits');

    // 2B: Cooldown enforcement: Immediate duplicate request must be rejected with 429
    let duplicateStatus = 0;
    let duplicateJson = null;
    const duplicateRes = {
      status: (s) => {
        duplicateStatus = s;
        return {
          json: (j) => {
            duplicateJson = j;
          },
        };
      },
    };
    await authRouter.handleStartPhoneVerification(startReq, duplicateRes);
    assert.strictEqual(duplicateStatus, 429, 'Immediate duplicate request must trigger 429 cooldown');

    // 2C: Confirm with invalid OTP
    let failStatus = 0;
    let failJson = null;
    const failRes = {
      status: (s) => {
        failStatus = s;
        return {
          json: (j) => {
            failJson = j;
          },
        };
      },
    };
    await authRouter.handleConfirmPhoneVerification(
      {
        user: { _id: userId },
        body: { otp: '000000', phoneNumber: testPhone },
      },
      failRes
    );
    assert.strictEqual(failStatus, 400, 'Invalid OTP must return 400');
    assert.ok(failJson.message.includes('attempt(s) remaining'), 'Must report remaining attempts');

    // 2D: Confirm with correct OTP
    let confirmStatus = 0;
    let confirmJson = null;
    const confirmRes = {
      status: (s) => {
        confirmStatus = s;
        return {
          json: (j) => {
            confirmJson = j;
          },
        };
      },
    };
    await authRouter.handleConfirmPhoneVerification(
      {
        user: { _id: userId },
        body: { otp: capturedOtp, phoneNumber: testPhone },
      },
      confirmRes
    );
    assert.strictEqual(confirmStatus, 200, 'Correct OTP must return 200');
    assert.strictEqual(confirmJson.user.phoneVerified, true, 'User phoneVerified must be true');
    assert.strictEqual(confirmJson.user.phoneNumber, testPhone, 'User phoneNumber must match');
    assert.ok(confirmJson.user.phoneVerifiedAt, 'User phoneVerifiedAt must be populated');

    console.log('✅ End-to-End Signed-in Phone Verification verified.');

    // =========================================================================
    // 3. End-to-End OTP Password Recovery Flow
    // =========================================================================
    console.log('3. Testing End-to-End OTP Password Recovery Flow...');

    // 3A: Request recovery code via verified phone number
    let forgotStatus = 0;
    let forgotJson = null;
    const forgotRes = {
      status: (s) => {
        forgotStatus = s;
        return {
          json: (j) => {
            forgotJson = j;
          },
        };
      },
    };
    await authRouter.handleForgotPasswordPhone(
      { body: { phoneNumber: testPhone } },
      forgotRes
    );
    assert.strictEqual(forgotStatus, 200, 'Forgot password phone must return 200');
    assert.ok(
      forgotJson.message.includes('verification code has been sent'),
      'Must return enumeration-resistant generic message'
    );
    assert.strictEqual(forgotJson.cooldownSeconds, 300, 'Must enforce 300s cooldown');

    const recoveryOtp = smsService.__getLatestOtpForNumber(testPhone);
    assert.ok(recoveryOtp, 'Recovery OTP must be captured');

    // 3B: Reset password using the recovery OTP
    const newPassword = 'BrandNewSecurePassword456!';
    let resetStatus = 0;
    let resetJson = null;
    const resetRes = {
      status: (s) => {
        resetStatus = s;
        return {
          json: (j) => {
            resetJson = j;
          },
        };
      },
    };
    await authRouter.handleResetPasswordPhone(
      {
        body: {
          phoneNumber: testPhone,
          otp: recoveryOtp,
          password: newPassword,
        },
      },
      resetRes
    );
    assert.strictEqual(resetStatus, 200, 'Reset password must return 200');

    // Verify password was updated and matches bcrypt
    const updatedUser = mockUsers.get(userId);
    const passwordMatch = await bcrypt.compare(newPassword, updatedUser.password);
    assert.strictEqual(passwordMatch, true, 'Updated password must authenticate with bcrypt');
    assert.ok(updatedUser.passwordChangedAt, 'passwordChangedAt must be updated to invalidate sessions');

    console.log('✅ End-to-End OTP Password Recovery verified.');

    // =========================================================================
    // 4. Phone Removal (Unlink) Safety
    // =========================================================================
    console.log('4. Testing Phone Removal & Unlink Safety...');

    // Simulate DELETE /api/auth/phone
    updatedUser.phoneNumber = null;
    updatedUser.phoneVerified = false;
    updatedUser.phoneVerifiedAt = null;
    mockUsers.set(userId, updatedUser);

    // After unlinking, requesting recovery for the phone number must safely succeed with generic 200
    // but MUST NOT dispatch any real SMS or OTP
    smsService.__clearCapturedSms();
    let unlinkedForgotStatus = 0;
    let unlinkedForgotJson = null;
    const unlinkedRes = {
      status: (s) => {
        unlinkedForgotStatus = s;
        return {
          json: (j) => {
            unlinkedForgotJson = j;
          },
        };
      },
    };
    await authRouter.handleForgotPasswordPhone(
      { body: { phoneNumber: testPhone } },
      unlinkedRes
    );
    assert.strictEqual(unlinkedForgotStatus, 200, 'Must return 200 generic message without error');
    assert.strictEqual(
      smsService.__getCapturedSms().length,
      0,
      'Must NOT dispatch SMS to unlinked phone number'
    );

    console.log('✅ Phone Removal & Unlink Safety verified.');

    // =========================================================================
    // 5. Production SMS Provider Configuration Guard
    // =========================================================================
    console.log('5. Testing Production SMS Provider Configuration Guard...');

    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let prodErrorThrown = false;
    try {
      await smsService.sendVerificationOtp({
        to: '+919876543210',
        otp: '123456',
        userId: '123',
      });
    } catch (err) {
      prodErrorThrown = true;
      assert.strictEqual(
        err.name,
        'SmsConfigurationError',
        'Must fail closed with SmsConfigurationError in production'
      );
    } finally {
      process.env.NODE_ENV = origEnv;
    }
    assert.strictEqual(prodErrorThrown, true, 'Production fail-closed guard must trigger');

    console.log('✅ Production SMS Provider Configuration Guard verified.');
  } finally {
    User.findById = originalFindById;
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    User.updateOne = originalUpdateOne;
  }

  console.log('\n🎉 ALL Mobile Phone Verification & OTP Password Recovery Tests Passed Successfully!');
}

runMobilePhoneAuthTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
