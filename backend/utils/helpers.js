function signToken(userId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

/**
 * Compute net balances from expenses.
 * Positive = others owe this person; negative = this person owes others.
 * Also simplifies into pairwise settlements (who owes whom).
 */
function computeBalances(expenses, members) {
  const net = {};
  members.forEach((m) => {
    const id = m._id ? m._id.toString() : m.toString();
    net[id] = 0;
  });

  for (const expense of expenses) {
    const payerId = expense.paidBy._id
      ? expense.paidBy._id.toString()
      : expense.paidBy.toString();

    if (net[payerId] === undefined) net[payerId] = 0;
    net[payerId] += expense.amount;

    for (const split of expense.splits) {
      const uid = split.user._id ? split.user._id.toString() : split.user.toString();
      if (net[uid] === undefined) net[uid] = 0;
      net[uid] -= split.share;
    }
  }

  // Round to 2 decimals to avoid float noise
  Object.keys(net).forEach((k) => {
    net[k] = Math.round(net[k] * 100) / 100;
  });

  const nameOf = (id) => {
    const m = members.find((x) => (x._id ? x._id.toString() : x.toString()) === id);
    return m && m.name ? m.name : 'Unknown';
  };

  const balances = Object.entries(net).map(([userId, amount]) => ({
    userId,
    name: nameOf(userId),
    net: amount,
  }));

  // Greedy pairwise settlement
  const creditors = balances
    .filter((b) => b.net > 0.009)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net);
  const debtors = balances
    .filter((b) => b.net < -0.009)
    .map((b) => ({ ...b, net: -b.net }))
    .sort((a, b) => b.net - a.net);

  const settlements = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].net, creditors[j].net);
    const amount = Math.round(pay * 100) / 100;
    if (amount > 0) {
      settlements.push({
        from: { userId: debtors[i].userId, name: debtors[i].name },
        to: { userId: creditors[j].userId, name: creditors[j].name },
        amount,
      });
    }
    debtors[i].net = Math.round((debtors[i].net - pay) * 100) / 100;
    creditors[j].net = Math.round((creditors[j].net - pay) * 100) / 100;
    if (debtors[i].net < 0.01) i += 1;
    if (creditors[j].net < 0.01) j += 1;
  }

  return { balances, settlements };
}

module.exports = { signToken, computeBalances, getGroupLedger, checkParticipation };

async function getGroupLedger(groupId) {
  const Group = require('../models/Group');
  const Expense = require('../models/Expense');
  const Payment = require('../models/payment');

  const group = await Group.findById(groupId).populate('members', 'name email');
  if (!group) throw new Error('Group not found');

  const expenses = await Expense.find({ group: groupId })
    .populate('paidBy', 'name')
    .populate('splits.user', 'name');

  const payments = await Payment.find({ group: groupId, status: 'paid' })
    .populate('from to');

  // Build a name dictionary fixing the departed member "Unknown" issue
  const nameMap = {};
  group.members.forEach((m) => {
    nameMap[m._id.toString()] = m.name;
  });
  expenses.forEach((ex) => {
    if (ex.paidBy) nameMap[ex.paidBy._id.toString()] = ex.paidBy.name;
    if (ex.splits) {
      ex.splits.forEach((s) => {
        if (s.user) nameMap[s.user._id.toString()] = s.user.name;
      });
    }
  });
  payments.forEach((p) => {
    if (p.from) nameMap[p.from._id.toString()] = p.from.name;
    if (p.to) nameMap[p.to._id.toString()] = p.to.name;
  });

  const net = {};

  group.members.forEach((m) => {
    const id = m._id.toString();
    net[id] = 0;
  });

  expenses.forEach((ex) => {
    const pId = ex.paidBy._id.toString();
    if (net[pId] === undefined) net[pId] = 0;
    net[pId] += ex.amount;

    ex.splits.forEach((s) => {
      const sId = s.user._id.toString();
      if (net[sId] === undefined) net[sId] = 0;
      net[sId] -= s.share;
    });
  });

  payments.forEach((p) => {
    const fId = p.from._id.toString();
    const tId = p.to._id.toString();
    const amt = p.amount;

    if (net[fId] !== undefined) net[fId] = Math.round((net[fId] + amt) * 100) / 100;
    if (net[tId] !== undefined) net[tId] = Math.round((net[tId] - amt) * 100) / 100;
    if (net[fId] === undefined) net[fId] = 0;
    if (net[tId] === undefined) net[tId] = 0;

    net[fId] = Math.round((net[fId] + amt) * 100) / 100;
    net[tId] = Math.round((net[tId] - amt) * 100) / 100;
  });

  Object.keys(net).forEach((k) => {
    net[k] = Math.round(net[k] * 100) / 100;
  });

  const balances = Object.entries(net).map(([userId, amount]) => ({
    userId,
    name: nameMap[userId] || 'Unknown',
    net: amount,
  }));

  const debtors = balances
  .filter((b) => b.net < -0.009)
  .map((b) => ({
    ...b,
    remaining: Math.abs(b.net),
  }))
  .sort(
    (a, b) =>
      b.remaining -
      a.remaining
  );

const creditors = balances
  .filter((b) => b.net > 0.009)
  .map((b) => ({
    ...b,
    remaining: b.net,
  }))
  .sort(
    (a, b) =>
      b.remaining -
      a.remaining
  );

  const settlements = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);

    settlements.push({
      from: { id: debtor.userId, name: debtor.name },
      to: { id: creditor.userId, name: creditor.name },
      amount: Math.round(amount * 100) / 100,
    });

    debtor.remaining -= amount;
    creditor.remaining -= amount;

    if (debtor.remaining < 0.01) debtorIndex++;
    if (creditor.remaining < 0.01) creditorIndex++;
  }

  const totalSpent = expenses.reduce((sum, ex) => sum + Number(ex.amount), 0);

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
    $or: [{ from: userId }, { to: userId }]
  });
  if (hasPayment) {
    return { isActiveMember, isHistoricalParticipant: true };
  }

  return { isActiveMember, isHistoricalParticipant: false };
}
