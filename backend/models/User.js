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

    passwordChangedAt: {
      type: Date,
      default: null,
    },

    resetPasswordToken: {
      type: String,
      default: null,
      select: false,
    },

    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },

    // Verified international phone number (E.164)
    phoneNumber: {
      type: String,
      trim: true,
      default: null,
    },

    phoneVerified: {
      type: Boolean,
      default: false,
    },

    phoneVerifiedAt: {
      type: Date,
      default: null,
    },

    // Pending in-app phone verification state (unselected by default)
    // CRITICAL ARCHITECTURAL SAFEGUARD (Fix 2):
    // DO NOT add a MongoDB TTL index on pendingPhoneVerification.otpExpires!
    // In MongoDB, a TTL index on any field within a document deletes the ENTIRE document
    // when it expires, which would destroy the user account.
    // Expired verification state is safely pruned via application logic in routes/auth.js.
    // If automated background database-level cleanup is desired in the future,
    // a separate collection (e.g. PhoneVerificationRequests) with document-level TTL must be used.
    pendingPhoneVerification: {
      type: new mongoose.Schema(
        {
          number: { type: String, default: null, select: false },
          otpHash: { type: String, default: null, select: false },
          otpExpires: { type: Date, default: null, select: false },
          attempts: { type: Number, default: 0, select: false },
          lastSentAt: { type: Date, default: null, select: false },
        },
        { _id: false }
      ),
      default: null,
      select: false,
    },

  },

  { timestamps: true }

);

// Index on fcmTokens.token for efficient stale-token pruning and cross-user lookups
userSchema.index({ 'fcmTokens.token': 1 }, { sparse: true });
userSchema.index({ resetPasswordToken: 1 }, { sparse: true });

// Partial unique index: enforces uniqueness on verified/assigned phone numbers ONLY when phoneNumber is a string.
// Completely safe for existing/legacy accounts with null or undefined phone numbers.
userSchema.index(
  { phoneNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { phoneNumber: { $type: 'string' } },
    name: 'unique_user_phone_number',
  }
);


userSchema.pre('save', async function hashPassword(next) {

  if (!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 10);

  next();

});


userSchema.methods.comparePassword = function comparePassword(candidate) {

  return bcrypt.compare(candidate, this.password);

};


module.exports = mongoose.model('User', userSchema);
