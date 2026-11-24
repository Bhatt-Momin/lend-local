const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Group name is required'],
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    budget: {
      monthlyLimit: {
        type: Number,
        default: 0,
        min: 0,
      },
      categoryLimits: {
        type: Map,
        of: Number,
        default: () => new Map(),
      },
      alertsSent: [
        {
          month: String,
          threshold: Number,
          category: { type: String, default: 'Overall' },
          sentAt: { type: Date, default: Date.now },
        },
      ],
    },
  },
  { timestamps: true }
);

groupSchema.index({ members: 1 });

module.exports = mongoose.model('Group', groupSchema);
