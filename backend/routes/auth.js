const express = require('express');
const User = require('../models/User');
const { signToken } = require('../utils/helpers');
const { protect } = require('../middleware/auth');


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
        upiId: user.upiId || null
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
        upiId: user.upiId || null
      },
    });

  } catch (err) {

    res.status(500).json({
      message: err.message || 'Login failed'
    });
  }
});


router.get('/me', protect, async (req, res) => {

  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      upiId: req.user.upiId
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
module.exports = router;
