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

    let expenses = await Expense.find({ group: req.params.groupId })
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
          email: e.paidBy.email,
        },

        splits: e.splits.map((s) => ({

          user: {
            id: s.user._id,
            name: s.user.name,
            email: s.user.email
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
      !description ||
      amount == null
    ) {

      return res.status(400).json({
        message:
          'groupId, description, and amount are required'
      });

    }


    const numericAmount =
      Number(amount);


    if (
      Number.isNaN(numericAmount) ||
      numericAmount <= 0
    ) {

      return res.status(400).json({
        message:
          'Amount must be a positive number'
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


      for (
        const id of participantIds
      ) {

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


      const base =
        Math.floor(
          (numericAmount * 100) / n
        ) / 100;


      let remainder =
        Math.round(
          (numericAmount - base * n) * 100
        ) / 100;


      finalSplits =
        participantIds.map(
          (id, idx) => {

            let share = base;


            if (remainder > 0) {

              share =
                Math.round(
                  (share + 0.01) * 100
                ) / 100;


              remainder =
                Math.round(
                  (remainder - 0.01) * 100
                ) / 100;

            }


            return {
              user: id,
              share
            };

          }
        );

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
            Number(s.share),

        }));


      for (
        const s of finalSplits
      ) {

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


        if (
          Number.isNaN(s.share) ||
          s.share < 0
        ) {

          return res.status(400).json({
            message:
              'Invalid share amount'
          });

        }

      }


      const total =
        finalSplits.reduce(
          (sum, s) =>
            sum + s.share,
          0
        );


      if (
        Math.abs(
          total - numericAmount
        ) > 0.02
      ) {

        return res.status(400).json({

          message:
            `Split shares (₹${total.toFixed(2)}) must equal expense amount (₹${numericAmount.toFixed(2)})`

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
    const isPayer = expense.paidBy.equals(req.user._id);
    const isCreator = group && group.createdBy.equals(req.user._id);

    if (!isPayer && !isCreator) {
      return res.status(403).json({ message: 'Only the payer or group creator can delete this expense' });
    }

    await expense.deleteOne();
    res.json({ message: 'Expense deleted' });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'Server Error' });
  }
});


module.exports = router;