const express = require('express');
const Group = require('../models/Group');
const User = require('../models/User');
const Expense = require('../models/Expense');
const { protect } = require('../middleware/auth');
const { getGroupLedger, checkParticipation } = require('../utils/helpers');
const Payment = require('../models/payment');

const router = express.Router();

router.use(protect);

// List groups for current user (with summary balances)
router.get('/', async (req, res) => {
  try {
    const expenseGroupIds = await Expense.distinct('group', { $or: [{ paidBy: req.user._id }, { 'splits.user': req.user._id }] });
    const paymentGroupIds = await Payment.distinct('group', { $or: [{ from: req.user._id }, { to: req.user._id }] });

    const groups = await Group.find({
      $or: [
        { members: req.user._id },
        { _id: { $in: [...expenseGroupIds, ...paymentGroupIds] } }
      ]
    })
      .populate('members', 'name email')
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1 });

    const enriched = await Promise.all(
      groups.map(async (g) => {
        const ledger = await getGroupLedger(g._id);
        const mine = ledger.balances.find((b) => b.userId === req.user._id.toString());
        const isActiveMember = g.members.some(m => m._id.equals(req.user._id));

        const myBalance = mine ? mine.net : 0;

        if (!isActiveMember && Math.abs(myBalance) < 0.01) {
          return null; // Skip if departed and no outstanding balance
        }

        const uIdStr = req.user._id.toString();
        const settlements = isActiveMember
          ? ledger.settlements
          : ledger.settlements.filter(s => s.from.id === uIdStr || s.to.id === uIdStr);

        return {
          id: g._id,
          name: g.name,
          description: g.description,
          memberCount: g.members.length,
          members: g.members.map((m) => {
            const memberObj = {
              id: m._id,
              name: m.name,
            };
            if (isActiveMember) {
              memberObj.email = m.email;
            }
            return memberObj;
          }),
          createdBy: isActiveMember ? g.createdBy : {
            _id: g.createdBy._id,
            name: g.createdBy.name
          },
          myBalance,
          settlements,
          expenseCount: ledger.expenses.length,
          updatedAt: g.updatedAt,
          createdAt: g.createdAt,
          isActiveMember,
          hasOutstandingBalance: Math.abs(myBalance) >= 0.01
        };
      })
    );

    res.json({ groups: enriched.filter(g => g !== null) });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load groups' });
  }
});

// Create group
router.post('/', async (req, res) => {
  try {
    const { name, description, memberEmails } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Group name is required' });
    }

    const memberIds = new Set([req.user._id.toString()]);

    if (Array.isArray(memberEmails) && memberEmails.length) {
      const emails = memberEmails
        .map((e) => String(e).toLowerCase().trim())
        .filter(Boolean);

      const users = await User.find({ email: { $in: emails } });
      const found = new Set(users.map((u) => u.email));
      const missing = emails.filter((e) => !found.has(e));

      if (missing.length) {
        return res.status(400).json({
          message: `No account found for: ${missing.join(', ')}. Ask them to register first.`,
        });
      }

      users.forEach((u) => memberIds.add(u._id.toString()));
    }

    const group = await Group.create({
      name: name.trim(),
      description: (description || '').trim(),
      createdBy: req.user._id,
      members: [...memberIds],
    });

    const populated = await Group.findById(group._id)
      .populate('members', 'name email')
      .populate('createdBy', 'name email');

    res.status(201).json({
      group: {
        id: populated._id,
        name: populated.name,
        description: populated.description,
        members: populated.members.map((m) => ({
          id: m._id,
          name: m.name,
          email: m.email,
        })),
        createdBy: populated.createdBy,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to create group' });
  }
});

// Get single group
router.get('/:id', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members', 'name email')
      .populate('createdBy', 'name email');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const { isActiveMember, isHistoricalParticipant } = await checkParticipation(req.user._id, req.params.id);

    if (!isHistoricalParticipant) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    let membersData = group.members.map((m) => ({
      id: m._id,
      name: m.name,
      email: m.email,
    }));

    let createdByData = {
      id: group.createdBy._id,
      name: group.createdBy.name,
      email: group.createdBy.email,
    };

    if (!isActiveMember) {
      membersData = group.members.map(m => ({ id: m._id, name: m.name, email: "" }));
      createdByData = {
        id: group.createdBy._id,
        name: group.createdBy.name
      };
    }

    res.json({
      group: {
        id: group._id,
        name: group.name,
        description: group.description,
        members: membersData,
        createdBy: createdByData,
        updatedAt: group.updatedAt,
        createdAt: group.createdAt,
        isActiveMember
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// Add member by email
router.post('/:id/members', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (!group.members.some((m) => m.equals(req.user._id))) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ message: 'No user registered with that email' });
    }

    if (group.members.some((m) => m.equals(user._id))) {
      return res.status(400).json({ message: 'User is already a member' });
    }

    group.members.push(user._id);
    await group.save();

    res.json({
      message: 'Member added successfully',
      member: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to add member' });
  }
});

// =====================================================
// LEAVE GROUP
// =====================================================

router.delete('/:id/members/me', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    if (!group.members.some((m) => m.equals(req.user._id))) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    if (group.createdBy.equals(req.user._id)) {
      return res.status(400).json({ message: 'Group creator cannot leave' });
    }

    group.members.pull(req.user._id);
    await group.save();

    res.json({ message: 'Successfully left the group' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to leave group' });
  }
});

module.exports = router;
