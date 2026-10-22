const express = require('express');
const mongoose = require('mongoose');
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

module.exports = router;
