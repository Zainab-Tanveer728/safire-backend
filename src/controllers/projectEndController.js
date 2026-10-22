// src/controllers/projectEndController.js  (NEW)
// Ending a project is NOT the same as completing it, and NOT the same as an admin terminating it:
//   completed   -> the work was accepted (deliveryController / reviewController)
//   cancelled   -> one person asks, the OTHER person agrees (this file)
//   terminated  -> an admin ends it after a dispute (disputeController)
// Going quiet is never treated as agreement: if the other person does not answer within 7 days, an admin is asked to look.
const mongoose = require('mongoose');
const Project = require('../models/Project');
const User = require('../models/User');
const { notify } = require('../services/notificationService');

const DAY = 24 * 60 * 60 * 1000;
const ESCALATE_DAYS = Number(process.env.CANCEL_ESCALATE_DAYS) || 7;
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { console.error('[ProjectEnd]', e.message); res.status(500).json({ message: 'Server error.' }); } };
const idOf = (x) => String(x?._id || x);

async function myProject(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(400).json({ message: 'Invalid project id.' }); return {}; }
  const project = await Project.findById(req.params.id);
  if (!project) { res.status(404).json({ message: 'Project not found.' }); return {}; }
  const me = String(req.user._id);
  const party = idOf(project.client) === me ? 'client' : idOf(project.freelancer) === me ? 'freelancer' : null;
  if (!party) { res.status(403).json({ message: 'You are not part of this project.' }); return {}; }
  return { project, party };
}
const other = (p, party) => (party === 'client' ? p.freelancer : p.client);
const linkFor = (role, p) => `/${role}/project-reviews/${p._id}`;

// GET /api/projects/:id/cancel-request
exports.get = wrap(async (req, res) => {
  const { project } = await myProject(req, res); if (!project) return;
  res.json({ status: project.status, cancelRequest: project.cancelRequest || null, escalateDays: ESCALATE_DAYS,
    endedAt: project.endedAt || null, endReason: project.endReason || null });
});

// POST /api/projects/:id/cancel-request   body: { reason }   (either person, active project, a written reason is required)
exports.request = wrap(async (req, res) => {
  const { project, party } = await myProject(req, res); if (!project) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 10) return res.status(400).json({ message: 'Please explain why you want to cancel (at least 10 characters).' });
  const claimed = await Project.findOneAndUpdate(
    { _id: project._id, status: 'active', 'cancelRequest.status': { $ne: 'pending' } },
    { $set: { cancelRequest: { by: req.user._id, byRole: party, reason: reason.slice(0, 1000), at: new Date(), status: 'pending' } } }, { returnDocument: 'after' });
  if (!claimed) return res.status(409).json({ message: project.status !== 'active' ? 'Only an active project can be cancelled.' : 'A cancellation request is already waiting for an answer.' });
  await notify(other(project, party), { type: 'cancel_requested', title: 'Request to cancel the project',
    message: `${req.user.name || 'The other person'} asked to cancel "${project.title}": ${reason.slice(0, 160)}. Please accept or decline within ${ESCALATE_DAYS} days.`,
    link: linkFor(party === 'client' ? 'freelancer' : 'client', project), email: true });
  res.status(201).json({ cancelRequest: claimed.cancelRequest });
});

// POST /api/projects/:id/cancel-request/respond   body: { accept: true|false, note? }   (the OTHER person only)
exports.respond = wrap(async (req, res) => {
  const { project, party } = await myProject(req, res); if (!project) return;
  const cr = project.cancelRequest;
  if (!cr || !['pending', 'escalated'].includes(cr.status)) return res.status(409).json({ message: 'There is no cancellation request to answer.' });
  if (idOf(cr.by) === String(req.user._id)) return res.status(403).json({ message: 'You cannot answer your own request. You can withdraw it instead.' });
  const accept = req.body?.accept === true;
  const note = String(req.body?.note || '').trim().slice(0, 500);
  const q = { _id: project._id, status: 'active', 'cancelRequest.status': { $in: ['pending', 'escalated'] } };
  const set = accept
    ? { status: 'cancelled', endedAt: new Date(), endedBy: req.user._id, endReason: cr.reason, 'cancelRequest.status': 'accepted', 'cancelRequest.respondedAt': new Date(), 'cancelRequest.note': note || undefined }
    : { 'cancelRequest.status': 'declined', 'cancelRequest.respondedAt': new Date(), 'cancelRequest.note': note || undefined };
  const done = await Project.findOneAndUpdate(q, { $set: set }, { returnDocument: 'after' });
  if (!done) return res.status(409).json({ message: 'This request was already answered.' });
  await notify(cr.by, { type: 'cancel_answered', title: accept ? 'Project cancelled' : 'Cancellation declined',
    message: accept ? `"${project.title}" was cancelled by agreement.` : `${req.user.name || 'The other person'} declined to cancel "${project.title}".${note ? ' ' + note : ''} If you cannot agree, raise a dispute so an admin can look at it.`,
    link: linkFor(party === 'client' ? 'freelancer' : 'client', project), email: true });
  res.json({ project: done });
});

// POST /api/projects/:id/cancel-request/withdraw   (the person who asked)
exports.withdraw = wrap(async (req, res) => {
  const { project } = await myProject(req, res); if (!project) return;
  const cr = project.cancelRequest;
  if (!cr || !['pending', 'escalated'].includes(cr.status)) return res.status(409).json({ message: 'There is no cancellation request to withdraw.' });
  if (idOf(cr.by) !== String(req.user._id)) return res.status(403).json({ message: 'Only the person who asked can withdraw it.' });
  const done = await Project.findOneAndUpdate({ _id: project._id, 'cancelRequest.status': { $in: ['pending', 'escalated'] } },
    { $set: { 'cancelRequest.status': 'withdrawn', 'cancelRequest.respondedAt': new Date() } }, { returnDocument: 'after' });
  if (!done) return res.status(409).json({ message: 'This request was already answered.' });
  res.json({ cancelRequest: done.cancelRequest });
});

// Hourly sweep: a request nobody answered for ESCALATE_DAYS goes to the admins. Nothing is cancelled automatically.
exports.sweep = async function sweep(now = new Date()) {
  const out = { escalated: 0 };
  const rows = await Project.find({ status: 'active', 'cancelRequest.status': 'pending' });
  for (const p of rows) {
    if (+new Date(p.cancelRequest.at) + ESCALATE_DAYS * DAY > +now) continue;
    const done = await Project.findOneAndUpdate({ _id: p._id, 'cancelRequest.status': 'pending' }, { $set: { 'cancelRequest.status': 'escalated', 'cancelRequest.escalatedAt': now } }, { returnDocument: 'after' });
    if (!done) continue;
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    await Promise.all(admins.map((a) => notify(a._id, { type: 'admin_review_needed', title: 'Unanswered cancellation request',
      message: `A request to cancel "${p.title}" has had no answer for ${ESCALATE_DAYS} days. Please look at it.`, link: '/admin/moderation' })));
    await Promise.all([p.client, p.freelancer].map((u) => notify(u, { type: 'cancel_requested', title: 'Cancellation sent to an admin',
      message: `Nobody answered the request to cancel "${p.title}" for ${ESCALATE_DAYS} days, so an admin will look at it.`, link: '/' })));
    out.escalated += 1;
  }
  return out;
};