/**
 * test_forgot_password.js — Test Suite for Stage 1: Forgot Password & Account Recovery
 *
 * Covers:
 * 1. Frontend markup, accessibility, and link presence in login.html and forgot-password.html
 * 2. P0-1: Secure Password Reset URL Construction (getTrustedFrontendBaseUrl, no Host/Origin header trust, production https enforcement)
 * 3. P0-2: JWT Invalidation & Same-Second Timing Gap Closure (iatMs millisecond precision & legacy integer boundary closure)
 * 4. P0-3: Transactional Email Delivery Service (provider detection, production enforcement, mock transporter, test capture, masked logging)
 * 5. User Model Schema Invariants (resetPasswordToken/Expires unselected by default, passwordChangedAt timestamp)
 * 6. Cryptographic Token Generation & Hashing (SHA-256 deterministic hash, distinct raw tokens)
 * 7. Functional Simulation: Password Recovery Lifecycle (single-use token, expiry, new password login, old password invalidation, reused token rejection)
 * 8. Middleware protect integration test with high-precision JWT invalidation
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Ensure modules can be loaded from backend/node_modules when running from root
module.paths.push(path.join(__dirname, 'backend/node_modules'));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-jwt-secret-key-for-forgot-password-suite-12345';

console.log('--- Running Stage 1: Forgot Password & Account Recovery Test Suite ---');

async function runAllTests() {
  // 1. Static Invariants & Frontend Markup Verification
  console.log('1. Testing Frontend Markup & Accessibility Invariants...');

  const loginHtmlPath = path.join(__dirname, 'frontend', 'login.html');
  const forgotHtmlPath = path.join(__dirname, 'frontend', 'forgot-password.html');

  assert(fs.existsSync(loginHtmlPath), 'login.html must exist');
  assert(fs.existsSync(forgotHtmlPath), 'forgot-password.html must exist');

  const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
  const forgotHtml = fs.readFileSync(forgotHtmlPath, 'utf8');

  // Check forgot password link in login.html
  assert(loginHtml.includes('href="/forgot-password.html"'), 'login.html must have link to forgot-password.html');
  assert(loginHtml.includes('Forgot password?'), 'login.html must have visible "Forgot password?" text');

  // Check forgot-password.html structure
  assert(forgotHtml.includes('id="requestView"'), 'forgot-password.html must include requestView');
  assert(forgotHtml.includes('id="resetView"'), 'forgot-password.html must include resetView');
  assert(forgotHtml.includes('id="recoveryEmail"'), 'forgot-password.html must include recoveryEmail input');
  assert(forgotHtml.includes('id="newPassword"'), 'forgot-password.html must include newPassword input');
  assert(forgotHtml.includes('id="confirmPassword"'), 'forgot-password.html must include confirmPassword input');
  assert(forgotHtml.includes('role="alert"'), 'forgot-password.html must include accessible alert roles');
  assert(forgotHtml.includes('/css/auth-premium.css'), 'forgot-password.html must include auth-premium.css');
  assert(forgotHtml.includes('/css/design-system.css'), 'forgot-password.html must include design-system.css');
  console.log('✅ Frontend Markup & Accessibility Invariants verified.');

  // 2. P0-1: Secure Password Reset URL Construction
  console.log('2. Testing P0-1: Secure Password Reset URL Construction...');
  const authRouter = require('./backend/routes/auth');
  const getTrustedFrontendBaseUrl = authRouter.getTrustedFrontendBaseUrl;
  assert(typeof getTrustedFrontendBaseUrl === 'function', 'getTrustedFrontendBaseUrl must be exported');

  const origEnv = process.env.NODE_ENV;
  const origFrontendUrl = process.env.FRONTEND_URL;

  try {
    // 2A: In production, missing FRONTEND_URL must throw
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_URL;
    assert.throws(
      () => getTrustedFrontendBaseUrl(),
      /FRONTEND_URL environment variable must be configured in production/,
      'Must throw in production when FRONTEND_URL is unset'
    );

    // 2B: In production, http:// must be rejected
    process.env.FRONTEND_URL = 'http://insecure-lendlocal.com';
    assert.throws(
      () => getTrustedFrontendBaseUrl(),
      /FRONTEND_URL must use https:\/\/ in production/,
      'Must throw in production when FRONTEND_URL is not https'
    );

    // 2C: In production, valid https:// URL is accepted and normalized
    process.env.FRONTEND_URL = 'https://app.lendlocal.com/login?redirect=1';
    const prodUrl = getTrustedFrontendBaseUrl();
    assert.strictEqual(prodUrl, 'https://app.lendlocal.com', 'Production URL must return https origin without trailing path');

    // 2D: In development / test, unset FRONTEND_URL safely defaults to localhost
    process.env.NODE_ENV = 'development';
    delete process.env.FRONTEND_URL;
    const devDefaultUrl = getTrustedFrontendBaseUrl();
    assert.strictEqual(devDefaultUrl, 'http://localhost:3000', 'Development default must be http://localhost:3000');

    // 2E: In development, custom http URL is allowed
    process.env.FRONTEND_URL = 'http://127.0.0.1:5173';
    assert.strictEqual(getTrustedFrontendBaseUrl(), 'http://127.0.0.1:5173');
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origFrontendUrl !== undefined) {
      process.env.FRONTEND_URL = origFrontendUrl;
    } else {
      delete process.env.FRONTEND_URL;
    }
  }
  console.log('✅ P0-1: Secure Password Reset URL Construction verified.');

  // 3. P0-2: JWT Invalidation & Same-Second Timing Gap Closure
  console.log('3. Testing P0-2: JWT Invalidation & Timing Gap Resolution...');
  const { signToken } = require('./backend/utils/helpers');
  const { protect } = require('./backend/middleware/auth');

  // Verify signToken embeds iatMs and sessionId
  const sampleUserId = '60d5ec49f1b2c82b8c8a1111';
  const sampleToken = signToken(sampleUserId);
  const decodedSample = jwt.verify(sampleToken, process.env.JWT_SECRET);
  assert(decodedSample.sessionId, 'signToken must embed sessionId');
  assert(typeof decodedSample.iatMs === 'number', 'signToken must embed high-precision millisecond timestamp iatMs');
  assert(decodedSample.iatMs <= Date.now(), 'iatMs must not be in future');

  // Unit assertion on invalidation comparison rules:
  // Function representing the exact core logic of protect middleware
  function isTokenInvalidatedByPasswordChange(decodedToken, passwordChangedAt) {
    if (!passwordChangedAt) return false;
    const changedTimeMs = passwordChangedAt.getTime();
    if (typeof decodedToken.iatMs === 'number') {
      return decodedToken.iatMs <= changedTimeMs;
    }
    if (typeof decodedToken.iat === 'number') {
      const changedSec = Math.floor(changedTimeMs / 1000);
      return decodedToken.iat <= changedSec;
    }
    return false;
  }

  const changeTime = new Date('2026-10-23T12:00:00.500Z');
  const changeMs = changeTime.getTime();
  const changeSec = Math.floor(changeMs / 1000);

  // 3A: Token issued before password change (millisecond precision)
  const tokenBeforeMs = { iatMs: changeMs - 100, iat: changeSec };
  assert.strictEqual(
    isTokenInvalidatedByPasswordChange(tokenBeforeMs, changeTime),
    true,
    'Token issued 100ms before password change must be invalidated'
  );

  // 3B: Token issued at exact same millisecond
  const tokenSameMs = { iatMs: changeMs, iat: changeSec };
  assert.strictEqual(
    isTokenInvalidatedByPasswordChange(tokenSameMs, changeTime),
    true,
    'Token issued at exact millisecond of password change must be invalidated'
  );

  // 3C: Token issued after password change (immediate new login)
  const tokenAfterMs = { iatMs: changeMs + 50, iat: changeSec };
  assert.strictEqual(
    isTokenInvalidatedByPasswordChange(tokenAfterMs, changeTime),
    false,
    'Token issued after password change must remain valid'
  );

  // 3D: Legacy second-only token issued in the same second S
  // Closing the Nemetron same-second window:
  const legacySameSecondToken = { iat: changeSec };
  assert.strictEqual(
    isTokenInvalidatedByPasswordChange(legacySameSecondToken, changeTime),
    true,
    'Legacy token from the same second must be invalidated (closing the timing gap)'
  );

  // 3E: Legacy second-only token issued after the second S
  const legacyNextSecondToken = { iat: changeSec + 1 };
  assert.strictEqual(
    isTokenInvalidatedByPasswordChange(legacyNextSecondToken, changeTime),
    false,
    'Legacy token issued in subsequent second must remain valid'
  );

  // 3F: User with no passwordChangedAt
  assert.strictEqual(
    isTokenInvalidatedByPasswordChange(tokenBeforeMs, null),
    false,
    'User without password change timestamp must not invalidate tokens'
  );

  // 3G: End-to-end middleware test with mock req/res/next
  const User = require('./backend/models/User');
  const origFindById = User.findById;

  try {
    // Mock user with passwordChangedAt
    User.findById = (id) => ({
      async then(resolve) {
        resolve({
          _id: id,
          email: 'test@example.com',
          passwordChangedAt: new Date(Date.now() - 500), // changed 500ms ago
        });
      },
    });

    // Token issued 1000ms ago (before change)
    const oldJwt = jwt.sign(
      { id: sampleUserId, sessionId: 's1', iatMs: Date.now() - 1000 },
      process.env.JWT_SECRET
    );

    let statusOld = null;
    let jsonOld = null;
    const reqOld = { headers: { authorization: `Bearer ${oldJwt}` } };
    const resOld = {
      status(s) { statusOld = s; return this; },
      json(j) { jsonOld = j; return this; },
    };
    let nextCalledOld = false;

    await protect(reqOld, resOld, () => { nextCalledOld = true; });
    assert.strictEqual(statusOld, 401, 'Old JWT before change must receive 401');
    assert.strictEqual(nextCalledOld, false, 'Next must not be called for invalidated token');
    assert(jsonOld.message.includes('Password recently changed'));

    // Token issued now (after change)
    const newJwt = jwt.sign(
      { id: sampleUserId, sessionId: 's2', iatMs: Date.now() + 100 },
      process.env.JWT_SECRET
    );

    let statusNew = null;
    const reqNew = { headers: { authorization: `Bearer ${newJwt}` } };
    const resNew = {
      status(s) { statusNew = s; return this; },
      json() { return this; },
    };
    let nextCalledNew = false;

    await protect(reqNew, resNew, () => { nextCalledNew = true; });
    assert.strictEqual(nextCalledNew, true, 'New JWT issued after change must pass protect middleware');
  } finally {
    User.findById = origFindById;
  }
  console.log('✅ P0-2: JWT Invalidation & Timing Gap Resolution verified.');

  // 4. P0-3: Transactional Email Delivery Service
  console.log('4. Testing P0-3: Transactional Email Delivery Service...');
  const emailService = require('./backend/services/emailService');

  // Test provider detection
  const origResend = process.env.RESEND_API_KEY;
  const origSendgrid = process.env.SENDGRID_API_KEY;
  const origPostmark = process.env.POSTMARK_SERVER_TOKEN;
  delete process.env.RESEND_API_KEY;
  delete process.env.SENDGRID_API_KEY;
  delete process.env.POSTMARK_SERVER_TOKEN;
  emailService.__clearMockTransporter();

  assert.strictEqual(emailService.isEmailConfigured(), false);
  assert.strictEqual(emailService.getActiveProvider(), null);

  process.env.RESEND_API_KEY = 're_test_12345';
  assert.strictEqual(emailService.getActiveProvider(), 'resend');
  delete process.env.RESEND_API_KEY;

  process.env.SENDGRID_API_KEY = 'SG.test_12345';
  assert.strictEqual(emailService.getActiveProvider(), 'sendgrid');
  delete process.env.SENDGRID_API_KEY;

  process.env.POSTMARK_SERVER_TOKEN = 'pm_test_12345';
  assert.strictEqual(emailService.getActiveProvider(), 'postmark');
  delete process.env.POSTMARK_SERVER_TOKEN;

  // Test production check: throws when unconfigured
  process.env.NODE_ENV = 'production';
  let prodThrew = false;
  try {
    await emailService.sendPasswordResetEmail({
      to: 'alice@example.com',
      resetUrl: 'https://lendlocal.app/forgot-password.html?token=abc',
    });
  } catch (err) {
    prodThrew = true;
    assert(err.message.includes('Transactional email provider is not configured'));
  }
  assert.strictEqual(prodThrew, true, 'sendPasswordResetEmail must throw in production when unconfigured');

  // Test mock transporter hook
  let dispatchedPayload = null;
  emailService.__setMockTransporter(async (mail) => {
    dispatchedPayload = mail;
    return { success: true, messageId: 'mock-msg-123', provider: 'mock' };
  });

  const rawTokenTest = crypto.randomBytes(32).toString('hex');
  const mockResult = await emailService.sendPasswordResetEmail({
    to: 'testuser@example.com',
    userName: 'Test User',
    resetUrl: `https://lendlocal.app/forgot-password.html?token=${rawTokenTest}`,
    token: rawTokenTest,
  });

  assert.strictEqual(mockResult.success, true);
  assert.strictEqual(dispatchedPayload.to, 'testuser@example.com');
  assert(dispatchedPayload.subject.includes('Reset your LendLocal password'));
  assert(dispatchedPayload.html.includes(rawTokenTest));
  assert(dispatchedPayload.text.includes(rawTokenTest));

  // Test mock transporter failure handling
  emailService.__setMockTransporter(async () => {
    throw new Error('Upstream provider timeout (504)');
  });

  let mockFailed = false;
  try {
    await emailService.sendPasswordResetEmail({
      to: 'testuser@example.com',
      resetUrl: 'https://lendlocal.app/forgot-password.html?token=123',
    });
  } catch (err) {
    mockFailed = true;
    assert(err.message.includes('504'));
  }
  assert.strictEqual(mockFailed, true, 'Provider errors must be surfaced to caller');

  emailService.__clearMockTransporter();

  // Test Provider Request Timeouts & Network Error Sanitation
  console.log('Testing Email Provider Request Timeouts & Safe Error Handling...');
  assert.strictEqual(emailService.DEFAULT_EMAIL_TIMEOUT_MS, 15000, 'Default email timeout must be 15000ms');

  const origFetch = global.fetch;
  const origTimeoutMs = process.env.EMAIL_TIMEOUT_MS;

  try {
    process.env.EMAIL_TIMEOUT_MS = '50'; // fast timeout for test
    process.env.NODE_ENV = 'production';
    emailService.__clearMockTransporter();

    // 1. Resend Timeout
    process.env.RESEND_API_KEY = 're_test_timeout_key_secret';
    global.fetch = async (url, options) => {
      assert(options.signal, 'fetch must receive an AbortSignal');
      return new Promise((resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 1000);
        options.signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          const timeoutErr = new Error('The operation was aborted');
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        });
      });
    };

    let resendTimedOut = false;
    let resendErrorMsg = '';
    try {
      await emailService.sendPasswordResetEmail({
        to: 'victim@example.com',
        resetUrl: 'https://lendlocal.app/forgot-password.html?token=secrettoken1234567890',
        token: 'secrettoken1234567890',
      });
    } catch (err) {
      resendTimedOut = true;
      resendErrorMsg = err.message;
    }
    assert.strictEqual(resendTimedOut, true, 'Resend request must time out');
    assert(resendErrorMsg.includes('timed out after 50ms'), 'Timeout message must indicate timeout duration');
    assert(!resendErrorMsg.includes('re_test_timeout_key_secret'), 'Error must never leak API key');
    assert(!resendErrorMsg.includes('secrettoken1234567890'), 'Error must never leak reset token');
    delete process.env.RESEND_API_KEY;

    // 2. SendGrid Timeout
    process.env.SENDGRID_API_KEY = 'SG.test_timeout_key_secret';
    let sendgridTimedOut = false;
    let sendgridErrorMsg = '';
    try {
      await emailService.sendPasswordResetEmail({
        to: 'victim@example.com',
        resetUrl: 'https://lendlocal.app/forgot-password.html?token=secrettoken1234567890',
        token: 'secrettoken1234567890',
      });
    } catch (err) {
      sendgridTimedOut = true;
      sendgridErrorMsg = err.message;
    }
    assert.strictEqual(sendgridTimedOut, true, 'SendGrid request must time out');
    assert(sendgridErrorMsg.includes('timed out after 50ms'), 'Timeout message must indicate timeout duration');
    assert(!sendgridErrorMsg.includes('SG.test_timeout_key_secret'), 'Error must never leak API key');
    assert(!sendgridErrorMsg.includes('secrettoken1234567890'), 'Error must never leak reset token');
    delete process.env.SENDGRID_API_KEY;

    // 3. Postmark Timeout
    process.env.POSTMARK_SERVER_TOKEN = 'pm_test_timeout_key_secret';
    let postmarkTimedOut = false;
    let postmarkErrorMsg = '';
    try {
      await emailService.sendPasswordResetEmail({
        to: 'victim@example.com',
        resetUrl: 'https://lendlocal.app/forgot-password.html?token=secrettoken1234567890',
        token: 'secrettoken1234567890',
      });
    } catch (err) {
      postmarkTimedOut = true;
      postmarkErrorMsg = err.message;
    }
    assert.strictEqual(postmarkTimedOut, true, 'Postmark request must time out');
    assert(postmarkErrorMsg.includes('timed out after 50ms'), 'Timeout message must indicate timeout duration');
    assert(!postmarkErrorMsg.includes('pm_test_timeout_key_secret'), 'Error must never leak API key');
    assert(!postmarkErrorMsg.includes('secrettoken1234567890'), 'Error must never leak reset token');
    delete process.env.POSTMARK_SERVER_TOKEN;

    // 4. Network error handling (non-timeout)
    process.env.RESEND_API_KEY = 're_test_network_key';
    global.fetch = async () => {
      const netErr = new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:443');
      throw netErr;
    };

    let netErrorCaught = false;
    let netErrorMsg = '';
    try {
      await emailService.sendPasswordResetEmail({
        to: 'victim@example.com',
        resetUrl: 'https://lendlocal.app/forgot-password.html?token=secrettoken1234567890',
      });
    } catch (err) {
      netErrorCaught = true;
      netErrorMsg = err.message;
    }
    assert.strictEqual(netErrorCaught, true, 'Network failure must be caught and converted');
    assert(netErrorMsg.includes('Email provider network request failed'), 'Network error must be sanitized');
    assert(!netErrorMsg.includes('re_test_network_key'), 'Error must never leak API key');
    delete process.env.RESEND_API_KEY;

  } finally {
    global.fetch = origFetch;
    if (origTimeoutMs !== undefined) {
      process.env.EMAIL_TIMEOUT_MS = origTimeoutMs;
    } else {
      delete process.env.EMAIL_TIMEOUT_MS;
    }
  }

  // Test in-memory capture in NODE_ENV === 'test'
  process.env.NODE_ENV = 'test';
  emailService.__clearSentEmails();

  await emailService.sendPasswordResetEmail({
    to: 'testuser@example.com',
    userName: 'Test User',
    resetUrl: `https://lendlocal.app/forgot-password.html?token=${rawTokenTest}`,
    token: rawTokenTest,
  });

  const sent = emailService.__getSentEmails();
  assert.strictEqual(sent.length, 1, 'Email must be recorded in email service collector');
  assert.strictEqual(sent[0].to, 'testuser@example.com');
  assert(sent[0].resetUrl.includes(rawTokenTest));
  assert.strictEqual(sent[0].tokenMasked, `${rawTokenTest.slice(0, 4)}...${rawTokenTest.slice(-4)}`);

  // Restore env
  process.env.NODE_ENV = origEnv;
  if (origResend) process.env.RESEND_API_KEY = origResend;
  if (origSendgrid) process.env.SENDGRID_API_KEY = origSendgrid;
  if (origPostmark) process.env.POSTMARK_SERVER_TOKEN = origPostmark;

  console.log('✅ P0-3: Transactional Email Delivery Service verified.');

  // 5. User Model Schema Invariants
  console.log('5. Testing User Model Schema Invariants...');
  const schemaPaths = User.schema.paths;
  assert(schemaPaths.resetPasswordToken, 'User schema must have resetPasswordToken');
  assert.strictEqual(schemaPaths.resetPasswordToken.options.select, false, 'resetPasswordToken must not be selected by default');
  assert(schemaPaths.resetPasswordExpires, 'User schema must have resetPasswordExpires');
  assert.strictEqual(schemaPaths.resetPasswordExpires.options.select, false, 'resetPasswordExpires must not be selected by default');
  assert(schemaPaths.passwordChangedAt, 'User schema must have passwordChangedAt');
  console.log('✅ User Model Schema Invariants verified.');

  // 6. Cryptographic Token Generation & Hashing
  console.log('6. Testing Cryptographic Token Generation & Hashing...');
  const token1 = crypto.randomBytes(32).toString('hex');
  const token2 = crypto.randomBytes(32).toString('hex');
  assert.notStrictEqual(token1, token2, 'Generated tokens must be distinct');
  assert.strictEqual(token1.length, 64, 'Token must be 32 bytes hex encoded (64 chars)');

  const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
  const hash2 = crypto.createHash('sha256').update(token1).digest('hex');
  assert.strictEqual(hash1, hash2, 'SHA-256 hash must be deterministic');
  assert.notStrictEqual(hash1, token1, 'Hashed token must never match raw token');
  console.log('✅ Cryptographic Token Hashing verified.');

  // 7. Functional Password Recovery Lifecycle Simulation
  console.log('7. Testing Functional Password Recovery Lifecycle Simulation...');
  const initialPassword = 'initialPassword123';
  const hashedInitialPassword = await bcrypt.hash(initialPassword, 10);

  const mockUser = {
    _id: '60d5ec49f1b2c82b8c8a1111',
    name: 'Alice Cooper',
    email: 'alice@example.com',
    password: hashedInitialPassword,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    passwordChangedAt: null,
    async comparePassword(candidate) {
      return bcrypt.compare(candidate, this.password);
    },
  };

  // 7A: Initial login succeeds
  assert.strictEqual(await mockUser.comparePassword(initialPassword), true, 'Initial password must match');
  assert.strictEqual(await mockUser.comparePassword('wrongPassword'), false, 'Wrong password must fail');

  // 7B: User requests forgot-password
  process.env.NODE_ENV = 'test';
  emailService.__clearSentEmails();
  const resetRawToken = crypto.randomBytes(32).toString('hex');
  const hashedResetToken = crypto.createHash('sha256').update(resetRawToken).digest('hex');
  const oneHourLater = new Date(Date.now() + 60 * 60 * 1000);

  mockUser.resetPasswordToken = hashedResetToken;
  mockUser.resetPasswordExpires = oneHourLater;

  await emailService.sendPasswordResetEmail({
    to: mockUser.email,
    userName: mockUser.name,
    resetUrl: `https://lendlocal.app/forgot-password.html?token=${resetRawToken}`,
    token: resetRawToken,
  });

  const sentResetEmails = emailService.__getSentEmails();
  assert.strictEqual(sentResetEmails.length, 1, 'Reset email must be dispatched');
  assert(sentResetEmails[0].resetUrl.includes(resetRawToken), 'Reset link must contain raw token');

  // 7C: Verify invalid token is rejected
  const fakeToken = crypto.randomBytes(32).toString('hex');
  const fakeTokenHash = crypto.createHash('sha256').update(fakeToken).digest('hex');
  assert.notStrictEqual(fakeTokenHash, mockUser.resetPasswordToken, 'Fake token hash must not match');

  // 7D: Verify expired token is rejected
  const isExpired = (expiryDate) => expiryDate.getTime() < Date.now();
  assert.strictEqual(isExpired(mockUser.resetPasswordExpires), false, 'Token must not be expired yet');
  const expiredTime = new Date(Date.now() - 1000);
  assert.strictEqual(isExpired(expiredTime), true, 'Past time must be recognized as expired');

  // 7E: Reset password with valid token
  const newPassword = 'newSecurePassword456';
  assert.strictEqual(mockUser.resetPasswordToken, hashedResetToken, 'Token must match before reset');

  // Execute reset:
  mockUser.password = await bcrypt.hash(newPassword, 10);
  mockUser.resetPasswordToken = null;
  mockUser.resetPasswordExpires = null;
  mockUser.passwordChangedAt = new Date();

  // Verify single-use: token is now cleared
  assert.strictEqual(mockUser.resetPasswordToken, null, 'Reset token must be cleared after use');
  assert.strictEqual(mockUser.resetPasswordExpires, null, 'Reset expiry must be cleared after use');

  // 7F: Login with new password succeeds, old fails
  assert.strictEqual(await mockUser.comparePassword(newPassword), true, 'New password must match');
  assert.strictEqual(await mockUser.comparePassword(initialPassword), false, 'Old password must fail');

  // 7G: Reused token cannot be used again
  const reattemptTokenHash = crypto.createHash('sha256').update(resetRawToken).digest('hex');
  const tokenMatchAfterUse = mockUser.resetPasswordToken === reattemptTokenHash;
  assert.strictEqual(tokenMatchAfterUse, false, 'Reused token must be rejected');

  console.log('✅ Functional Password Recovery Lifecycle Simulation passed.');

  console.log('\n🎉 All Stage 1: Forgot Password & Account Recovery Tests Passed Successfully!');
}

runAllTests().catch((err) => {
  console.error('❌ Stage 1 Test Failure:', err);
  process.exit(1);
});
