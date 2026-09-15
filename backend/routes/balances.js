const express = require('express');
const { protect } = require('../middleware/auth');
const { getGroupLedger, checkParticipation } = require('../utils/helpers');

const router = express.Router();

router.use(protect);

router.get('/:groupId', async (req, res) => {
  try {
    const { isActiveMember, isHistoricalParticipant } = await checkParticipation(req.user._id, req.params.groupId);

    if (!isHistoricalParticipant) {
      return res.status(403).json({ message: 'You are not a member of this group' });
    }

    const ledger = await getGroupLedger(req.params.groupId);

    let balances = ledger.balances;
    let settlements = ledger.settlements;
    let visibleTotalSpent = ledger.totalSpent;
    let visibleExpenseCount = ledger.expenses.length;

    if (!isActiveMember) {
      const uIdStr = req.user._id.toString();
      balances = balances.filter(b => b.userId === uIdStr);
      settlements = settlements.filter(s => s.from.id === uIdStr || s.to.id === uIdStr);

      const visibleExpenses = ledger.expenses.filter(e =>
        (e.paidBy && e.paidBy._id.toString() === uIdStr) ||
        (e.splits && e.splits.some(s => s.user && s.user._id.toString() === uIdStr))
      );

      visibleExpenseCount = visibleExpenses.length;
      visibleTotalSpent = visibleExpenses.reduce((sum, ex) => sum + Number(ex.amount), 0);
    }

    res.json({
      groupId: ledger.group._id,
      groupName: ledger.group.name,
      totalSpent: visibleTotalSpent,
      expenseCount: visibleExpenseCount,
      balances,
      settlements,
    });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ message: err.message || 'Failed to compute balances' });
  }
});

module.exports = router;
