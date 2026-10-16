// src/services/notificationService.js
// The ONE way to tell a user something. Saves the in-app notification (the bell)
// and, when the catalog or the caller says so, sends the email too.
// Everything here is best effort and NEVER throws, so it is safe to call from any controller.
//
//   notify(userId, { type, data })                  one person
//   notifyMany([userIds], { type, data })           several people
//   notifyProjectParties(project, { type, data })   the client AND the freelancer of a project
//   notifyAdmins({ type, data })                    every active admin
//
// type + data -> title, message, link, colour, email: all come from utils/notificationCatalog.js.
// You may still pass title / message / link / actionLabel / severity / email yourself to override.
const Notification = require('../models/notification');
const User = require('../models/User');
const { NOTIFICATION_CATALOG } = require('../utils/notificationCatalog');
const mail = require('./emailService');

// Types that have a dedicated email layout in emailService.js (all others use the generic one)
const SPECIAL_EMAIL = {
  meeting_invite:     (u, n, d) => mail.sendMeetingInviteEmail({ to: u.email, name: u.name, inviterName: d.inviterName, projectTitle: d.projectTitle, joinPath: n.link }),
  account_suspended:  (u, n, d) => mail.sendAccountStatusEmail({ to: u.email, name: u.name, status: 'suspended', reason: d.reason }),
  account_removed:    (u, n, d) => mail.sendAccountStatusEmail({ to: u.email, name: u.name, status: 'removed', reason: d.reason }),
  account_reinstated: (u, n)    => mail.sendAccountStatusEmail({ to: u.email, name: u.name, status: 'reinstated' }),
  new_device_login:   (u, n, d) => mail.sendNewDeviceLoginEmail({ to: u.email, name: u.name, device: d.device, ip: d.ip }),
};

const idOf = (x) => (x ? String(x._id || x) : null);

async function notify(userId, opts = {}) {
  try {
    const { type, data = {} } = opts;
    const def = NOTIFICATION_CATALOG[type];
    if (!def) console.warn(`[Notify] Unknown type "${type}". Add it to utils/notificationCatalog.js`);

    // lean() so we can also read settings fields that may not be in the User schema yet
    const user = await User.findById(userId).select('email name role notificationSettings').lean();
    if (!user) return null;

    // The user switched this type off in notification settings (FR34.3). Mandatory types ignore that.
    if (def && !def.mandatory && user.notificationSettings?.disabledTypes?.includes(type)) return null;

    const built = def?.build ? def.build(data, { role: user.role, name: user.name }) : {};
    const n = {
      title:       opts.title       ?? built.title,
      message:     opts.message     ?? built.message,
      link:        opts.link        ?? built.link ?? undefined,
      actionLabel: opts.actionLabel ?? built.actionLabel,
      severity:    opts.severity    ?? built.severity ?? def?.severity ?? 'info',
    };

    const doc = await Notification.create({
      user: userId,
      type,
      category: def?.category,
      ...n,
      payload: opts.payload ?? (Object.keys(data).length ? data : undefined),
    });

    const wantEmail = opts.email ?? def?.email ?? false;
    if (wantEmail && user.email) {
      // Not awaited on purpose: the request must not wait for Gmail. These never throw.
      const special = SPECIAL_EMAIL[type];
      if (special) special(user, n, data);
      else mail.sendNotificationEmail({ to: user.email, name: user.name, title: n.title, message: n.message, link: n.link });
    }
    return doc;
  } catch (err) {
    console.error('[Notify]', err.message);
    return null;
  }
}

// Same notification to several people (duplicates and empty ids are ignored)
async function notifyMany(userIds = [], opts = {}) {
  const unique = [...new Set(userIds.map(idOf).filter(Boolean))];
  return Promise.all(unique.map((id) => notify(id, opts)));
}

// Both people on a project. exclude = the person who caused the event (they do not need to be told).
// project may be a Mongoose doc or plain object; client/freelancer may be ids or populated users.
async function notifyProjectParties(project, opts = {}, { exclude } = {}) {
  const skip = idOf(exclude);
  const ids = [idOf(project?.client), idOf(project?.freelancer)].filter((id) => id && id !== skip);
  return notifyMany(ids, opts);
}

// Every active admin (admin alerts, review queues)
async function notifyAdmins(opts = {}) {
  try {
    const admins = await User.find({ role: 'admin', status: { $nin: ['suspended', 'removed'] } }).select('_id').lean();
    return notifyMany(admins.map((a) => a._id), opts);
  } catch (err) {
    console.error('[Notify:admins]', err.message);
    return [];
  }
}

module.exports = { notify, notifyMany, notifyProjectParties, notifyAdmins };