const mongoose = require('mongoose');

const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(

  {

    name: {

      type: String,

      required: [true, 'Name is required'],

      trim: true,

      maxlength: 80,

    },

    email: {

      type: String,

      required: [true, 'Email is required'],

      unique: true,

      lowercase: true,

      trim: true,

      match: [/^\S+@\S+\.\S+$/, 'Invalid email'],

    },

    password: {

      type: String,

      required: [true, 'Password is required'],

      minlength: 6,

      select: false,

    },

    // Firebase Cloud Messaging token
    revokedTokens: { type: [ new mongoose.Schema({ token: String, sessionId: String, exp: Number }, { _id: false }) ], default: [] },

    // Multi-device FCM token array supporting web, android, and future platforms
    fcmTokens: {
      type: [
        new mongoose.Schema(
          {
            token: {
              type: String,
              required: true,
              trim: true,
            },
            platform: {
              type: String,
              enum: ['web', 'android', 'ios'],
              default: 'web',
            },
            sessionId: {
              type: String,
              default: null,
            },
            claim: {
              type: String,
              default: null,
            },
            updatedAt: {
              type: Date,
              default: Date.now,
            },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    // Single FCM token fields retained for backward compatibility with existing readers
    fcmToken: {
      type: String,
      default: null,
    },
    fcmSessionId: {
      type: String,
      default: null,
    },
    fcmClaim: {
      type: String,
      default: null,
    },

    upiId: {
      type: String,
      trim: true,
      default: null,
    },

  },

  { timestamps: true }

);

// Index on fcmTokens.token for efficient stale-token pruning and cross-user lookups
userSchema.index({ 'fcmTokens.token': 1 }, { sparse: true });


userSchema.pre('save', async function hashPassword(next) {

  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 10);

  next();

});


userSchema.methods.comparePassword = function comparePassword(candidate) {

  return bcrypt.compare(candidate, this.password);

};


module.exports = mongoose.model('User', userSchema);