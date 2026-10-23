const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { signToken } = require('../utils/helpers');
const { protect } = require('../middleware/auth');
const emailService = require('../services/emailService');
const { validateAndNormalizePhone, maskPhone } = require('../utils/phone');
const smsService = require('../services/smsService');

const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many authentication attempts, please try again later.'
  }
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many password recovery attempts, please try again later.'
  }
});

const phoneVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many phone verification requests, please try again later.'
  }
});

/**
 * In-memory sliding-window store for per-phone verification rate limiting (Fix 3).
 * Key: SHA-256 hash of normalized E.164 phone number (never stores raw phone numbers in memory).
 * Value: Array of millisecond timestamps of attempts within active window.
 *
 * Limits: 5 requests per 15 minutes per normalized phone number.
 *
 * ARCHITECTURAL NOTE FOR HORIZONTALLY SCALED / MULTI-INSTANCE PRODUCTION:
 * This in-memory store is appropriate for single-instance deployments, staging, and automated tests.
 * In a multi-instance production environment (e.g., multiple Render web services, Kubernetes pods,
 * or cluster mode), process-local memory is not shared across instances.
 * For horizontally scaled production, this store must be backed by a shared distributed cache
 * such as Redis (e.g., using `rate-limit-redis`, ioredis sliding-window ZSET, or Redis INCR/EXPIRE primitives)
 * keyed by `phone:sha256(e164)`.
 */
const phoneRateLimitStore = new Map();
const PHONE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const PHONE_MAX_REQUESTS = 5; // 5 requests per 15 minutes per phone number

function hashPhoneNumber(e164) {
  return crypto.createHash('sha256').update(e164).digest('hex');
}

function checkAndRecordPhoneRateLimit(e164) {
  const now = Date.now();
  const phoneHash = hashPhoneNumber(e164);

  let timestamps = phoneRateLimitStore.get(phoneHash);
  if (!timestamps) {
    timestamps = [];
    phoneRateLimitStore.set(phoneHash, timestamps);
  }

  // Filter out timestamps older than the sliding window
  const windowStart = now - PHONE_WINDOW_MS;
  const recent = timestamps.filter((ts) => ts > windowStart);
  phoneRateLimitStore.set(phoneHash, recent);

  if (recent.length >= PHONE_MAX_REQUESTS) {
    const oldest = recent[0];
    const retryAfterMs = oldest + PHONE_WINDOW_MS - now;
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return { limited: true, retryAfter: retryAfterSec };
  }

  recent.push(now);
  return { limited: false, recordedTimestamp: now };
}

function rollbackPhoneRateLimit(e164, recordedTimestamp) {
  const phoneHash = hashPhoneNumber(e164);
  const timestamps = phoneRateLimitStore.get(phoneHash);
  if (timestamps && timestamps.length > 0) {
    if (recordedTimestamp) {
      const idx = timestamps.lastIndexOf(recordedTimestamp);
      if (idx !== -1) {
        timestamps.splice(idx, 1);
      }
    } else {
      timestamps.pop();
    }
    if (timestamps.length === 0) {
      phoneRateLimitStore.delete(phoneHash);
    }
  }
}

function __clearPhoneRateLimitStore() {
  phoneRateLimitStore.clear();
}

// Periodic cleanup of stale phone rate limit entries (unref'd to prevent keeping event loop open)
const phoneRateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  const windowStart = now - PHONE_WINDOW_MS;
  for (const [hash, timestamps] of phoneRateLimitStore.entries()) {
    const active = timestamps.filter((ts) => ts > windowStart);
    if (active.length === 0) {
      phoneRateLimitStore.delete(hash);
    } else {
      phoneRateLimitStore.set(hash, active);
    }
  }
}, 5 * 60 * 1000);
if (phoneRateLimitCleanupTimer.unref) {
  phoneRateLimitCleanupTimer.unref();
}

/**
 * Middleware: Per-Phone Rate Limiter (Fix 3)
 * Normalizes phone number to E.164, hashes it with SHA-256, and checks 5-req/15-min limit.
 * Formatting variations (spaces, dashes, parens) resolve to the same E.164 hash.
 */
const phonePerNumberLimiter = (req, res, next) => {
  const rawPhone = req.body?.phoneNumber;
  if (!rawPhone || typeof rawPhone !== 'string') {
    // Missing or non-string input: let route handler provide appropriate 400 validation error
    return next();
  }

  const validation = validateAndNormalizePhone(rawPhone);
  if (!validation.valid) {
    // Invalid phone number: let route handler provide precise 400 validation error
    return next();
  }

  const check = checkAndRecordPhoneRateLimit(validation.e164);
  if (check.limited) {
    res.setHeader('Retry-After', check.retryAfter);
    return res.status(429).json({
      message: `Too many verification requests for this phone number. Please try again after ${check.retryAfter} seconds.`,
      retryAfter: check.retryAfter,
    });
  }

  req.rateLimitTimestamp = check.recordedTimestamp;
  next();
};

/**
 * Dedicated In-memory sliding-window store for phone password recovery (Phase 2).
 * Key: SHA-256 hash of normalized E.164 phone number.
 * Value: Array of millisecond timestamps within active 1-hour window.
 *
 * Limits: 3 requests per phone per hour.
 *
 * ARCHITECTURAL NOTE FOR HORIZONTALLY SCALED / MULTI-INSTANCE PRODUCTION:
 * This in-memory store is appropriate for single-instance deployments, staging, and automated tests.
 * In a multi-instance production environment (e.g., multiple Render web services, Kubernetes pods,
 * or cluster mode), process-local memory is not shared across instances.
 * For horizontally scaled production, this store must be backed by a shared distributed cache
 * such as Redis (e.g., using `rate-limit-redis`, ioredis sliding-window ZSET, or Redis INCR/EXPIRE primitives)
 * keyed by `phone-recovery:sha256(e164)`.
 */
const phoneRecoveryRateLimitStore = new Map();
const PHONE_RECOVERY_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PHONE_RECOVERY_MAX_REQUESTS = 3; // 3 requests per phone per hour

const phoneRecoveryIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many recovery attempts, please try again later.'
  }
});

function checkAndRecordPhoneRecoveryRateLimit(candidatePhone) {
  const now = Date.now();
  const val = validateAndNormalizePhone(candidatePhone);
  const e164 = val.valid ? val.e164 : candidatePhone;
  const phoneHash = hashPhoneNumber(e164);

  let timestamps = phoneRecoveryRateLimitStore.get(phoneHash);
  if (!timestamps) {
    timestamps = [];
    phoneRecoveryRateLimitStore.set(phoneHash, timestamps);
  }

  // Filter out timestamps older than the sliding window
  const windowStart = now - PHONE_RECOVERY_WINDOW_MS;
  const recent = timestamps.filter((ts) => ts > windowStart);
  phoneRecoveryRateLimitStore.set(phoneHash, recent);

  if (recent.length >= PHONE_RECOVERY_MAX_REQUESTS) {
    const oldest = recent[0];
    const retryAfterMs = oldest + PHONE_RECOVERY_WINDOW_MS - now;
    const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return { limited: true, retryAfter: retryAfterSec };
  }

  recent.push(now);
  return { limited: false, recordedTimestamp: now };
}

function rollbackPhoneRecoveryRateLimit(candidatePhone, recordedTimestamp) {
  const val = validateAndNormalizePhone(candidatePhone);
  const e164 = val.valid ? val.e164 : candidatePhone;
  const phoneHash = hashPhoneNumber(e164);
  const timestamps = phoneRecoveryRateLimitStore.get(phoneHash);
  if (timestamps && timestamps.length > 0) {
    if (recordedTimestamp) {
      const idx = timestamps.lastIndexOf(recordedTimestamp);
      if (idx !== -1) {
        timestamps.splice(idx, 1);
      }
    } else {
      timestamps.pop();
    }
    if (timestamps.length === 0) {
      phoneRecoveryRateLimitStore.delete(phoneHash);
    }
  }
}

function __clearPhoneRecoveryRateLimitStore() {
  phoneRecoveryRateLimitStore.clear();
}

// Periodic cleanup of stale phone recovery rate limit entries
const phoneRecoveryRateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  const windowStart = now - PHONE_RECOVERY_WINDOW_MS;
  for (const [hash, timestamps] of phoneRecoveryRateLimitStore.entries()) {
    const active = timestamps.filter((ts) => ts > windowStart);
    if (active.length === 0) {
      phoneRecoveryRateLimitStore.delete(hash);
    } else {
      phoneRecoveryRateLimitStore.set(hash, active);
    }
  }
}, 10 * 60 * 1000);
if (phoneRecoveryRateLimitCleanupTimer.unref) {
  phoneRecoveryRateLimitCleanupTimer.unref();
}

/**
 * Middleware: Per-Phone Rate Limiter for Password Recovery (Phase 2)
 * Limits recovery initiation to 3 requests per phone per hour.
 */
const phoneRecoveryPerNumberLimiter = (req, res, next) => {
  const rawPhone = req.body?.phoneNumber;
  if (!rawPhone || typeof rawPhone !== 'string') {
    return next();
  }

  const validation = validateAndNormalizePhone(rawPhone);
  if (!validation.valid) {
    return next();
  }

  const check = checkAndRecordPhoneRecoveryRateLimit(validation.e164);
  if (check.limited) {
    res.setHeader('Retry-After', check.retryAfter);
    return res.status(429).json({
      message: `Too many password recovery requests for this phone number. Please try again after ${check.retryAfter} seconds.`,
      retryAfter: check.retryAfter,
    });
  }

  req.rateLimitTimestamp = check.recordedTimestamp;
  next();
};

const router = express.Router();


router.post('/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (
      typeof name !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({ message: 'Invalid input' });
    }

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, email, and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters'
      });
    }

    const exists = await User.findOne({
      email: email.toLowerCase().trim()
    });

    if (exists) {
      return res.status(409).json({
        message: 'Email already registered'
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    });

    const token = signToken(user._id);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        upiId: user.upiId || null,
        phoneNumber: user.phoneNumber || null,
        phoneVerified: Boolean(user.phoneVerified),
      },
    });

  } catch (err) {

    if (err.name === 'ValidationError') {
      return res.status(400).json({
        message: Object.values(err.errors)[0].message
      });
    }

    res.status(500).json({
      message: err.message || 'Registration failed'
    });
  }
});


router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid input' });
    }

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required'
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim()
    }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        message: 'Invalid email or password'
      });
    }

    const token = signToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        upiId: user.upiId || null,
        phoneNumber: user.phoneNumber || null,
        phoneVerified: Boolean(user.phoneVerified),
      },
    });

  } catch (err) {

    res.status(500).json({
      message: err.message || 'Login failed'
    });
  }
});


/* =====================================================
   FORGOT PASSWORD
===================================================== */

/**
 * Resolves the trusted frontend base URL for password recovery.
 * Security Invariants:
 * - Strictly ignores request-controlled headers (Origin, Host, Referer) to prevent Host/Origin poisoning.
 * - Reads validated FRONTEND_URL environment variable.
 * - In production (NODE_ENV === 'production'), FRONTEND_URL is mandatory and MUST use https://.
 * - In development / test, defaults to http://localhost:3000 if not specified.
 */
function getTrustedFrontendBaseUrl() {
  const isProd = process.env.NODE_ENV === 'production';
  const configured = (process.env.FRONTEND_URL || '').trim();

  if (!configured) {
    if (isProd) {
      throw new Error('FRONTEND_URL environment variable must be configured in production');
    }
    return 'http://localhost:3000';
  }

  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('FRONTEND_URL is not a valid URL');
  }

  if (isProd && parsed.protocol !== 'https:') {
    throw new Error('FRONTEND_URL must use https:// in production');
  }

  if (!isProd && parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('FRONTEND_URL must use http:// or https://');
  }

  return parsed.origin;
}

router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    const trimmedEmail = email.toLowerCase().trim();
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    // Generic response message to prevent email enumeration
    const genericMessage =
      'If an account with that email exists, password reset instructions have been sent.';

    let trustedOrigin;
    try {
      trustedOrigin = getTrustedFrontendBaseUrl();
    } catch (configErr) {
      console.error('[Auth] Password reset misconfiguration:', configErr.message);
      // Fail safely: Never reveal configuration failure or email existence to client
      return res.status(200).json({ message: genericMessage });
    }

    const user = await User.findOne({ email: trimmedEmail });
    if (!user) {
      return res.status(200).json({ message: genericMessage });
    }

    // Generate cryptographically secure single-use token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 1 hour expiry
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${trustedOrigin}/forgot-password.html?token=${rawToken}`;

    try {
      await emailService.sendPasswordResetEmail({
        to: user.email,
        userName: user.name,
        resetUrl,
        token: rawToken,
      });
    } catch (emailErr) {
      console.error('[Auth] Password reset email delivery error:', emailErr.message);
      // Maintain generic response to avoid account enumeration
    }

    return res.status(200).json({ message: genericMessage });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Failed to process password recovery request' });
  }
});


/* =====================================================
   RESET PASSWORD (EMAIL)
===================================================== */
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ message: 'Password reset token is required' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ message: 'Password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedToken = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const now = new Date();

    // Pre-hash password using the exact same algorithm and cost factor (bcrypt cost 10)
    // as defined in User.js pre('save') hook.
    // NOTE: Direct findOneAndUpdate intentionally bypasses Mongoose pre('save') middleware.
    // Pre-hashing here guarantees that plaintext passwords are never stored and that token
    // consumption, password update, and session invalidation occur in a single atomic database operation.
    const hashedPassword = await bcrypt.hash(password, 10);

    // Single-use token consumption and atomic password persistence (Finding 2):
    // Atomically find, consume the token, set the new password hash, and update passwordChangedAt
    // in a single operation so concurrent requests cannot both consume the same valid token
    // or leave the token consumed without updating the password.
    const user = await User.findOneAndUpdate(
      {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: now },
      },
      {
        $set: {
          password: hashedPassword,
          passwordChangedAt: now,
          pendingPhoneRecovery: null,
        },
        $unset: {
          resetPasswordToken: 1,
          resetPasswordExpires: 1,
        },
      },
      {
        new: false,
        select: '+resetPasswordToken +resetPasswordExpires +password',
      }
    );

    if (!user) {
      return res.status(400).json({
        message: 'Password reset token is invalid or has expired',
      });
    }

    res.status(200).json({
      message: 'Password has been reset successfully. Please sign in with your new password.',
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

/* =====================================================
   PHONE OTP PASSWORD RECOVERY (PHASE 2)
===================================================== */

/**
 * Initiate Phone Password Recovery
 * POST /api/auth/forgot-password-phone
 * Body: { phoneNumber }
 */
const handleForgotPasswordPhone = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    const validation = validateAndNormalizePhone(phoneNumber);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const e164 = validation.e164;
    const genericMessage =
      'If an account is associated with this verified phone number, a verification code has been sent.';

    // Query strictly for accounts with matching phone number AND phoneVerified === true
    const user = await User.findOne({
      phoneNumber: e164,
      phoneVerified: true,
    }).select('+pendingPhoneRecovery');

    if (!user) {
      return res.status(200).json({
        message: genericMessage,
        cooldownSeconds: 300,
      });
    }

    // Enforce 5-minute resend cooldown
    if (user.pendingPhoneRecovery?.lastSentAt) {
      const elapsedMs = Date.now() - new Date(user.pendingPhoneRecovery.lastSentAt).getTime();
      if (elapsedMs < 5 * 60 * 1000) {
        const waitSec = Math.ceil((300000 - elapsedMs) / 1000);
        return res.status(429).json({
          message: `Please wait ${waitSec} seconds before requesting another recovery code`,
          retryAfter: waitSec,
        });
      }
    }

    // Generate cryptographically secure six-digit OTP (100000 to 999999)
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    // 10-minute expiry
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    const challengeId = crypto.randomUUID();

    user.pendingPhoneRecovery = {
      number: e164,
      otpHash,
      otpExpires,
      attempts: 0,
      lastSentAt: new Date(),
      challengeId,
    };

    await user.save({ validateBeforeSave: false });

    try {
      await smsService.sendVerificationOtp({
        to: e164,
        otp: rawOtp,
        userId: user._id,
      });
    } catch (smsErr) {
      // On SMS failure: invalidate ONLY the challenge created by this request (never overwrite newer concurrent challenges)
      user.pendingPhoneRecovery = null;
      try {
        await User.updateOne(
          { _id: user._id, 'pendingPhoneRecovery.challengeId': challengeId },
          { $set: { pendingPhoneRecovery: null } }
        );
      } catch (dbErr) {
        console.error('[Auth] Failed to rollback recovery challenge for', maskPhone(e164));
      }

      // Roll back rate-limit state safely matching this request's recorded timestamp
      rollbackPhoneRecoveryRateLimit(e164, req.rateLimitTimestamp);

      const errorCategory = smsErr?.name || 'SmsDeliveryError';
      console.error(`[Auth] Recovery SMS delivery failed [${errorCategory}] for recipient ${maskPhone(e164)}`);

      // Return generic response without revealing account presence or provider error
      return res.status(200).json({
        message: genericMessage,
        cooldownSeconds: 300,
      });
    }

    return res.status(200).json({
      message: genericMessage,
      cooldownSeconds: 300,
    });
  } catch (err) {
    console.error('Forgot password phone error:', err);
    res.status(500).json({ message: 'Failed to process password recovery request' });
  }
};

/**
 * Reset Password with Phone OTP
 * POST /api/auth/reset-password-phone
 * Body: { phoneNumber, otp, password }
 */
const handleResetPasswordPhone = async (req, res) => {
  try {
    const { phoneNumber, otp, password } = req.body;

    const validation = validateAndNormalizePhone(phoneNumber);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const e164 = validation.e164;

    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
      return res.status(400).json({ message: 'Verification code must be a 6-digit number' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ message: 'Password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const candidateHash = crypto.createHash('sha256').update(otp.trim()).digest('hex');
    const now = new Date();

    // Pre-hash password using the exact same algorithm and cost factor (bcrypt cost 10)
    // as defined in User.js pre('save') hook.
    // NOTE: Direct findOneAndUpdate intentionally bypasses Mongoose pre('save') middleware.
    // Pre-hashing here guarantees that plaintext passwords are never stored and that OTP
    // consumption, password update, and session invalidation occur in a single atomic database operation.
    const hashedPassword = await bcrypt.hash(password, 10);

    // Single atomic database operation for OTP consumption and password persistence (Finding 1):
    // Guarantees that OTP verification, consumption, password update, and session invalidation
    // occur atomically without intermediate failure states or race conditions.
    const user = await User.findOneAndUpdate(
      {
        phoneNumber: e164,
        phoneVerified: true,
        'pendingPhoneRecovery.otpHash': candidateHash,
        'pendingPhoneRecovery.otpExpires': { $gt: now },
        'pendingPhoneRecovery.attempts': { $lt: 3 },
      },
      {
        $set: {
          password: hashedPassword,
          passwordChangedAt: now,
          pendingPhoneRecovery: null,
        },
        $unset: {
          resetPasswordToken: 1,
          resetPasswordExpires: 1,
        },
      },
      {
        new: false,
        select: '+password +pendingPhoneRecovery',
      }
    );

    if (user) {
      return res.status(200).json({
        message: 'Password has been reset successfully. Please sign in with your new password.',
      });
    }

    // Atomic failed-attempt incrementation (Finding 3):
    // Only increment attempts if an active, unexpired, unconsumed challenge exists with attempts < 3.
    // Consumed, expired, or exhausted challenges will not match and will not increment attempts.
    const failedAttemptUser = await User.findOneAndUpdate(
      {
        phoneNumber: e164,
        phoneVerified: true,
        'pendingPhoneRecovery.otpHash': { $ne: null },
        'pendingPhoneRecovery.otpExpires': { $gt: now },
        'pendingPhoneRecovery.attempts': { $lt: 3 },
      },
      {
        $inc: { 'pendingPhoneRecovery.attempts': 1 },
      },
      {
        new: true,
        select: '+pendingPhoneRecovery',
      }
    );

    // If this failed attempt reached or exceeded the 3-attempt limit,
    // atomically clear the OTP hash and expiry for this specific challengeId.
    if (failedAttemptUser?.pendingPhoneRecovery?.attempts >= 3) {
      await User.updateOne(
        {
          _id: failedAttemptUser._id,
          'pendingPhoneRecovery.challengeId': failedAttemptUser.pendingPhoneRecovery.challengeId,
        },
        {
          $set: {
            'pendingPhoneRecovery.otpHash': null,
            'pendingPhoneRecovery.otpExpires': null,
          },
        }
      );
    }

    // Generic error message: strictly avoids revealing whether OTP was incorrect, expired, or exhausted
    return res.status(400).json({
      message: 'Invalid or expired verification code',
    });
  } catch (err) {
    console.error('Reset password phone error:', err);
    res.status(500).json({ message: 'Failed to reset password' });
  }
};

router.post(
  '/forgot-password-phone',
  phoneRecoveryIpLimiter,
  phoneRecoveryPerNumberLimiter,
  handleForgotPasswordPhone
);
router.post(
  '/reset-password-phone',
  phoneRecoveryIpLimiter,
  phoneRecoveryPerNumberLimiter,
  handleResetPasswordPhone
);


router.get('/me', protect, async (req, res) => {

  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      upiId: req.user.upiId,
      phoneNumber: req.user.phoneNumber || null,
      phoneVerified: Boolean(req.user.phoneVerified),
      phoneVerifiedAt: req.user.phoneVerifiedAt || null,
    },
  });

});


/* =====================================================
   SAVE FCM TOKEN
===================================================== */

router.post('/fcm-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return res.status(400).json({ message: 'FCM token cannot be empty' });
    }

    if (!req.jwt.sessionId) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    // Platform validation: defaults to 'web' if omitted or empty
    const platformRaw = req.body.platform;
    let platform = 'web';
    if (platformRaw !== undefined && platformRaw !== null) {
      if (typeof platformRaw !== 'string' || !['web', 'android', 'ios'].includes(platformRaw.toLowerCase().trim())) {
        return res.status(400).json({ message: 'Invalid platform. Must be web, android, or ios.' });
      }
      platform = platformRaw.toLowerCase().trim();
    }

    const fcmClaim = Date.now().toString() + '-' + require('crypto').randomUUID();

    // 1. Maintain legacy scalar fcmToken according to backward compatibility strategy:
    // Web registrations always update scalar fcmToken. Non-web platforms (e.g. android) update
    // scalar fcmToken only if no active web token exists on this user.
    const hasActiveWebToken = Array.isArray(req.user.fcmTokens) &&
      req.user.fcmTokens.some((t) => t.platform === 'web' && t.token !== trimmedToken);

    const scalarUpdate = {};
    if (platform === 'web' || !hasActiveWebToken) {
      scalarUpdate.fcmToken = trimmedToken;
      scalarUpdate.fcmSessionId = req.jwt.sessionId;
      scalarUpdate.fcmClaim = fcmClaim;
    }

    // Check revocation list for this session and update legacy fcmToken atomically
    const result = await User.updateOne(
      {
        _id: req.user._id,
        revokedTokens: { $not: { $elemMatch: { token: trimmedToken, sessionId: req.jwt.sessionId } } }
      },
      Object.keys(scalarUpdate).length > 0 ? { $set: scalarUpdate } : { $set: { updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(403).json({ message: "Registration rejected: Token was revoked for this session" });
    }

    // 2. Update multi-device fcmTokens array: remove prior entry for this token string, then push fresh entry
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { fcmTokens: { token: trimmedToken } } }
    );

    const tokenEntry = {
      token: trimmedToken,
      platform,
      sessionId: req.jwt.sessionId,
      claim: fcmClaim,
      updatedAt: new Date(),
    };

    await User.updateOne(
      { _id: req.user._id },
      {
        $push: {
          fcmTokens: {
            $each: [tokenEntry],
            $slice: -10, // Maintain maximum 10 active devices per user
          },
        },
      }
    );

    // 3. Clear this physical token from other users, yielding to stronger claims.
    // Note on Concurrency / Atomicity:
    // Standalone MongoDB without replica set multi-document transactions cannot guarantee
    // cross-document ACID atomicity across separate User documents. To minimize cross-user
    // races and prevent stale overwrites, we use a monotonic timestamp-claim check and two-way
    // yielding.
    await User.updateMany(
      {
        _id: { $ne: req.user._id },
        $and: [
          {
            $or: [
              { fcmToken: trimmedToken },
              { 'fcmTokens.token': trimmedToken }
            ]
          },
          {
            $or: [
              { fcmClaim: { $lt: fcmClaim } },
              { fcmClaim: null },
              { fcmClaim: { $exists: false } }
            ]
          }
        ]
      },
      {
        $set: { fcmToken: null, fcmSessionId: null, fcmClaim: null },
        $pull: { fcmTokens: { token: trimmedToken } }
      }
    );

    // 4. Verify we didn't lose to a stronger claim during our write
    const strongerExists = await User.exists({
      _id: { $ne: req.user._id },
      $or: [
        { fcmToken: trimmedToken },
        { 'fcmTokens.token': trimmedToken }
      ],
      fcmClaim: { $gt: fcmClaim }
    });

    if (strongerExists) {
      await User.updateOne(
        { _id: req.user._id, fcmClaim: fcmClaim },
        {
          $set: { fcmToken: null, fcmSessionId: null, fcmClaim: null },
          $pull: { fcmTokens: { token: trimmedToken } }
        }
      );
      // Promote another remaining device if available
      const loserUser = await User.findById(req.user._id).select('fcmTokens');
      if (loserUser?.fcmTokens?.length > 0) {
        const webTok = loserUser.fcmTokens.find((t) => t.platform === 'web');
        const fallback = webTok || loserUser.fcmTokens[loserUser.fcmTokens.length - 1];
        await User.updateOne(
          { _id: req.user._id, fcmToken: null },
          { $set: { fcmToken: fallback.token, fcmSessionId: fallback.sessionId, fcmClaim: fallback.claim } }
        );
      }
    }

    console.log(`FCM token (${platform}) saved for user: ${req.user.email}`);

    res.json({
      message: 'FCM token saved successfully',
      platform,
    });

  } catch (err) {

    console.error(
      'FCM token save error:',
      err
    );

    res.status(500).json({
      message:
        err.message ||
        'Failed to save FCM token',
    });

  }

});



/* =====================================================
   REMOVE FCM TOKEN
===================================================== */
router.delete('/fcm-token', protect, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ message: 'FCM token is required' });
    }

    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return res.status(400).json({ message: 'FCM token cannot be empty' });
    }

    if (!req.jwt.sessionId) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    await User.updateOne(
      { _id: req.user._id },
      {
        $addToSet: { revokedTokens: { token: trimmedToken, sessionId: req.jwt.sessionId, exp: req.jwt.exp } }
      }
    );

    // Expiry-based cleanup
    const now = Math.floor(Date.now() / 1000);
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { revokedTokens: { exp: { $lt: now } } } }
    );

    // Pull token from fcmTokens array
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { fcmTokens: { token: trimmedToken } } }
    );

    // Clear legacy fcmToken atomically if it matches this token and session
    const result = await User.updateOne(
      { _id: req.user._id, fcmToken: trimmedToken, fcmSessionId: req.jwt.sessionId },
      { $set: { fcmToken: null, fcmSessionId: null, fcmClaim: null } }
    );

    if (result.modifiedCount > 0) {
      // If fcmToken was cleared, check if user still has remaining tokens in fcmTokens to promote
      const updatedUser = await User.findById(req.user._id).select('fcmTokens');
      if (updatedUser?.fcmTokens?.length > 0) {
        const webToken = updatedUser.fcmTokens.find((t) => t.platform === 'web');
        const fallback = webToken || updatedUser.fcmTokens[updatedUser.fcmTokens.length - 1];
        await User.updateOne(
          { _id: req.user._id, fcmToken: null },
          { $set: { fcmToken: fallback.token, fcmSessionId: fallback.sessionId, fcmClaim: fallback.claim } }
        );
      }
      console.log(`FCM token removed atomically for user: ${req.user.email}`);
    } else {
      console.log(`FCM token removal skipped (mismatch/already removed) for user: ${req.user.email}`);
    }

    res.json({ message: 'FCM token processed successfully' });
  } catch (err) {
    console.error('FCM token remove error:', err);
    res.status(500).json({ message: err.message || 'Failed to remove FCM token' });
  }
});

/* =====================================================
   SAVE UPI ID
===================================================== */
router.post('/upi-id', protect, async (req, res) => {
  try {
    const { upiId } = req.body;

    // Reject omitted upiId property
    if (upiId === undefined) {
      return res.status(400).json({ message: 'UPI ID is required' });
    }

    // Allow user to clear/unset their saved UPI ID
    if (upiId === null || (typeof upiId === 'string' && upiId.trim() === '')) {
      req.user.upiId = null;
      await req.user.save();
      return res.json({
        message: 'UPI ID cleared successfully',
        upiId: null
      });
    }

    if (typeof upiId !== 'string') {
      return res.status(400).json({ message: 'UPI ID must be a string' });
    }

    const trimmedUpiId = upiId.trim();

    // Basic conservative validation for UPI ID (e.g., username@bank)
    const upiRegex = /^[\w.-]+@[a-zA-Z]+$/;
    if (!upiRegex.test(trimmedUpiId)) {
      return res.status(400).json({ message: 'Invalid UPI ID format' });
    }

    req.user.upiId = trimmedUpiId;
    await req.user.save();

    res.json({
      message: 'UPI ID saved successfully (Note: this does not verify ownership of the VPA)',
      upiId: req.user.upiId
    });

  } catch (err) {
    console.error('UPI ID save error:', err);
    res.status(500).json({ message: err.message || 'Failed to save UPI ID' });
  }
});

/* =====================================================
   PHONE VERIFICATION (AUTHENTICATED)
===================================================== */

/**
 * Start Phone Verification
 * POST /api/auth/phone/start-verification (and alias /phone/send-code)
 * Body: { phoneNumber }
 */
const handleStartPhoneVerification = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    const validation = validateAndNormalizePhone(phoneNumber);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const e164 = validation.e164;

    // Check if phone number is already verified on another account
    const existingOther = await User.findOne({
      phoneNumber: e164,
      phoneVerified: true,
      _id: { $ne: req.user._id },
    });

    if (existingOther) {
      return res.status(409).json({
        message: 'This phone number is already registered and verified on another account',
      });
    }

    // Check if already verified on current account
    if (req.user.phoneNumber === e164 && req.user.phoneVerified) {
      return res.status(400).json({
        message: 'This phone number is already verified on your account',
      });
    }

    const user = await User.findById(req.user._id).select('+pendingPhoneVerification');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Safe pending state cleanup (Fix 2):
    // If pending verification exists and is expired, prune it explicitly before checking cooldown.
    // NOTE: In MongoDB, a TTL index on a nested field like pendingPhoneVerification.otpExpires
    // deletes the entire User document! Therefore, expired pending state is strictly managed
    // in application logic. If automated background cleanup without application intervention
    // is desired in the future, a dedicated collection (e.g. PhoneVerificationRequests) with
    // document-level TTL should be used.
    if (user.pendingPhoneVerification) {
      const isExpired =
        user.pendingPhoneVerification.otpExpires &&
        Date.now() > new Date(user.pendingPhoneVerification.otpExpires).getTime();
      if (isExpired) {
        user.pendingPhoneVerification = null;
        await User.updateOne({ _id: user._id }, { $set: { pendingPhoneVerification: null } });
      }
    }

    // Enforce 60-second resend cooldown (only active if pending state exists and lastSentAt is recent)
    if (user.pendingPhoneVerification?.lastSentAt) {
      const elapsedMs = Date.now() - new Date(user.pendingPhoneVerification.lastSentAt).getTime();
      if (elapsedMs < 60 * 1000) {
        const waitSec = Math.ceil((60000 - elapsedMs) / 1000);
        return res.status(429).json({
          message: `Please wait ${waitSec} seconds before requesting another verification code`,
          retryAfter: waitSec,
        });
      }
    }

    // Generate cryptographically secure six-digit OTP (100000 to 999999)
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash('sha256').update(rawOtp).digest('hex');

    // 10-minute expiry
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    const challengeId = crypto.randomUUID();

    user.pendingPhoneVerification = {
      number: e164,
      otpHash,
      otpExpires,
      attempts: 0,
      lastSentAt: new Date(),
      challengeId,
    };

    await user.save({ validateBeforeSave: false });

    try {
      await smsService.sendVerificationOtp({
        to: e164,
        otp: rawOtp,
        userId: user._id,
      });
    } catch (smsErr) {
      // Fix 1 & 4: State rollback on SMS dispatch failure tied to exact challengeId
      user.pendingPhoneVerification = null;
      try {
        await User.updateOne(
          { _id: user._id, 'pendingPhoneVerification.challengeId': challengeId },
          { $set: { pendingPhoneVerification: null } }
        );
      } catch (rollbackErr) {
        console.error(`[Auth] Failed to rollback pending phone verification for ${maskPhone(e164)}`);
      }

      // Rollback rate limit attempt so user isn't penalized for provider delivery failure
      rollbackPhoneRateLimit(e164, req.rateLimitTimestamp);

      // Safe logging: log ONLY sanitized category and masked phone; NEVER log raw error message or provider tokens
      const errorCategory = (smsErr && smsErr.name) ? smsErr.name : 'SmsDeliveryError';
      console.error(`[Auth] SMS delivery failed [${errorCategory}] for recipient ${maskPhone(e164)}`);

      return res.status(503).json({
        message: 'Failed to deliver SMS verification code. Please try again.',
      });
    }

    return res.status(200).json({
      message: 'Verification code sent successfully',
      phoneMasked: maskPhone(e164),
      cooldownSeconds: 60,
    });
  } catch (err) {
    console.error('Start phone verification error:', err);
    res.status(500).json({ message: 'Failed to initiate phone verification' });
  }
};

router.post(
  '/phone/start-verification',
  protect,
  phoneVerificationLimiter,
  phonePerNumberLimiter,
  handleStartPhoneVerification
);
router.post(
  '/phone/send-code',
  protect,
  phoneVerificationLimiter,
  phonePerNumberLimiter,
  handleStartPhoneVerification
);

/**
 * Confirm Phone Verification
 * POST /api/auth/phone/confirm-verification (and alias /phone/verify-code)
 * Body: { otp, phoneNumber? }
 */
const handleConfirmPhoneVerification = async (req, res) => {
  try {
    const { otp, phoneNumber } = req.body;

    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6 || !/^\d{6}$/.test(trimmedOtp)) {
      return res.status(400).json({ message: 'Verification code must be a 6-digit number' });
    }

    const user = await User.findById(req.user._id).select('+pendingPhoneVerification');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const pending = user.pendingPhoneVerification;
    if (!pending || !pending.otpHash || !pending.number) {
      return res.status(400).json({ message: 'No pending phone verification found. Please request a new code.' });
    }

    // Optional phoneNumber validation to ensure client context matches
    if (phoneNumber && typeof phoneNumber === 'string') {
      const normalizedReq = validateAndNormalizePhone(phoneNumber);
      if (normalizedReq.valid && normalizedReq.e164 !== pending.number) {
        return res.status(400).json({ message: 'Submitted phone number does not match pending verification' });
      }
    }

    // Check maximum attempts (3 attempts)
    if (pending.attempts >= 3) {
      user.pendingPhoneVerification = null;
      await User.updateOne(
        { _id: user._id, 'pendingPhoneVerification.challengeId': pending.challengeId },
        { $set: { pendingPhoneVerification: null } }
      );
      return res.status(400).json({ message: 'Verification attempts exhausted. Please request a new code.' });
    }

    // Check expiration (10 minutes) (Fix 2: safe application-level cleanup without deleting user document)
    if (new Date() > new Date(pending.otpExpires)) {
      user.pendingPhoneVerification = null;
      await User.updateOne(
        { _id: user._id, 'pendingPhoneVerification.challengeId': pending.challengeId },
        { $set: { pendingPhoneVerification: null } }
      );
      return res.status(400).json({ message: 'Verification code has expired. Please request a new code.' });
    }

    // Timing-safe constant-time hash comparison
    const candidateHash = crypto.createHash('sha256').update(trimmedOtp).digest('hex');
    const expectedBuf = Buffer.from(pending.otpHash, 'hex');
    const actualBuf = Buffer.from(candidateHash, 'hex');

    const isMatch = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

    if (!isMatch) {
      // Atomic failed-attempt incrementation conditioned on active challenge and attempts < 3
      const updatedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          'pendingPhoneVerification.challengeId': pending.challengeId,
          'pendingPhoneVerification.attempts': { $lt: 3 },
        },
        {
          $inc: { 'pendingPhoneVerification.attempts': 1 },
        },
        {
          new: true,
          select: '+pendingPhoneVerification',
        }
      );

      const currentAttempts = updatedUser?.pendingPhoneVerification?.attempts ?? 3;
      const remainingAttempts = Math.max(0, 3 - currentAttempts);

      if (remainingAttempts <= 0 || !updatedUser) {
        user.pendingPhoneVerification = null;
        await User.updateOne(
          { _id: user._id, 'pendingPhoneVerification.challengeId': pending.challengeId },
          { $set: { pendingPhoneVerification: null } }
        );
        return res.status(400).json({ message: 'Verification attempts exhausted. Please request a new code.' });
      }

      return res.status(400).json({
        message: `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`,
      });
    }

    // Verified!
    const verifiedNumber = pending.number;

    // Check concurrent verification collision
    const conflict = await User.findOne({
      phoneNumber: verifiedNumber,
      phoneVerified: true,
      _id: { $ne: user._id },
    });

    if (conflict) {
      user.pendingPhoneVerification = null;
      await User.updateOne(
        { _id: user._id, 'pendingPhoneVerification.challengeId': pending.challengeId },
        { $set: { pendingPhoneVerification: null } }
      );
      return res.status(409).json({
        message: 'This phone number was already verified on another account',
      });
    }

    // Atomic consumption of verification challenge and setting of verified phone number
    let updatedUser;
    try {
      updatedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          'pendingPhoneVerification.challengeId': pending.challengeId,
          'pendingPhoneVerification.attempts': { $lt: 3 },
        },
        {
          $set: {
            phoneNumber: verifiedNumber,
            phoneVerified: true,
            phoneVerifiedAt: new Date(),
            pendingPhoneVerification: null,
          },
        },
        {
          new: true,
        }
      );
    } catch (dbErr) {
      if (dbErr.code === 11000) {
        return res.status(409).json({
          message: 'This phone number was already verified on another account',
        });
      }
      throw dbErr;
    }

    if (!updatedUser) {
      return res.status(400).json({
        message: 'Verification attempts exhausted or challenge expired. Please request a new code.',
      });
    }

    res.status(200).json({
      message: 'Phone number verified successfully',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        phoneNumber: updatedUser.phoneNumber,
        phoneVerified: updatedUser.phoneVerified,
        phoneVerifiedAt: updatedUser.phoneVerifiedAt,
        upiId: updatedUser.upiId || null,
      },
    });
  } catch (err) {
    console.error('Confirm phone verification error:', err);
    res.status(500).json({ message: 'Failed to verify phone number' });
  }
};

router.post('/phone/confirm-verification', protect, phoneVerificationLimiter, handleConfirmPhoneVerification);
router.post('/phone/verify-code', protect, phoneVerificationLimiter, handleConfirmPhoneVerification);

/**
 * Remove Verified Phone
 * DELETE /api/auth/phone
 */
router.delete('/phone', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+pendingPhoneVerification');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.phoneNumber && !user.phoneVerified && !user.pendingPhoneVerification) {
      return res.status(400).json({ message: 'No phone number associated with this account' });
    }

    user.phoneNumber = null;
    user.phoneVerified = false;
    user.phoneVerifiedAt = null;
    user.pendingPhoneVerification = null;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({
      message: 'Phone number removed successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: null,
        phoneVerified: false,
        phoneVerifiedAt: null,
        upiId: user.upiId || null,
      },
    });
  } catch (err) {
    console.error('Remove phone error:', err);
    res.status(500).json({ message: 'Failed to remove phone number' });
  }
});
router.getTrustedFrontendBaseUrl = getTrustedFrontendBaseUrl;
router.__clearPhoneRateLimitStore = __clearPhoneRateLimitStore;
router.checkAndRecordPhoneRateLimit = checkAndRecordPhoneRateLimit;
router.phonePerNumberLimiter = phonePerNumberLimiter;
router.rollbackPhoneRateLimit = rollbackPhoneRateLimit;
router.handleStartPhoneVerification = handleStartPhoneVerification;
router.handleConfirmPhoneVerification = handleConfirmPhoneVerification;
router.handleForgotPasswordPhone = handleForgotPasswordPhone;
router.handleResetPasswordPhone = handleResetPasswordPhone;
router.__clearPhoneRecoveryRateLimitStore = __clearPhoneRecoveryRateLimitStore;
router.checkAndRecordPhoneRecoveryRateLimit = checkAndRecordPhoneRecoveryRateLimit;
router.rollbackPhoneRecoveryRateLimit = rollbackPhoneRecoveryRateLimit;
router.phoneRecoveryPerNumberLimiter = phoneRecoveryPerNumberLimiter;
module.exports = router;
