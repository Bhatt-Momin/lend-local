/**
 * debtReminderService.js — Automated Debt Reminder Service for LendLocal
 *
 * Scans active pairwise group settlements and notifies users when an amount they owe
 * remains unsettled for approximately 30 days (configurable).
 *
 * Correctness & Security:
 * - Uses exact integer paise pairwise debts calculated by calculateLedger.
 * - Determines debt age from actual contributing expense timestamps.
 * - Enforces database-backed durable deduplication (dedupeKey) to prevent duplicate reminders across runs.
 * - In-memory job lock prevents overlapping executions.
 * - Integrates with existing in-app Notification model and Firebase Cloud Messaging pipeline.
 */

const Group = require('../models/Group');
const Expense = require('../models/Expense');
const Notification = require('../models/Notification');
const { getGroupLedger } = require('../utils/helpers');
const { createNotification } = require('./notificationService');

let isJobRunning = false;

/**
 * Finds all unsettled pairwise debts older than thresholdDays.
 *
 * @param {Object} [options]
 * @param {number} [options.thresholdDays=30] - Minimum age of unsettled debt in days
 * @param {Date} [options.asOfDate=new Date()] - Reference date for age computation
 * @returns {Promise<Array>} List of eligible reminder candidates
 */
async function findOutstandingDebts({ thresholdDays = 30, asOfDate = new Date() } = {}) {
  const groups = await Group.find({}).select('_id name members');
  const candidates = [];

  for (const group of groups) {
    let ledger;
    try {
      ledger = await getGroupLedger(group._id);
    } catch (err) {
      console.warn(`Failed to compute ledger for group ${group._id} during debt check:`, err.message);
      continue;
    }

    const { settlements, expenses } = ledger;
    if (!Array.isArray(settlements) || settlements.length === 0) continue;

    for (const settlement of settlements) {
      const debtAmount = Number(settlement.amount || 0);
      if (debtAmount <= 0) continue;

      const debtorId = settlement.from?.id || settlement.from?.userId;
      const creditorId = settlement.to?.id || settlement.to?.userId;
      if (!debtorId || !creditorId) continue;

      // Find the earliest contributing expense in this group where creditor paid and debtor had a positive share
      const contributingExpenses = expenses.filter((ex) => {
        const payerId = ex.paidBy ? (ex.paidBy._id || ex.paidBy.id || ex.paidBy).toString() : null;
        if (payerId !== creditorId) return false;

        if (!Array.isArray(ex.splits)) return false;
        return ex.splits.some((s) => {
          const sId = (s.user?._id || s.user?.id || s.user)?.toString();
          return sId === debtorId && Number(s.share || 0) > 0;
        });
      });

      if (contributingExpenses.length === 0) continue;

      // Sort by date ascending to find the earliest unpaid expense
      contributingExpenses.sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
      const earliestExpense = contributingExpenses[0];
      const earliestDate = new Date(earliestExpense.date || earliestExpense.createdAt);

      const ageMs = asOfDate.getTime() - earliestDate.getTime();
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

      if (ageDays >= thresholdDays) {
        const cycleIndex = Math.floor(ageDays / thresholdDays);
        const dedupeKey = `debt_reminder:${debtorId}:${creditorId}:${group._id}:${cycleIndex}`;

        candidates.push({
          debtorId,
          debtorName: settlement.from?.name || 'Friend',
          creditorId,
          creditorName: settlement.to?.name || 'Friend',
          groupId: group._id,
          groupName: group.name,
          amount: debtAmount,
          ageDays,
          cycleIndex,
          dedupeKey,
          earliestExpenseDate: earliestDate,
        });
      }
    }
  }

  return candidates;
}

/**
 * Runs the debt reminder job.
 * Dispatches notifications and FCM pushes with durable idempotency.
 *
 * @param {Object} [options]
 * @param {number} [options.thresholdDays=30]
 * @param {Date} [options.asOfDate=new Date()]
 * @returns {Promise<Object>} Execution summary
 */
async function sendDebtReminders({ thresholdDays = 30, asOfDate = new Date() } = {}) {
  if (isJobRunning) {
    console.log('[DebtReminderService] Job already running. Skipping overlapping run.');
    return { skipped: true, reason: 'Job already in progress' };
  }

  isJobRunning = true;
  const results = {
    found: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    errors: [],
  };

  try {
    const candidates = await findOutstandingDebts({ thresholdDays, asOfDate });
    results.found = candidates.length;

    for (const candidate of candidates) {
      try {
        // Database deduplication check
        const existing = await Notification.findOne({
          recipient: candidate.debtorId,
          dedupeKey: candidate.dedupeKey,
        });

        if (existing) {
          results.alreadySent++;
          continue;
        }

        const notificationResult = await createNotification({
          recipient: candidate.debtorId,
          sender: candidate.creditorId,
          type: 'debt_reminder',
          title: `Friendly reminder: unsettled balance in ${candidate.groupName}`,
          body: `You have an unsettled balance of ₹${candidate.amount.toFixed(2)} with ${candidate.creditorName} in ${candidate.groupName} from ${candidate.ageDays} days ago.`,
          data: {
            groupId: candidate.groupId.toString(),
            type: 'debt_reminder',
            amount: candidate.amount,
          },
          dedupeKey: candidate.dedupeKey,
          sendPush: true,
        });

        if (notificationResult && notificationResult.created !== false) {
          results.sent++;
        } else {
          results.alreadySent++;
        }
      } catch (itemErr) {
        results.failed++;
        results.errors.push({
          debtorId: candidate.debtorId,
          groupId: candidate.groupId,
          error: itemErr.message,
        });
      }
    }

    console.log(`[DebtReminderService] Completed run: ${results.sent} sent, ${results.alreadySent} skipped (deduped), ${results.failed} failed.`);
    return results;
  } finally {
    isJobRunning = false;
  }
}

module.exports = {
  findOutstandingDebts,
  sendDebtReminders,
  __setIsJobRunning: (val) => { isJobRunning = val; },
  __getIsJobRunning: () => isJobRunning,
};
