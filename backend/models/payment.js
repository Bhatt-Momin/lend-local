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
      required: true,
      unique: true,
    },

    razorpayOrderId: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ['paid', 'failed'],
      default: 'paid',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Payment', paymentSchema);