const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

const router = express.Router();

/* =====================================================
   GET NOTIFICATIONS (INBOX)
   Scoped strictly to authenticated user (req.user._id)
===================================================== */
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const limitParam = parseInt(req.query.limit, 10);
    const limit = !isNaN(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30;
    const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === '1';

    const filter = { recipient: userId };
    if (unreadOnly) {
      filter.isRead = false;
    }

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('sender', 'name email')
        .lean(),
      Notification.countDocuments({ recipient: userId, isRead: false }),
    ]);

    // Format output with sanitized IDs
    const formatted = notifications.map((n) => ({
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data || {},
      sender: n.sender
        ? {
            id: n.sender._id.toString(),
            name: n.sender.name,
          }
        : null,
      isRead: Boolean(n.isRead),
      readAt: n.readAt,
      createdAt: n.createdAt,
    }));

    res.json({
      notifications: formatted,
      unreadCount,
    });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    res.status(500).json({
      message: err.message || 'Failed to fetch notifications',
    });
  }
});

/* =====================================================
   MARK SINGLE NOTIFICATION AS READ
   Enforces recipient ownership
===================================================== */
router.patch('/:id/read', protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }

    const notification = await Notification.findOne({
      _id: id,
      recipient: req.user._id, // Enforce recipient ownership
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();
    }

    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      isRead: false,
    });

    res.json({
      message: 'Notification marked as read',
      notification: {
        id: notification._id.toString(),
        isRead: true,
        readAt: notification.readAt,
      },
      unreadCount,
    });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({
      message: err.message || 'Failed to update notification',
    });
  }
});

/* =====================================================
   MARK ALL NOTIFICATIONS AS READ
   Scoped strictly to authenticated user
===================================================== */
router.patch('/read-all', protect, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user._id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }
    );

    res.json({
      message: 'All notifications marked as read',
      modifiedCount: result.modifiedCount || 0,
      unreadCount: 0,
    });
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({
      message: err.message || 'Failed to mark all notifications as read',
    });
  }
});

/* =====================================================
   TRIGGER DEBT REMINDERS (PROTECTED EXTERNAL / CRON RUNNER)
===================================================== */

/**
 * Middleware: Verifies the internal scheduler secret header.
 * - Required header: X-Scheduler-Secret
 * - Secret env var: INTERNAL_SCHEDULER_SECRET
 * - Fails closed: Rejects immediately if INTERNAL_SCHEDULER_SECRET is not configured.
 * - Compares using timing-safe buffer comparison to prevent timing side-channels.
 * - Never leaks secret value in error messages or logs.
 */
function requireSchedulerSecret(req, res, next) {
  const configuredSecret = (process.env.INTERNAL_SCHEDULER_SECRET || '').trim();

  // Fail closed if the secret is not configured
  if (!configuredSecret) {
    console.error('[Scheduler] Trigger attempted but INTERNAL_SCHEDULER_SECRET is not configured on this server');
    return res.status(503).json({ message: 'Internal scheduler secret is not configured on this server' });
  }

  const providedSecret = (req.headers['x-scheduler-secret'] || '').toString().trim();
  if (!providedSecret) {
    return res.status(401).json({ message: 'Unauthorized: Missing required X-Scheduler-Secret header' });
  }

  const expectedBuf = Buffer.from(configuredSecret, 'utf8');
  const providedBuf = Buffer.from(providedSecret, 'utf8');

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(401).json({ message: 'Unauthorized: Invalid scheduler secret' });
  }

  next();
}

router.post('/reminders/run', requireSchedulerSecret, async (req, res) => {
  try {
    const debtReminderService = require('../services/debtReminderService');
    const thresholdDays = parseInt(req.body.thresholdDays, 10) || 30;
    const result = await debtReminderService.sendDebtReminders({ thresholdDays });
    res.json(result);
  } catch (err) {
    console.error('Trigger debt reminders error:', err.message);
    res.status(500).json({ message: err.message || 'Failed to run debt reminders' });
  }
});

router.requireSchedulerSecret = requireSchedulerSecret;

module.exports = router;
