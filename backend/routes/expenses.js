const express = require('express');
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { getMessaging } = require('firebase-admin/messaging');

const router = express.Router();

router.use(protect);

const { checkParticipation } = require('../utils/helpers');

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

async function assertParticipant(groupId, userId) {
  const { isActiveMember, isHistoricalParticipant } = await checkParticipation(userId, groupId);
  if (!isHistoricalParticipant) {
    const err = new Error('You are not a member of this group');
    err.status = 403;
    throw err;
  }
  return { isActiveMember, isHistoricalParticipant };
}


// =====================================================
// LIST EXPENSES
// =====================================================

router.get('/:groupId', async (req, res) => {

  try {

    const { isActiveMember } = await assertParticipant(req.params.groupId, req.user._id);

    const query = { group: req.params.groupId };
    // Filters
    if (req.query.search) {
      const escapeRegex = (text) => text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      query.description = { $regex: escapeRegex(req.query.search), $options: 'i' };
    }
    if (req.query.category) {
      query.category = req.query.category;
    }
    if (req.query.payer) {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(req.query.payer)) {
        return res.status(400).json({ message: 'Invalid payer ID format' });
      }
      query.paidBy = req.query.payer;
    }
    if (req.query.startDate || req.query.endDate) {
      query.date = {};
      let start, end;
      if (req.query.startDate) {
        start = new Date(req.query.startDate);
        if (isNaN(start.getTime())) return res.status(400).json({ message: 'Invalid start date' });
        query.date.$gte = start;
      }
      if (req.query.endDate) {
        end = new Date(req.query.endDate);
        if (isNaN(end.getTime())) return res.status(400).json({ message: 'Invalid end date' });
        // Set to end of day to include all expenses on the end date
        end.setUTCHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
      if (start && end && start > end) {
        return res.status(400).json({ message: 'Start date cannot be after end date' });
      }
    }

    let expenses = await Expense.find(query)
      .populate('paidBy', 'name email')
      .populate('splits.user', 'name email')
      .sort({ date: -1, createdAt: -1 });

    if (!isActiveMember) {
      expenses = expenses.filter(e => {
        const uId = req.user._id.toString();
        const isPayer = e.paidBy && e.paidBy._id.toString() === uId;
        const inSplits = e.splits && e.splits.some(s => s.user && s.user._id.toString() === uId);
        return isPayer || inSplits;
      });
    }

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
          ...(isActiveMember && e.paidBy.email ? { email: e.paidBy.email } : {})
        },

        createdBy: e.createdBy ? e.createdBy.toString() : null,

        splits: e.splits.map((s) => ({

          user: {
            id: s.user._id,
            name: s.user.name,
            ...(isActiveMember && s.user.email ? { email: s.user.email } : {})
          },

          share: s.share,

        })),

        createdAt: e.createdAt,

      })),

    });

  } catch (err) {

    res.status(
      err.status || 500
    ).json({
      message:
        err.message ||
        'Failed to load expenses'
    });

  }

});


// =====================================================
// ADD EXPENSE
// =====================================================

router.post('/', async (req, res) => {

  try {

    const {
      groupId,
      description,
      amount,
      paidBy,
      splitType,
      splits,
      category,
      date
    } = req.body;


    if (
      !groupId ||
      typeof description !== 'string' ||
      !description.trim() ||
      typeof amount !== 'number'
    ) {
      return res.status(400).json({
        message: 'groupId, non-empty description, and numeric amount are required'
      });
    }

    const envMax = Number(process.env.MAX_EXPENSE_AMOUNT);
    const MAX_AMOUNT = (Number.isFinite(envMax) && envMax > 0) ? envMax : 10000000;

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_AMOUNT
    ) {
      return res.status(400).json({
        message: 'Valid finite positive amount required within limits'
      });
    }

    if (parseFloat(amount.toFixed(2)) !== amount) {
      return res.status(400).json({
        message: 'Amount must have at most two decimal places'
      });
    }

    const numericAmount = amount;
    const totalPaise = Math.round(numericAmount * 100);
    if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > Math.round(MAX_AMOUNT * 100)) {
      return res.status(400).json({
        message: 'Expense amount exceeds safe integer arithmetic limits'
      });
    }


    const group =
      await assertMember(
        groupId,
        req.user._id
      );


    const payerId =
      paidBy ||
      req.user._id.toString();


    if (
      !group.members.some(
        (m) =>
          m.toString() === payerId
      )
    ) {

      return res.status(400).json({
        message:
          'Payer must be a group member'
      });

    }


    const type =
      splitType === 'custom'
        ? 'custom'
        : 'equal';


    let finalSplits = [];


    // =================================================
    // EQUAL SPLIT
    // =================================================

    if (type === 'equal') {

      const participantIds =
        Array.isArray(splits) &&
        splits.length

          ? splits.map(
              (s) =>
                (s.user || s).toString()
            )

          : group.members.map(
              (m) =>
                m.toString()
            );

      const uniqueIds = new Set();
      for (
        const id of participantIds
      ) {

        if (uniqueIds.has(id)) {
          return res.status(400).json({
            message: 'Duplicate split participant'
          });
        }
        uniqueIds.add(id);

        if (
          !group.members.some(
            (m) =>
              m.toString() === id
          )
        ) {

          return res.status(400).json({
            message:
              'All split participants must be group members'
          });

        }

      }


      const n =
        participantIds.length;


      if (!n) {

        return res.status(400).json({
          message:
            'At least one participant is required'
        });

      }


      const totalPaise = Math.round(numericAmount * 100);
      const basePaise = Math.floor(totalPaise / n);
      const remainderPaise = totalPaise % n;

      finalSplits = participantIds.map((id, idx) => ({
        user: id,
        share: (basePaise + (idx < remainderPaise ? 1 : 0)) / 100
      }));

    }


    // =================================================
    // CUSTOM SPLIT
    // =================================================

    else {

      if (
        !Array.isArray(splits) ||
        !splits.length
      ) {

        return res.status(400).json({
          message:
            'Custom splits are required'
        });

      }


      finalSplits =
        splits.map((s) => ({

          user:
            (s.user || '').toString(),

          share:
            s.share,

        }));

      const uniqueIds = new Set();
      for (
        const s of finalSplits
      ) {

        if (uniqueIds.has(s.user)) {
          return res.status(400).json({
            message: 'Duplicate split participant'
          });
        }
        uniqueIds.add(s.user);

        if (
          !group.members.some(
            (m) =>
              m.toString() === s.user
          )
        ) {

          return res.status(400).json({
            message:
              'All split users must be group members'
          });

        }


        const sharePaise = Math.round(s.share * 100);
        if (
          typeof s.share !== 'number' ||
          !Number.isFinite(s.share) ||
          !Number.isSafeInteger(sharePaise) ||
          sharePaise < 0 ||
          sharePaise > totalPaise ||
          s.share > MAX_AMOUNT
        ) {
          return res.status(400).json({
            message: 'Invalid share amount'
          });
        }

        if (parseFloat(s.share.toFixed(2)) !== s.share) {
          return res.status(400).json({
            message: 'Share amount must have at most two decimal places'
          });
        }

      }


      const totalCents = Math.round(numericAmount * 100);
      const splitTotalCents = finalSplits.reduce((sum, s) => sum + Math.round(s.share * 100), 0);

      if (totalCents !== splitTotalCents) {
        return res.status(400).json({
          message:
            `Split shares (₹${(splitTotalCents/100).toFixed(2)}) must equal expense amount (₹${(totalCents/100).toFixed(2)})`
        });
      }

    }


    // =================================================
    // CREATE EXPENSE
    // =================================================

    const expense =
      await Expense.create({

        group: groupId,

        description:
          description.trim(),

        amount:
          numericAmount,

        paidBy:
          payerId,

        createdBy:
          req.user._id,

        splitType:
          type,

        splits:
          finalSplits,

        category:
          (category || 'General').trim(),

        date:
          date
            ? new Date(date)
            : new Date(),

      });


    // =================================================
    // POPULATE EXPENSE
    // =================================================

    const populated =
      await Expense.findById(
        expense._id
      )
      .populate(
        'paidBy',
        'name email'
      )
      .populate(
        'splits.user',
        'name email'
      );


    // =================================================
    // UPDATE GROUP
    // =================================================

    group.updatedAt =
      new Date();

    await group.save();


    // =================================================
    // SEND PUSH NOTIFICATION
    // =================================================

    try {

      const otherMemberIds =
        group.members

          .map(
            (memberId) =>
              memberId.toString()
          )

          .filter(
            (memberId) =>
              memberId !==
              req.user._id.toString()
          );


      const members =
        await User.find({

          _id: {
            $in:
              otherMemberIds
          },

          fcmToken: {
            $ne: null
          }

        })
        .select(
          'name fcmToken'
        );


      const tokens =
        members

          .map(
            (member) =>
              member.fcmToken
          )

          .filter(Boolean);


      if (tokens.length > 0) {

        const title =
          'New expense added 💸';


        const body =
          `${populated.paidBy.name} added ₹${numericAmount.toFixed(2)} for ${populated.description}`;


        const message = {

          tokens,

          notification: {
            title,
            body
          },

          webpush: {

            notification: {

              icon:
                '/icons/icon-192.png',

              badge:
                '/icons/icon-192.png'

            },

            fcmOptions: {

              link:
                '/group.html'

            }

          },

          data: {

            type:
              'expense',

            expenseId:
              populated._id.toString(),

            groupId:
              groupId.toString(),

            title,

            body

          }

        };


        const result =
          await getMessaging()
            .sendEachForMulticast(
              message
            );


        console.log(
          `Expense notification sent: ${result.successCount} successful, ${result.failureCount} failed`
        );

      }

    } catch (
      notificationError
    ) {

      console.error(
        'Expense notification error:',
        notificationError
      );

    }


    // =================================================
    // RESPONSE
    // =================================================

    res.status(201).json({

      expense: {

        id:
          populated._id,

        description:
          populated.description,

        amount:
          populated.amount,

        category:
          populated.category,

        splitType:
          populated.splitType,

        date:
          populated.date,

        paidBy: {

          id:
            populated.paidBy._id,

          name:
            populated.paidBy.name,

          email:
            populated.paidBy.email,

        },

        splits:
          populated.splits.map(
            (s) => ({

              user: {

                id:
                  s.user._id,

                name:
                  s.user.name,

                email:
                  s.user.email,

              },

              share:
                s.share,

            })
          ),

      },

    });

  } catch (err) {

    res.status(
      err.status || 500
    ).json({

      message:
        err.message ||
        'Failed to add expense'

    });

  }

});


// =====================================================
// DELETE EXPENSE
// =====================================================

router.delete('/:id', async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    const group = await Group.findById(expense.group);
    const isCreator = group && group.createdBy.equals(req.user._id);
    const isExpenseCreator = expense.createdBy && expense.createdBy.equals(req.user._id);
    const isPayer = expense.paidBy.equals(req.user._id);

    let authorized = false;
    if (expense.createdBy) {
      authorized = isExpenseCreator || isCreator;
    } else {
      authorized = isPayer || isCreator;
    }

    if (!authorized) {
      return res.status(403).json({ message: 'Only the expense creator or group creator can delete this expense' });
    }

    await expense.deleteOne();
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server Error' });
  }
});


// =====================================================
// EDIT EXPENSE
// =====================================================

router.put('/:id', async (req, res) => {
  try {
    const {
      description,
      amount,
      paidBy,
      splitType,
      splits,
      category,
      date
    } = req.body;

    if (typeof description !== 'string' || !description.trim() || typeof amount !== 'number') {
      return res.status(400).json({ message: 'non-empty description and numeric amount are required' });
    }

    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    const group = await assertMember(expense.group, req.user._id);

    const isCreator = group && group.createdBy.equals(req.user._id);
    const isExpenseCreator = expense.createdBy && expense.createdBy.equals(req.user._id);
    const isPayer = expense.paidBy.equals(req.user._id);

    let authorized = false;
    if (expense.createdBy) {
      authorized = isExpenseCreator || isCreator;
    } else {
      authorized = isPayer || isCreator;
    }

    if (!authorized) {
      return res.status(403).json({ message: 'Only the expense creator or group creator can edit this expense' });
    }

    const envMax = Number(process.env.MAX_EXPENSE_AMOUNT);
    const MAX_AMOUNT = (Number.isFinite(envMax) && envMax > 0) ? envMax : 10000000;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: 'Invalid expense amount' });
    }
    if (amount > MAX_AMOUNT) {
      return res.status(400).json({ message: `Amount exceeds maximum allowed (₹${MAX_AMOUNT})` });
    }
    if (parseFloat(amount.toFixed(2)) !== amount) {
      return res.status(400).json({ message: 'Amount must have at most two decimal places' });
    }
    const numericAmount = amount;
    const totalPaise = Math.round(numericAmount * 100);
    if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > Math.round(MAX_AMOUNT * 100)) {
      return res.status(400).json({ message: 'Expense amount exceeds safe integer arithmetic limits' });
    }

    const payerId = paidBy ? paidBy.toString() : req.user._id.toString();
    if (!group.members.some((m) => m.toString() === payerId)) {
      return res.status(400).json({ message: 'Payer must be a member of the group' });
    }

    const type = splitType === 'custom' ? 'custom' : 'equal';
    let finalSplits = [];

    // =================================================
    // EQUAL SPLIT
    // =================================================
    if (type === 'equal') {
      let participantIds = [];
      if (Array.isArray(splits) && splits.length > 0) {
        participantIds = splits
          .map((s) => (s.user || s).toString());
      } else {
        participantIds = group.members.map((m) => m.toString());
      }

      const uniqueIds = new Set();
      for (const id of participantIds) {
        if (uniqueIds.has(id)) {
          return res.status(400).json({ message: 'Duplicate split participant' });
        }
        if (!group.members.some((m) => m.toString() === id)) {
          return res.status(400).json({ message: 'All split participants must be group members' });
        }
        uniqueIds.add(id);
      }

      if (!participantIds.length) {
        return res.status(400).json({ message: 'At least one valid participant is required for equal split' });
      }

      const n = participantIds.length;
      const basePaise = Math.floor(totalPaise / n);
      const remainderPaise = totalPaise % n;

      finalSplits = participantIds.map((id, idx) => ({
        user: id,
        share: (basePaise + (idx < remainderPaise ? 1 : 0)) / 100
      }));
    }
    // =================================================
    // CUSTOM SPLIT
    // =================================================
    else {
      if (!Array.isArray(splits) || !splits.length) {
        return res.status(400).json({ message: 'Custom splits are required' });
      }

      finalSplits = splits.map((s) => ({
        user: (s.user || '').toString(),
        share: s.share,
      }));

      const uniqueIds = new Set();
      for (const s of finalSplits) {
        if (uniqueIds.has(s.user)) {
          return res.status(400).json({ message: 'Duplicate split participant' });
        }
        uniqueIds.add(s.user);

        if (!group.members.some((m) => m.toString() === s.user)) {
          return res.status(400).json({ message: 'All split users must be group members' });
        }
        const sharePaise = Math.round(s.share * 100);
        if (
          typeof s.share !== 'number' ||
          !Number.isFinite(s.share) ||
          !Number.isSafeInteger(sharePaise) ||
          sharePaise < 0 ||
          sharePaise > totalPaise ||
          s.share > MAX_AMOUNT
        ) {
          return res.status(400).json({ message: 'Invalid share amount' });
        }
        if (parseFloat(s.share.toFixed(2)) !== s.share) {
          return res.status(400).json({ message: 'Share amount must have at most two decimal places' });
        }
      }

      const totalCents = Math.round(numericAmount * 100);
      const splitTotalCents = finalSplits.reduce((sum, s) => sum + Math.round(s.share * 100), 0);
      if (totalCents !== splitTotalCents) {
        return res.status(400).json({ message: `Split shares (₹${(splitTotalCents/100).toFixed(2)}) must equal expense amount (₹${(totalCents/100).toFixed(2)})` });
      }
    }

    expense.description = description.trim();
    expense.amount = numericAmount;
    expense.paidBy = payerId;
    expense.splitType = type;
    expense.splits = finalSplits;
    expense.category = (category || 'General').trim();
    if (date) {
      expense.date = new Date(date);
    }

    await expense.save();

    const populated = await Expense.findById(expense._id)
      .populate('paidBy', 'name email')
      .populate('splits.user', 'name email');

    group.updatedAt = new Date();
    await group.save();

    res.json({
      expense: {
        id: populated._id,
        description: populated.description,
        amount: populated.amount,
        category: populated.category,
        splitType: populated.splitType,
        date: populated.date,
        paidBy: {
          id: populated.paidBy ? populated.paidBy._id : null,
          name: populated.paidBy ? populated.paidBy.name : null,
          email: populated.paidBy ? populated.paidBy.email : null,
        },
        splits: populated.splits.map((s) => ({
          user: {
            id: s.user ? s.user._id : null,
            name: s.user ? s.user.name : null,
            email: s.user ? s.user.email : null,
          },
          share: s.share,
        })),
      }
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Failed to edit expense' });
  }
});

module.exports = router;