function signToken(userId) {
  const jwt = require('jsonwebtoken');
  const crypto = require('crypto');
  return jwt.sign({ id: userId, sessionId: crypto.randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/**
 * Authoritative ledger calculation using exact integer paise arithmetic.
 * Accounting rule:
 * net = expense amounts paid − allocated expense shares
 *       + confirmed settlements sent − confirmed settlements received.
 *
 * Positive = member should receive money (creditor)
 * Negative = member owes money (debtor)
 * Net group balance sums identically to zero.
 */
function calculateLedger({ expenses = [], payments = [], members = [], nameMap = {} }) {
  const netPaise = {};
  const pairwiseNetPaise = {};

  const getPairKey = (id1, id2) => (id1 < id2 ? `${id1}:${id2}` : `${id2}:${id1}`);

  const addDirectDebt = (debtorId, creditorId, amountPaise) => {
    if (!debtorId || !creditorId || debtorId === creditorId || amountPaise === 0) return;
    const key = getPairKey(debtorId, creditorId);
    if (pairwiseNetPaise[key] === undefined) pairwiseNetPaise[key] = 0;
    if (debtorId < creditorId) {
      pairwiseNetPaise[key] += amountPaise;
    } else {
      pairwiseNetPaise[key] -= amountPaise;
    }
  };

  members.forEach((m) => {
    const id = (m._id || m.id || m).toString();
    netPaise[id] = 0;
  });

  let totalSpentPaise = 0;

  for (const ex of expenses) {
    const expenseAmountPaise = Math.round(Number(ex.amount || 0) * 100);
    totalSpentPaise += expenseAmountPaise;

    const payerId = ex.paidBy ? (ex.paidBy._id || ex.paidBy.id || ex.paidBy).toString() : null;
    if (payerId) {
      if (netPaise[payerId] === undefined) netPaise[payerId] = 0;
      netPaise[payerId] += expenseAmountPaise;
    }

    if (!Array.isArray(ex.splits) || ex.splits.length === 0) {
      if (expenseAmountPaise > 0) {
        throw new Error(
          `Data integrity error: Expense "${ex.description || ex._id || 'unknown'}" has no split allocations`
        );
      }
      continue;
    }

    const splitSharesPaise = ex.splits.map((s) => Math.round(Number(s.share || 0) * 100));
    const totalSplitPaise = splitSharesPaise.reduce((acc, p) => acc + p, 0);

    const diff = expenseAmountPaise - totalSplitPaise;
    if (diff !== 0) {
      // Reconcile ONLY identifiable legacy rounding discrepancies.
      // Identifiable if:
      // 1. Explicitly equal split or legacy record without splitType where non-zero shares are virtually identical (difference <= 1 paisa)
      // 2. Discrepancy is strictly within the mathematical bound of equal integer division (|diff| < activeCount)
      const activeSplits = ex.splits.filter((s) => Number(s.share || 0) > 0);
      const activeCount = activeSplits.length;
      const rawShares = activeSplits.map((s) => Number(s.share || 0));
      const maxShare = rawShares.length > 0 ? Math.max(...rawShares) : 0;
      const minShare = rawShares.length > 0 ? Math.min(...rawShares) : 0;
      const sharesVirtuallyEqual = (maxShare - minShare) <= 0.01 + 1e-9;
      const isLegacyEqual = (ex.splitType === 'equal' || !ex.splitType) && sharesVirtuallyEqual;

      if (isLegacyEqual && activeCount > 0 && Math.abs(diff) < activeCount) {
        const step = diff > 0 ? 1 : -1;
        let count = Math.abs(diff);
        for (let i = 0; i < ex.splits.length && count > 0; i++) {
          // Distribute 1 paisa only to active participants with positive share, never producing negative share
          if (splitSharesPaise[i] > 0 && splitSharesPaise[i] + step >= 0) {
            splitSharesPaise[i] += step;
            count--;
          }
        }
        if (count > 0) {
          throw new Error(
            `Data integrity error: Expense "${ex.description || ex._id || 'unknown'}" has unreconcilable allocations (allocated ₹${(totalSplitPaise / 100).toFixed(2)} of ₹${(expenseAmountPaise / 100).toFixed(2)})`
          );
        }
      } else {
        // Materially inconsistent, arbitrary discrepancy, or invalid custom split
        throw new Error(
          `Data integrity error: Expense "${ex.description || ex._id || 'unknown'}" has unreconcilable allocations (allocated ₹${(totalSplitPaise / 100).toFixed(2)} of ₹${(expenseAmountPaise / 100).toFixed(2)})`
        );
      }
    }

    for (let i = 0; i < ex.splits.length; i++) {
      const s = ex.splits[i];
      const splitUserId = s.user ? (s.user._id || s.user.id || s.user).toString() : null;
      const sharePaise = splitSharesPaise[i];
      if (splitUserId) {
        if (netPaise[splitUserId] === undefined) netPaise[splitUserId] = 0;
        netPaise[splitUserId] -= sharePaise;

        // Direct debt: non-payer participant owes payer their share (payer owes self creates no debt)
        if (payerId && splitUserId !== payerId && sharePaise > 0) {
          addDirectDebt(splitUserId, payerId, sharePaise);
        }
      }
    }
  }

  for (const p of payments) {
    const status = p.status;
    if (status !== 'paid' && status !== 'recipient_confirmed') {
      continue;
    }

    const fromId = p.from ? (p.from._id || p.from.id || p.from).toString() : null;
    const toId = p.to ? (p.to._id || p.to.id || p.to).toString() : null;
    const amtPaise = Math.round(Number(p.amount || 0) * 100);

    if (fromId && toId && fromId !== toId && amtPaise > 0) {
      if (netPaise[fromId] === undefined) netPaise[fromId] = 0;
      if (netPaise[toId] === undefined) netPaise[toId] = 0;

      netPaise[fromId] += amtPaise;
      netPaise[toId] -= amtPaise;

      // Confirmed settlement: fromId pays toId, reducing direct debt from fromId to toId
      addDirectDebt(fromId, toId, -amtPaise);
    }
  }

  const balances = Object.entries(netPaise).map(([userId, paise]) => ({
    userId,
    name: nameMap[userId] || 'Unknown',
    net: paise / 100,
  }));

  // Direct pairwise settlements
  const settlements = [];

  for (const [key, netPaiseValue] of Object.entries(pairwiseNetPaise)) {
    if (netPaiseValue === 0) continue;
    const [u1, u2] = key.split(':');

    if (netPaiseValue > 0) {
      // u1 owes u2
      settlements.push({
        from: { id: u1, userId: u1, name: nameMap[u1] || 'Unknown' },
        to: { id: u2, userId: u2, name: nameMap[u2] || 'Unknown' },
        amount: netPaiseValue / 100,
      });
    } else {
      // u2 owes u1
      settlements.push({
        from: { id: u2, userId: u2, name: nameMap[u2] || 'Unknown' },
        to: { id: u1, userId: u1, name: nameMap[u1] || 'Unknown' },
        amount: (-netPaiseValue) / 100,
      });
    }
  }

  // Sort settlements deterministically: amount desc, from.id asc, to.id asc
  settlements.sort((a, b) => {
    if (Math.round(b.amount * 100) !== Math.round(a.amount * 100)) {
      return Math.round(b.amount * 100) - Math.round(a.amount * 100);
    }
    if (a.from.id !== b.from.id) return a.from.id.localeCompare(b.from.id);
    return a.to.id.localeCompare(b.to.id);
  });

  return { balances, settlements, totalSpent: totalSpentPaise / 100 };
}

/**
 * Compute net balances from expenses and optional payments.
 * Authorized wrapper around calculateLedger.
 */
function computeBalances(expenses, members, payments = []) {
  const nameMap = {};
  members.forEach((m) => {
    const id = (m._id || m.id || m).toString();
    if (m.name) nameMap[id] = m.name;
  });
  expenses.forEach((ex) => {
    if (ex.paidBy && ex.paidBy.name) {
      nameMap[(ex.paidBy._id || ex.paidBy.id || ex.paidBy).toString()] = ex.paidBy.name;
    }
    if (Array.isArray(ex.splits)) {
      ex.splits.forEach((s) => {
        if (s.user && s.user.name) {
          nameMap[(s.user._id || s.user.id || s.user).toString()] = s.user.name;
        }
      });
    }
  });

  return calculateLedger({ expenses, payments, members, nameMap });
}

module.exports = { signToken, computeBalances, getGroupLedger, checkParticipation, calculateLedger };

async function getGroupLedger(groupId) {
  const Group = require('../models/Group');
  const Expense = require('../models/Expense');
  const Payment = require('../models/payment');

  const group = await Group.findById(groupId).populate('members', 'name email');
  if (!group) throw new Error('Group not found');

  const expenses = await Expense.find({ group: groupId })
    .populate('paidBy', 'name')
    .populate('splits.user', 'name');

  const payments = await Payment.find({ group: groupId, status: { $in: ['paid', 'recipient_confirmed'] } })
    .populate('from to');

  // Build a name dictionary fixing the departed member "Unknown" issue
  const nameMap = {};
  group.members.forEach((m) => {
    nameMap[m._id.toString()] = m.name;
  });
  expenses.forEach((ex) => {
    if (ex.paidBy) nameMap[(ex.paidBy._id || ex.paidBy).toString()] = ex.paidBy.name || 'Unknown';
    if (ex.splits) {
      ex.splits.forEach((s) => {
        if (s.user) nameMap[(s.user._id || s.user).toString()] = s.user.name || 'Unknown';
      });
    }
  });
  payments.forEach((p) => {
    if (p.from) nameMap[(p.from._id || p.from).toString()] = p.from.name || 'Unknown';
    if (p.to) nameMap[(p.to._id || p.to).toString()] = p.to.name || 'Unknown';
  });

  const { balances, settlements, totalSpent } = calculateLedger({
    expenses,
    payments,
    members: group.members,
    nameMap,
  });

  return { group, expenses, payments, balances, settlements, totalSpent, nameMap };
}

async function checkParticipation(userId, groupId) {
  const Group = require('../models/Group');
  const Expense = require('../models/Expense');
  const Payment = require('../models/payment');

  const group = await Group.findById(groupId);
  if (!group) return { isActiveMember: false, isHistoricalParticipant: false };

  const uIdStr = userId.toString();
  const isActiveMember = group.members.some(m => m.toString() === uIdStr);

  if (isActiveMember) {
    return { isActiveMember, isHistoricalParticipant: true };
  }

  const hasExpense = await Expense.exists({
    group: groupId,
    $or: [{ paidBy: userId }, { 'splits.user': userId }]
  });
  if (hasExpense) {
    return { isActiveMember, isHistoricalParticipant: true };
  }

  const hasPayment = await Payment.exists({
    group: groupId,
    status: { $in: ['paid', 'recipient_confirmed'] },
    $or: [{ from: userId }, { to: userId }]
  });
  if (hasPayment) {
    return { isActiveMember, isHistoricalParticipant: true };
  }

  return { isActiveMember, isHistoricalParticipant: false };
}
