/**
 * smsService.js — SMS Provider Abstraction for LendLocal
 *
 * Phase 1 Foundation:
 * - Mock SMS delivery strictly permitted in NODE_ENV === 'test' or when
 *   ENABLE_MOCK_SMS === 'true' in development.
 * - In production: Mock delivery is strictly prohibited. Fails closed with an explicit
 *   configuration error if invoked without a configured production provider.
 * - Test interface allows automated test suites to inspect captured OTPs in memory
 *   without logging secrets or contacting external carriers.
 */

const { maskPhone } = require('../utils/phone');

// In-memory collector for test and local mock delivery
const capturedSmsList = [];

// Optional custom mock sender for unit test interception
let mockSender = null;

/**
 * Determines whether mock SMS dispatch is permitted in the current environment.
 * Strictly disallowed in production.
 */
function isMockSmsPermitted() {
  if (process.env.NODE_ENV === 'test') {
    return true;
  }
  if (process.env.NODE_ENV === 'development' && process.env.ENABLE_MOCK_SMS === 'true') {
    return true;
  }
  return false;
}

/**
 * Sends a phone verification OTP.
 *
 * @param {Object} params
 * @param {string} params.to - E.164 normalized recipient phone number
 * @param {string} params.otp - Six-digit verification code
 * @param {string} [params.userId] - Associated user ID for logging / auditing
 * @returns {Promise<{ success: boolean, provider: string, messageId?: string }>}
 */
async function sendVerificationOtp({ to, otp, userId }) {
  if (!to || typeof to !== 'string' || !to.startsWith('+')) {
    throw new Error('Valid E.164 recipient phone number is required');
  }
  if (!otp || typeof otp !== 'string' || otp.trim().length !== 6) {
    throw new Error('Valid six-digit OTP string is required');
  }

  // 1. Custom mock sender hook for tests
  if (mockSender) {
    return await mockSender({ to, otp, userId });
  }

  // 2. Gated mock delivery for test / dev
  if (isMockSmsPermitted()) {
    capturedSmsList.push({
      to,
      otp,
      userId: userId ? userId.toString() : null,
      sentAt: new Date(),
    });

    console.log(`[SmsService] Mock verification OTP dispatched to ${maskPhone(to)}`);
    return {
      success: true,
      provider: 'mock-sms',
      messageId: `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  // 3. Production safety guard: Fail closed
  const configError =
    'SMS provider is not configured. Real SMS provider integration is required in production, and mock SMS is disabled.';
  console.error(`[SmsService] Configuration error: ${configError}`);
  const err = new Error(configError);
  err.name = 'SmsConfigurationError';
  throw err;
}

/**
 * Test helpers strictly for unit testing
 */
function __getCapturedSms() {
  return [...capturedSmsList];
}

function __clearCapturedSms() {
  capturedSmsList.length = 0;
}

function __getLatestOtpForNumber(e164) {
  for (let i = capturedSmsList.length - 1; i >= 0; i--) {
    if (capturedSmsList[i].to === e164) {
      return capturedSmsList[i].otp;
    }
  }
  return null;
}

function __setMockSender(fn) {
  mockSender = fn;
}

function __clearMockSender() {
  mockSender = null;
}

module.exports = {
  sendVerificationOtp,
  isMockSmsPermitted,
  __getCapturedSms,
  __clearCapturedSms,
  __getLatestOtpForNumber,
  __setMockSender,
  __clearMockSender,
};
