// src/controllers/notificationController.js  (M34 Notifications page + the bell)
const mongoose = require('mongoose');
const Notification = require('../models/notification');
const User = require('../models/User');
const { CATEGORIES, NOTIFICATION_CATALOG, settingsList } = require('../utils/notificationCatalog');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/notifications?page=1&limit=20&unread=true&category=meeting&q=transcript
// -> my notifications (newest first), with unread count. Only ever MY notifications (FR34.4).
exports.listMine = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { user: req.user._id };
    if (req.query.unread === 'true') filter.read = false;
    if (CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
    if (req.query.q && String(req.query.q).trim()) {
      const rx = new RegExp(escapeRegex(String(req.query.q).trim().slice(0, 80)), 'i');
      filter.$or = [{ title: rx }, { message: rx }];
    }

    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user._id, read: false }),
    ]);

    res.json({ notifications: items, unreadCount, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Notifications:list]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/notifications/unread-count  -> tiny response, cheap for the bell to poll
exports.unreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false });
    res.json({ unreadCount });
  } catch (err) {
    console.error('[Notifications:count]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/notifications/:id/read  -> mark one as read (only my own)
exports.markRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: 'Invalid id.' });
    // read:false in the filter keeps the ORIGINAL readAt if it was already read
    await Notification.updateOne(
      { _id: req.params.id, user: req.user._id, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    console.error('[Notifications:read]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/notifications/read-all  -> mark all of mine as read (FR34.2)
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.json({ message: 'All marked as read.' });
  } catch (err) {
    console.error('[Notifications:readAll]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/notifications/settings -> which types the user can switch off, and which ones they did (FR34.3)
exports.getSettings = async (req, res) => {
  try {
    const u = await User.findById(req.user._id).select('notificationSettings').lean();
    res.json({
      disabledTypes: u?.notificationSettings?.disabledTypes || [],
      types: settingsList(),   // [{ type, label, category }]  (mandatory types are not listed)
    });
  } catch (err) {
    console.error('[Notifications:settings]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/notifications/settings   body: { disabledTypes: ['job_match', ...] }
exports.updateSettings = async (req, res) => {
  try {
    const wanted = Array.isArray(req.body.disabledTypes) ? req.body.disabledTypes : null;
    if (!wanted) return res.status(400).json({ message: 'disabledTypes must be an array.' });

    // Only known types that are allowed to be switched off (security / account types cannot be)
    const disabledTypes = [...new Set(wanted)].filter(
      (t) => NOTIFICATION_CATALOG[t] && !NOTIFICATION_CATALOG[t].mandatory
    );

    // strict:false so this works even before notificationSettings is added to the User schema
    await User.updateOne(
      { _id: req.user._id },
      { $set: { 'notificationSettings.disabledTypes': disabledTypes } },
      { strict: false }
    );
    res.json({ message: 'Notification settings saved.', disabledTypes });
  } catch (err) {
    console.error('[Notifications:saveSettings]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};