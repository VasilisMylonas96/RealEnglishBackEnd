const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/notifications
 * Authenticated. Returns the current user's notifications, newest first.
 * Query: ?limit=50&unreadOnly=true
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    const unreadOnly = req.query.unreadOnly === 'true';
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user.id,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const unreadCount = await prisma.notification.count({
      where: { userId: req.user.id, isRead: false },
    });
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('Notifications list error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

/**
 * POST /api/notifications/:id/read
 * Authenticated (owner only). Marks a single notification as read.
 */
router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: req.params.id },
    });
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    if (notification.userId !== req.user.id) {
      return res.status(403).json({ error: 'You can only read your own notifications' });
    }
    await prisma.notification.update({
      where: { id: notification.id },
      data: { isRead: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Notification read error:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

/**
 * POST /api/notifications/read-all
 * Authenticated. Marks all of the user's notifications as read.
 */
router.post('/read-all', requireAuth, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Notifications read-all error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
