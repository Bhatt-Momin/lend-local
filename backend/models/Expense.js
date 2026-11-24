const mongoose = require('mongoose');

const splitSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    share: {
      type: Number,
      required: true,
      min: 0,
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100,
    },
    shares: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const payerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Payer amount must be at least ₹0.01'],
    },
  },
  { _id: false }
);

const expenseSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
      index: true,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: 200,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [0.01, 'Amount must be positive'],
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    payers: {
      type: [payerSchema],
      default: undefined,
    },
    splitType: {
      type: String,
      enum: ['equal', 'custom', 'exact', 'percentage', 'shares'],
      default: 'equal',
    },
    splits: {
      type: [splitSchema],
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'At least one split is required',
      },
    },
    category: {
      type: String,
      trim: true,
      default: 'General',
      maxlength: 40,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    date: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Pre-save hook: validate payers vs amount and maintain backwards compatibility with paidBy
expenseSchema.pre('save', function (next) {
  const expense = this;

  if (Array.isArray(expense.payers) && expense.payers.length > 0) {
    const totalPayerPaise = expense.payers.reduce(
      (sum, p) => sum + Math.round(Number(p.amount || 0) * 100),
      0
    );
    const expensePaise = Math.round(Number(expense.amount || 0) * 100);

    if (Math.abs(totalPayerPaise - expensePaise) > 1) {
      return next(
        new Error(
          `Sum of payer amounts (₹${(totalPayerPaise / 100).toFixed(2)}) must equal expense amount (₹${(expensePaise / 100).toFixed(2)})`
        )
      );
    }

    if (!expense.paidBy && expense.payers[0]?.user) {
      expense.paidBy = expense.payers[0].user;
    }
  } else if (!expense.paidBy) {
    return next(new Error('Expense must have a payer (paidBy or payers array)'));
  }

  next();
});

expenseSchema.methods.getPayersList = function () {
  if (Array.isArray(this.payers) && this.payers.length > 0) {
    return this.payers;
  }
  if (this.paidBy) {
    return [{ user: this.paidBy, amount: this.amount }];
  }
  return [];
};

module.exports = mongoose.model('Expense', expenseSchema);
