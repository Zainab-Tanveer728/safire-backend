// src/models/Notification.js
// One document = one message in a user's notification bell / notifications page (M34).
// The allowed types, categories and colours all come from utils/notificationCatalog.js,
// so to add a new kind of notification you only edit the catalog.
const mongoose = require('mongoose');
const { NOTIFICATION_TYPES, CATEGORIES, SEVERITIES } = require('../utils/notificationCatalog');

const notificationSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // who receives it
  type:        { type: String, required: true, enum: NOTIFICATION_TYPES },
  category:    { type: String, enum: CATEGORIES },                                      // for filtering / icons
  severity:    { type: String, enum: SEVERITIES, default: 'info' },                      // info | success | warning | action_required
  title:       { type: String, required: true },
  message:     { type: String },
  link:        { type: String },                        // frontend path, e.g. /freelancer/project/<id>
  actionLabel: { type: String },                        // button text, e.g. "View Job", "Review Job"
  payload:     { type: mongoose.Schema.Types.Mixed },   // ids for this event, e.g. { projectId, transcriptId }
  read:        { type: Boolean, default: false },
  readAt:      { type: Date },
}, { timestamps: true });

// "my unread count" and "my newest notifications"
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
// category filter on the notifications page
notificationSchema.index({ user: 1, category: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;