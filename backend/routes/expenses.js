const express = require('express');
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

async function assertMember(groupId, userId) {
  const group = await Group.findById(groupId);
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  if (!group.members.some((m) => m.equals(userId))) {
    const err = new Error('You are not a member of this group');
    err.status = 403;
    throw err;
  }
  return group;
}

// List expenses for a group
router.get('/:groupId', async (req, res) => {
  try {
    await assertMember(req.params.groupId, req.user._id);

    const expenses = await Expense.find({ group: req.params.groupId })
      .populate('paidBy', 'name email')
      .populate('splits.user', 'name email')
      .sort({ date: -1, createdAt: -1 });

    res.json({
      expenses: expenses.map((e) => ({
        id: e._id,
        description: e.description,
        amount: e.amount,
        category: e.category,
        splitType: e.splitType,
        date: e.date,
        paidBy: {
          id: e.paidBy._id,
          name: e.paidBy.name,
          email: e.paidBy.email,
        },
        splits: e.splits.map((s) => ({
          user: { id: s.user._id, name: s.user.name, email: s.user.email },
          share: s.share,
        })),
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Failed to load expenses' });
  }
});

// Add expense
router.post('/', async (req, res) => {
  try {
    const { groupId, description, amount, paidBy, splitType, splits, category, date } = req.body;

    if (!groupId || !description || amount == null) {
      return res.status(400).json({ message: 'groupId, description, and amount are required' });
    }

    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be a positive number' });
    }

    const group = await assertMember(groupId, req.user._id);

    const payerId = paidBy || req.user._id.toString();
    if (!group.members.some((m) => m.toString() === payerId)) {
      return res.status(400).json({ message: 'Payer must be a group member' });
    }

    const type = splitType === 'custom' ? 'custom' : 'equal';
    let finalSplits = [];

    if (type === 'equal') {
      const participantIds =
        Array.isArray(splits) && splits.length
          ? splits.map((s) => (s.user || s).toString())
          : group.members.map((m) => m.toString());

      for (const id of participantIds) {
        if (!group.members.some((m) => m.toString() === id)) {
          return res.status(400).json({ message: 'All split participants must be group members' });
        }
      }

      const n = participantIds.length;
      if (!n) {
        return res.status(400).json({ message: 'At least one participant is required' });
      }

      const base = Math.floor((numericAmount * 100) / n) / 100;
      let remainder = Math.round((numericAmount - base * n) * 100) / 100;

      finalSplits = participantIds.map((id, idx) => {
        let share = base;
        if (remainder > 0) {
          share = Math.round((share + 0.01) * 100) / 100;
          remainder = Math.round((remainder - 0.01) * 100) / 100;
        }
        return { user: id, share };
      });
    } else {
      if (!Array.isArray(splits) || !splits.length) {
        return res.status(400).json({ message: 'Custom splits are required' });
      }

      finalSplits = splits.map((s) => ({
        user: (s.user || '').toString(),
        share: Number(s.share),
      }));

      for (const s of finalSplits) {
        if (!group.members.some((m) => m.toString() === s.user)) {
          return res.status(400).json({ message: 'All split users must be group members' });
        }
        if (Number.isNaN(s.share) || s.share < 0) {
          return res.status(400).json({ message: 'Invalid share amount' });
        }
      }

      const total = finalSplits.reduce((sum, s) => sum + s.share, 0);
      if (Math.abs(total - numericAmount) > 0.02) {
        return res.status(400).json({
          message: `Split shares (₹${total.toFixed(2)}) must equal expense amount (₹${numericAmount.toFixed(2)})`,
        });
      }
    }

    const expense = await Expense.create({
      group: groupId,
      description: description.trim(),
      amount: numericAmount,
      paidBy: payerId,
      splitType: type,
      splits: finalSplits,
      category: (category || 'General').trim(),
      date: date ? new Date(date) : new Date(),
    });

    const populated = await Expense.findById(expense._id)
      .populate('paidBy', 'name email')
      .populate('splits.user', 'name email');

    // Touch group updatedAt
    group.updatedAt = new Date();
    await group.save();

    res.status(201).json({
      expense: {
        id: populated._id,
        description: populated.description,
        amount: populated.amount,
        category: populated.category,
        splitType: populated.splitType,
        date: populated.date,
        paidBy: {
          id: populated.paidBy._id,
          name: populated.paidBy.name,
          email: populated.paidBy.email,
        },
        splits: populated.splits.map((s) => ({
          user: { id: s.user._id, name: s.user.name, email: s.user.email },
          share: s.share,
        })),
      },
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Failed to add expense' });
  }
});

// Delete expense
router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    await assertMember(expense.group, req.user._id);

    // Only payer or any member can delete in this simple student app
    await expense.deleteOne();
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Failed to delete expense' });
  }
});

module.exports = router;
