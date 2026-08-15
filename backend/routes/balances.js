const express = require('express');

const Expense = require('../models/Expense');
const Payment = require('../models/payment');
const Group = require('../models/Group');

const { protect } = require('../middleware/auth');
const { computeBalances } = require('../utils/helpers');

const router = express.Router();

router.use(protect);

router.get('/:groupId', async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId)
      .populate('members', 'name email');

    if (!group) {
      return res.status(404).json({
        message: 'Group not found',
      });
    }

    if (
      !group.members.some((m) =>
        m._id.equals(req.user._id)
      )
    ) {
      return res.status(403).json({
        message: 'You are not a member of this group',
      });
    }

    // Get all expenses
    const expenses = await Expense.find({
      group: group._id,
    })
      .populate('paidBy', 'name')
      .populate('splits.user', 'name');

    // Get all successful payments
    const payments = await Payment.find({
      group: group._id,
      status: 'paid',
    })
      .populate('from', 'name')
      .populate('to', 'name');

    // Calculate balances from expenses
    const result = computeBalances(
      expenses,
      group.members
    );

    let balances = result.balances;

    // Apply settlement payments
    payments.forEach((payment) => {
      const fromId = String(payment.from._id);
      const toId = String(payment.to._id);
      const amount = Number(payment.amount);

      const fromBalance = balances.find(
        (b) => String(b.userId) === fromId
      );

      const toBalance = balances.find(
        (b) => String(b.userId) === toId
      );

      // The payer owed money, so payment increases their net balance
      if (fromBalance) {
        fromBalance.net =
          Math.round(
            (fromBalance.net + amount) * 100
          ) / 100;
      }

      // The receiver was owed money, so payment decreases their net balance
      if (toBalance) {
        toBalance.net =
          Math.round(
            (toBalance.net - amount) * 100
          ) / 100;
      }
    });

    // Recalculate settlements after payments
    const debtors = balances
      .filter((b) => b.net < -0.01)
      .map((b) => ({
        ...b,
        remaining: Math.abs(b.net),
      }));

    const creditors = balances
      .filter((b) => b.net > 0.01)
      .map((b) => ({
        ...b,
        remaining: b.net,
      }));

    const settlements = [];

    let debtorIndex = 0;
    let creditorIndex = 0;

    while (
      debtorIndex < debtors.length &&
      creditorIndex < creditors.length
    ) {
      const debtor = debtors[debtorIndex];
      const creditor = creditors[creditorIndex];

      const amount = Math.min(
        debtor.remaining,
        creditor.remaining
      );

      settlements.push({
        from: {
          id: debtor.userId,
          name: debtor.name,
        },

        to: {
          id: creditor.userId,
          name: creditor.name,
        },

        amount: Math.round(amount * 100) / 100,
      });

      debtor.remaining -= amount;
      creditor.remaining -= amount;

      if (debtor.remaining < 0.01) {
        debtorIndex++;
      }

      if (creditor.remaining < 0.01) {
        creditorIndex++;
      }
    }

    const totalSpent = expenses.reduce(
      (sum, expense) =>
        sum + Number(expense.amount),
      0
    );

    res.json({
      groupId: group._id,
      groupName: group.name,

      totalSpent:
        Math.round(totalSpent * 100) / 100,

      expenseCount: expenses.length,

      balances,

      settlements,
    });
  } catch (err) {
    console.error('Balance error:', err);

    res.status(500).json({
      message:
        err.message ||
        'Failed to compute balances',
    });
  }
});

module.exports = router;