const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
    },

    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
    },

    razorpayOrderId: {
      type: String,
      unique: true,
      sparse: true,
    },

    method: {
      type: String,
      enum: ['razorpay', 'upi_direct'],
      default: 'razorpay',
    },

    payeeUpiId: {
      type: String,
    },

    payeeName: {
      type: String,
    },

    upiTransactionRef: {
      type: String,
      unique: true,
      sparse: true,
    },

    status: {
      type: String,
      enum: ['pending', 'payer_claimed', 'recipient_confirmed', 'recipient_rejected', 'cancelled', 'paid', 'failed', 'reversed'],
      default: 'pending',
    },

    claimedAt: {
      type: Date,
      default: null,
    },

    confirmedAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index(
  { group: 1, from: 1, to: 1 },
  {
    unique: true,
    partialFilterExpression: {
      method: 'upi_direct',
      status: { $in: ['pending', 'payer_claimed'] },
    },
    name: 'one_active_upi_direct_per_pair',
  }
);

module.exports = mongoose.model('Payment', paymentSchema);
