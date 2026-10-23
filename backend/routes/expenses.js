const express = require('express');
const Expense = require('../models/Expense');
const Group = require('../models/Group');
const User = require('../models/User');
const Payment = require('../models/payment');
const { protect } = require('../middleware/auth');
const { createMulticastNotifications } = require('../services/notificationService');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('crypto');

const router = express.Router();

router.use(protect);

const { checkParticipation, getGroupLedger } = require('../utils/helpers');

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
// MONTHLY SPENDING ANALYTICS
// =====================================================

function computeUserSharePaise(expense, userIdStr) {
  if (!Array.isArray(expense.splits) || expense.splits.length === 0) return 0;
  const splitItem = expense.splits.find((s) => {
    const sId = (s.user?._id || s.user?.id || s.user)?.toString();
    return sId === userIdStr;
  });
  if (!splitItem) return 0;

  if (expense.splitType === 'custom') {
    return Math.round(Number(splitItem.share || 0) * 100);
  }

  const expensePaise = Math.round(Number(expense.amount || 0) * 100);
  const count = expense.splits.length;
  if (count === 0) return 0;
  const basePaise = Math.floor(expensePaise / count);
  const remPaise = expensePaise % count;
  const index = expense.splits.findIndex((s) => {
    const sId = (s.user?._id || s.user?.id || s.user)?.toString();
    return sId === userIdStr;
  });
  return basePaise + (index < remPaise ? 1 : 0);
}

router.get('/analytics/monthly', async (req, res) => {
  try {
    const now = new Date();
    const reqYear = parseInt(req.query.year, 10);
    const reqMonth = parseInt(req.query.month, 10);

    const year = Number.isInteger(reqYear) && reqYear >= 2000 && reqYear <= 2100 ? reqYear : now.getFullYear();
    const month = Number.isInteger(reqMonth) && reqMonth >= 1 && reqMonth <= 12 ? reqMonth : now.getMonth() + 1;

    // Selected month UTC boundary
    const startMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const endMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

    // Previous month UTC boundary
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const startPrevMonth = new Date(Date.UTC(prevYear, prevMonth - 1, 1, 0, 0, 0, 0));
    const endPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0));

    const userIdStr = req.user._id.toString();

    // Find all groups the user participates in
    const expenseGroupIds = await Expense.distinct('group', {
      $or: [{ paidBy: req.user._id }, { 'splits.user': req.user._id }]
    });
    const paymentGroupIds = await Payment.distinct('group', {
      $or: [{ from: req.user._id }, { to: req.user._id }]
    });
    const userGroups = await Group.find({
      $or: [
        { members: req.user._id },
        { _id: { $in: [...expenseGroupIds, ...paymentGroupIds] } }
      ]
    }).select('_id name members');

    const groupIds = userGroups.map((g) => g._id);
    const groupNameMap = {};
    userGroups.forEach((g) => {
      groupNameMap[g._id.toString()] = g.name;
    });

    // Query expenses for the selected month
    const expensesThisMonth = await Expense.find({
      group: { $in: groupIds },
      date: { $gte: startMonth, $lt: endMonth },
      $or: [
        { paidBy: req.user._id },
        { 'splits.user': req.user._id }
      ]
    })
      .populate('paidBy', 'name email')
      .sort({ date: -1, createdAt: -1 });

    // Query expenses for previous month comparison
    const expensesPrevMonth = await Expense.find({
      group: { $in: groupIds },
      date: { $gte: startPrevMonth, $lt: endPrevMonth },
      $or: [
        { paidBy: req.user._id },
        { 'splits.user': req.user._id }
      ]
    });

    // 1. Primary Metric: User's allocated share of group expenses in selected month
    let userSharePaise = 0;
    // 2. Secondary Metric: Total expenses personally paid by the user in selected month
    let userPaidPaise = 0;

    const categoryMap = {};
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dailyMap = {};
    for (let d = 1; d <= daysInMonth; d++) {
      dailyMap[d] = 0;
    }

    const recentExpenses = [];

    for (const ex of expensesThisMonth) {
      const sharePaise = computeUserSharePaise(ex, userIdStr);
      const isPayer = ex.paidBy && (ex.paidBy._id || ex.paidBy).toString() === userIdStr;

      if (isPayer) {
        userPaidPaise += Math.round(Number(ex.amount || 0) * 100);
      }

      if (sharePaise > 0) {
        userSharePaise += sharePaise;

        const cat = (ex.category || 'General').trim() || 'General';
        categoryMap[cat] = (categoryMap[cat] || 0) + sharePaise;

        const expDate = new Date(ex.date);
        const day = expDate.getUTCDate();
        if (dailyMap[day] !== undefined) {
          dailyMap[day] += sharePaise;
        }
      }

      if (recentExpenses.length < 10) {
        recentExpenses.push({
          id: ex._id,
          description: ex.description,
          groupName: groupNameMap[ex.group.toString()] || 'Group',
          category: ex.category || 'General',
          date: ex.date,
          totalAmount: ex.amount,
          userShare: sharePaise / 100,
          isPayer,
          paidByName: ex.paidBy?.name || 'Unknown',
        });
      }
    }

    // Previous month total user share
    let prevMonthSharePaise = 0;
    for (const ex of expensesPrevMonth) {
      prevMonthSharePaise += computeUserSharePaise(ex, userIdStr);
    }

    // Outstanding balances across groups (Metric 3 & Metric 4)
    let totalOwedToOthersPaise = 0;
    let totalOwedToUserPaise = 0;

    for (const g of userGroups) {
      const ledger = await getGroupLedger(g._id);
      const mine = ledger.balances.find((b) => b.userId === userIdStr);
      if (mine) {
        const netPaise = Math.round(mine.net * 100);
        if (netPaise < 0) {
          totalOwedToOthersPaise += Math.abs(netPaise);
        } else if (netPaise > 0) {
          totalOwedToUserPaise += netPaise;
        }
      }
    }

    // Categories array
    const categoryBreakdown = Object.entries(categoryMap)
      .map(([category, paise]) => ({
        category,
        amount: paise / 100,
        percentage: userSharePaise > 0 ? Math.round((paise / userSharePaise) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // Daily trend array
    const dailyTrend = Object.entries(dailyMap).map(([day, paise]) => ({
      day: parseInt(day, 10),
      amount: paise / 100,
    }));

    // Comparison calculation
    const diffPaise = userSharePaise - prevMonthSharePaise;
    let percentageChange = null;
    let trend = 'same';

    if (prevMonthSharePaise > 0) {
      percentageChange = Math.round((diffPaise / prevMonthSharePaise) * 100);
      if (percentageChange > 0) trend = 'up';
      else if (percentageChange < 0) trend = 'down';
    } else if (userSharePaise > 0) {
      trend = 'up';
    }

    res.json({
      year,
      month,
      primaryMetric: {
        label: 'Your Expense Share',
        amount: userSharePaise / 100,
        previousMonthAmount: prevMonthSharePaise / 100,
        difference: diffPaise / 100,
        percentageChange,
        trend,
      },
      secondaryMetrics: {
        personallyPaid: userPaidPaise / 100,
        netOwedToOthers: totalOwedToOthersPaise / 100,
        netOwedToUser: totalOwedToUserPaise / 100,
      },
      categoryBreakdown,
      dailyTrend,
      recentExpenses,
      expenseCount: expensesThisMonth.length,
    });
  } catch (err) {
    console.error('Monthly analytics error:', err);
    res.status(500).json({ message: err.message || 'Failed to load monthly analytics' });
  }
});


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
    // NOTIFICATION (IN-APP INBOX & PUSH)
    // =================================================

    try {
      const otherMemberIds = group.members
        .map((memberId) => memberId.toString())
        .filter((memberId) => memberId !== req.user._id.toString());

      if (otherMemberIds.length > 0) {
        const title = 'New expense added 💸';
        const body = `${populated.paidBy.name} added ₹${numericAmount.toFixed(2)} for ${populated.description}`;

        await createMulticastNotifications({
          recipients: otherMemberIds,
          sender: req.user._id,
          type: 'expense_added',
          title,
          body,
          data: {
            groupId: groupId.toString(),
            expenseId: populated._id.toString(),
            amount: numericAmount,
          },
          dedupePrefix: `expense:${populated._id.toString()}`,
          sendPush: true,
        });
      }
    } catch (notificationError) {
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


/**
 * Selects affected group members for an expense edit notification.
 * Includes previous and new participants (payer and split members) who are active group members,
 * strictly excluding the user who made the edit.
 *
 * @param {Object} expenseBefore - Previous expense state { paidBy, splits }
 * @param {Object} expenseAfter - Updated populated expense document
 * @param {Array} groupMembers - Array of group member ObjectIds/objects
 * @param {string|Object} editorUserId - The user who initiated the edit
 * @returns {string[]} Array of distinct recipient user ID strings
 */
function getAffectedExpenseMemberIds(expenseBefore, expenseAfter, groupMembers, editorUserId) {
  if (!editorUserId || !Array.isArray(groupMembers) || groupMembers.length === 0) {
    return [];
  }

  const editorStr = (editorUserId._id || editorUserId).toString();
  const groupMemberSet = new Set(
    groupMembers.map((m) => (m._id || m).toString())
  );
  const affectedSet = new Set();

  const maybeAdd = (userRef) => {
    if (!userRef) return;
    const idStr = (userRef._id || userRef).toString();
    if (idStr !== editorStr && groupMemberSet.has(idStr)) {
      affectedSet.add(idStr);
    }
  };

  // 1. Participants prior to edit (payer and split users)
  if (expenseBefore) {
    maybeAdd(expenseBefore.paidBy);
    if (Array.isArray(expenseBefore.splits)) {
      for (const s of expenseBefore.splits) {
        maybeAdd(s?.user);
      }
    }
  }

  // 2. Participants after edit (payer and split users)
  if (expenseAfter) {
    maybeAdd(expenseAfter.paidBy);
    if (Array.isArray(expenseAfter.splits)) {
      for (const s of expenseAfter.splits) {
        maybeAdd(s?.user);
      }
    }
  }

  return Array.from(affectedSet);
}

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

    // Capture previous participants before modifying expense document
    const oldPaidBy = expense.paidBy;
    const oldSplits = Array.isArray(expense.splits)
      ? expense.splits.map((s) => ({ user: s.user, share: s.share }))
      : [];

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

    // =================================================
    // NOTIFICATION (IN-APP INBOX & PUSH)
    // =================================================

    try {
      const affectedMemberIds = getAffectedExpenseMemberIds(
        { paidBy: oldPaidBy, splits: oldSplits },
        populated,
        group.members,
        req.user._id
      );

      if (affectedMemberIds.length > 0) {
        const title = 'Expense updated ✏️';
        const body = `${req.user.name || 'Someone'} updated ₹${numericAmount.toFixed(2)} for ${populated.description}`;
        const rawIdempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
        const idempotencyKey = typeof rawIdempotencyKey === 'string' && rawIdempotencyKey.trim() ? rawIdempotencyKey.trim() : null;
        const editVersion = idempotencyKey || (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));

        await createMulticastNotifications({
          recipients: affectedMemberIds,
          sender: req.user._id,
          type: 'expense_updated',
          title,
          body,
          data: {
            groupId: group._id.toString(),
            expenseId: populated._id.toString(),
            amount: numericAmount,
          },
          dedupePrefix: `expense_edit:${populated._id.toString()}:${editVersion}`,
          sendPush: true,
        });
      }
    } catch (notificationError) {
      console.error('Expense edit notification error (non-fatal):', notificationError);
    }

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
router.getAffectedExpenseMemberIds = getAffectedExpenseMemberIds;
