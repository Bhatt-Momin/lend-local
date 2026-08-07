const express = require('express');
const Group = require('../models/Group');
const User = require('../models/User');
const Expense = require('../models/Expense');
const { protect } = require('../middleware/auth');
const { computeBalances } = require('../utils/helpers');

const router = express.Router();

router.use(protect);

// List groups for current user (with summary balances)
router.get('/', async (req, res) => {
  try {
    const groups = await Group.find({ members: req.user._id })
      .populate('members', 'name email')
      .populate('createdBy', 'name email')
      .sort({ updatedAt: -1 });

    const enriched = await Promise.all(
      groups.map(async (g) => {
        const expenses = await Expense.find({ group: g._id }).populate('paidBy', 'name');
        const { balances, settlements } = computeBalances(expenses, g.members);
        const mine = balances.find((b) => b.userId === req.user._id.toString());
        return {
          id: g._id,
          name: g.name,
          description: g.description,
          memberCount: g.members.length,
          members: g.members.map((m) => ({
            id: m._id,
            name: m.name,
            email: m.email,
          })),
          createdBy: g.createdBy,
          myBalance: mine ? mine.net : 0,
          settlements,
          expenseCount: expenses.length,
          updatedAt: g.updatedAt,
          createdAt: g.createdAt,
        };
      })
    );

    res.json({ groups: enriched });
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

    const isMember = group.members.some((m) => m._id.equals(req.user._id));
    if (!isMember) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    res.json({
      group: {
        id: group._id,
        name: group.name,
        description: group.description,
        members: group.members.map((m) => ({
          id: m._id,
          name: m.name,
          email: m.email,
        })),
        createdBy: {
          id: group.createdBy._id,
          name: group.createdBy.name,
          email: group.createdBy.email,
        },
        createdAt: group.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load group' });
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

    const populated = await Group.findById(group._id).populate('members', 'name email');

    res.json({
      members: populated.members.map((m) => ({
        id: m._id,
        name: m.name,
        email: m.email,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to add member' });
  }
});

module.exports = router;
