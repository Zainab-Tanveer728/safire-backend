// src/services/changeRequestScheduler.js   (Module 5 - the "nobody is answering" rules)
//   7 days with no activity   -> remind BOTH people.
//   3 more days of silence    -> status "stalled" and tell the admins (admin review queue).
// runSweep() does one pass. start() runs it every hour while the server is up.
const ChangeRequest = require('../models/ChangeRequest');
const Project       = require('../models/Project');
const User          = require('../models/User');
const { notify }    = require('./notificationService');

const DAY = 24 * 60 * 60 * 1000;
const REMIND_AFTER_DAYS = Number(process.env.CR_REMIND_AFTER_DAYS) || 7;
const STALL_AFTER_DAYS  = Number(process.env.CR_STALL_AFTER_DAYS)  || 3;
const { OPEN_STATUSES } = ChangeRequest;

const link = (role, pid, id) => `/${role}/change-requests/${pid}?cr=${id}`;

async function runSweep(now = new Date()) {
  const result = { reminded: 0, stalled: 0 };

  // 1. Reminders
  const quiet = await ChangeRequest.find({
    status: { $in: ['pending', 'awaiting_second_approval'] },
    reminderSentAt: null,
    lastActivity: { $lt: new Date(now - REMIND_AFTER_DAYS * DAY) },
  });
  for (const cr of quiet) {
    const claimed = await ChangeRequest.findOneAndUpdate(
      { _id: cr._id, reminderSentAt: null }, { $set: { reminderSentAt: now } }, { returnDocument: 'after' });
    if (!claimed) continue;                                            // another run got it first
    const project = await Project.findById(cr.project);
    if (!project) continue;
    await Promise.all(['client', 'freelancer'].map((role) => notify(project[role], {
      type: 'change_request_reminder', title: 'A change request is waiting',
      message: `CR-${cr.number} for ${cr.requirementId} has had no activity for ${REMIND_AFTER_DAYS} days. Please respond.`,
      link: link(role, project._id, cr._id), email: true,
    })));
    result.reminded += 1;
  }

  // 2. Escalation
  const silent = await ChangeRequest.find({
    status: { $in: ['pending', 'awaiting_second_approval'] },
    reminderSentAt: { $lt: new Date(now - STALL_AFTER_DAYS * DAY) },
  });
  for (const cr of silent) {
    if (cr.lastActivity > cr.reminderSentAt) continue;                  // somebody did something after the reminder
    const claimed = await ChangeRequest.findOneAndUpdate(
      { _id: cr._id, status: { $in: ['pending', 'awaiting_second_approval'] } },
      { $set: { status: 'stalled', stalledAt: now } }, { returnDocument: 'after' });
    if (!claimed) continue;
    const project = await Project.findById(cr.project);
    if (!project) continue;
    await Promise.all(['client', 'freelancer'].map((role) => notify(project[role], {
      type: 'change_request_stalled', title: 'Change request escalated',
      message: `CR-${cr.number} for ${cr.requirementId} was sent to an admin because nobody responded.`,
      link: link(role, project._id, cr._id), email: true,
    })));
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    await Promise.all(admins.map((a) => notify(a._id, {
      type: 'admin_review_needed', title: 'Stalled change request',
      message: `CR-${cr.number} in "${project.title}" has had no response for ${REMIND_AFTER_DAYS + STALL_AFTER_DAYS} days.`,
      link: '/admin/moderation',
    })));
    result.stalled += 1;
  }
  return result;
}

let timer = null;
function start(everyMs = 60 * 60 * 1000) {
  if (timer) return timer;
  timer = setInterval(() => runSweep().catch((e) => console.error('[CR:sweep]', e.message)), everyMs);
  timer.unref?.();                                                      // never keeps the server alive on its own
  return timer;
}
const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

module.exports = { runSweep, start, stop };
