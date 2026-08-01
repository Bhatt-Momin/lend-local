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

module.exports = { signToken, computeBalances };
