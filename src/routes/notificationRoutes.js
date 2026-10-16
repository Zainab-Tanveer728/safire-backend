// src/routes/notificationRoutes.js   (mounted at /api/notifications)
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const c = require('../controllers/notificationController');

router.use(protect);
router.get('/',             c.listMine);
router.get('/unread-count', c.unreadCount);
router.get('/settings',     c.getSettings);
router.put('/settings',     c.updateSettings);
router.patch('/read-all',   c.markAllRead);   // keep BEFORE '/:id/read'
router.patch('/:id/read',   c.markRead);

module.exports = router;