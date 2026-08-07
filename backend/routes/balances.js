const express = require('express');
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const { protect } = require('../middleware/auth');
const { computeBalances } = require('../utils/helpers');

const router = express.Router();

router.use(protect);

router.get('/:groupId', async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).populate('members', 'name email');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (!group.members.some((m) => m._id.equals(req.user._id))) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    const expenses = await Expense.find({ group: group._id })
      .populate('paidBy', 'name')
      .populate('splits.user', 'name');

    const { balances, settlements } = computeBalances(expenses, group.members);

    const totalSpent = expenses.reduce((sum, e) => sum + e.amount, 0);

    res.json({
      groupId: group._id,
      groupName: group.name,
      totalSpent: Math.round(totalSpent * 100) / 100,
      expenseCount: expenses.length,
      balances,
      settlements,
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to compute balances' });
  }
});

module.exports = router;
