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
        email: user.email
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
        email: user.email
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
      email: req.user.email
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

      return res.status(400).json({
        message: 'FCM token is required',
      });

    }

    await User.updateMany(
      { fcmToken: token, _id: { $ne: req.user._id } },
      { $set: { fcmToken: null } }
    );

    req.user.fcmToken = token;

    await req.user.save();

    console.log(
      `FCM token saved for user: ${req.user.email}`
    );

    res.json({
      message: 'FCM token saved successfully',
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
   SAVE UPI ID
===================================================== */
router.post('/upi-id', protect, async (req, res) => {
  try {
    const { upiId } = req.body;

    if (typeof upiId !== 'string') {
      return res.status(400).json({ message: 'UPI ID must be a string' });
    }

    const trimmedUpiId = upiId.trim();

    if (!trimmedUpiId) {
      return res.status(400).json({ message: 'UPI ID is required' });
    }

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
