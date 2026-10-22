const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient is required'],
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    type: {
      type: String,
      required: [true, 'Notification type is required'],
      enum: [
        'expense_added',
        'expense_updated',
        'payment_received',
        'payment_claim',
        'payment_confirmed',
        'payment_rejected',
        'system',
      ],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: 140,
    },
    body: {
      type: String,
      required: [true, 'Body is required'],
      trim: true,
      maxlength: 500,
    },
    data: {
      groupId: { type: String, default: null },
      expenseId: { type: String, default: null },
      paymentId: { type: String, default: null },
      intentId: { type: String, default: null },
      amount: { type: Number, default: null },
    },
    // Deduplication key to prevent duplicate notifications for retried operations
    dedupeKey: {
      type: String,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for optimal authenticated inbox queries
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });

// Database-enforced compound unique index for deduplication:
// Ensures at most one notification per recipient & dedupeKey,
// while allowing multiple notifications without a dedupeKey via partialFilterExpression.
notificationSchema.index(
  { recipient: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
    name: 'unique_recipient_dedupe_key',
  }
);

module.exports = mongoose.model('Notification', notificationSchema);
