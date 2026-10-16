// src/controllers/requirementController.js
// Module 3 review page (M26): list, edit, confirm, reject, revert, add, bulk, history,
// plus the per-meeting document (summary / notes / user stories).
//
// Rules:
//   - Both the client and the freelancer can review.
//   - A 'locked' requirement (Module 5) can never change.
//   - Every change is written to RequirementHistory (append-only audit log).
const ExtractedRequirement = require('../models/ExtractedRequirement');
const RequirementHistory   = require('../models/RequirementHistory');
const RequirementDocument  = require('../models/RequirementDocument');
const MeetingSession       = require('../models/MeetingSession');
const { notify } = require('../services/notificationService');
const { formatRequirementId, nextRequirementNumber } = require('../utils/requirementId');

const otherParty  = (party) => (party === 'client' ? 'freelancer' : 'client');
const otherUserId = (project, party) => (party === 'client' ? project.freelancer : project.client);
const reviewLink  = (role, projectId) => `/${role}/project/${projectId}/requirements`;

const TYPES = ['functional', 'non-functional'];
const cleanText = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function tellOther(req, { title, message, type = 'requirement_reviewed' }) {
  await notify(otherUserId(req.project, req.party), {
    type, title, message, link: reviewLink(otherParty(req.party), req.project._id),
  });
}

async function log(entry) {
  await RequirementHistory.create({ timestamp: new Date(), ...entry });
}

// ── List ────────────────────────────────────────────────────────────────────
// GET /api/requirements/project/:projectId?status=&type=&meeting=&q=
exports.listForProject = async (req, res) => {
  try {
    const { status, type, meeting, q } = req.query;
    const filter = { project: req.project._id };
    if (status && ['pending_review', 'confirmed', 'rejected', 'locked'].includes(status)) filter.status = status;
    if (type && TYPES.includes(type)) filter.type = type;
    if (meeting) filter.meetingSession = meeting;
    if (q) filter.text = { $regex: String(q).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

    const [requirements, byStatus, byType] = await Promise.all([
      ExtractedRequirement.find(filter).sort({ createdAt: 1, requirementId: 1 }),
      ExtractedRequirement.aggregate([
        { $match: { project: req.project._id } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      ExtractedRequirement.aggregate([
        { $match: { project: req.project._id } },
        { $group: { _id: '$type', n: { $sum: 1 } } },
      ]),
    ]);

    const counts = { pending_review: 0, confirmed: 0, rejected: 0, locked: 0, total: 0, functional: 0, nonFunctional: 0 };
    byStatus.forEach((r) => { counts[r._id] = r.n; counts.total += r.n; });
    byType.forEach((r) => {
      if (r._id === 'functional') counts.functional = r.n; else counts.nonFunctional = r.n;
    });

    res.json({ requirements, counts, locked: !!req.project.requirementsLocked });
  } catch (err) {
    console.error('[Req:list]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/requirements/:id      (one requirement + its history)
exports.getOne = async (req, res) => {
  try {
    const history = await RequirementHistory.find({ requirement: req.requirement._id })
      .sort({ timestamp: -1 }).populate('changedBy', 'name role');
    res.json({ requirement: req.requirement, history });
  } catch (err) {
    console.error('[Req:get]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Edit ────────────────────────────────────────────────────────────────────
// PATCH /api/requirements/:id     body: { text?, type?, reason? }
// Editing a confirmed requirement sends it back to "pending_review", so the other
// person confirms the new wording too.
exports.edit = async (req, res) => {
  try {
    const r = req.requirement;
    if (r.status === 'locked') return res.status(409).json({ message: 'This requirement is locked and cannot be changed.' });

    const text = req.body.text !== undefined ? cleanText(req.body.text) : r.text;
    const type = req.body.type !== undefined ? req.body.type : r.type;

    if (text.length < 5 || text.length > 1000)
      return res.status(400).json({ message: 'Requirement text must be between 5 and 1000 characters.' });
    if (!TYPES.includes(type))
      return res.status(400).json({ message: 'Type must be "functional" or "non-functional".' });
    if (text === r.text && type === r.type)
      return res.status(400).json({ message: 'Nothing was changed.' });

    const beforeText = r.text, beforeStatus = r.status;
    r.text = text;
    r.type = type;
    if (r.status === 'confirmed') { r.status = 'pending_review'; r.reviewedBy = undefined; r.reviewedAt = undefined; }
    await r.save();

    await log({
      requirement: r._id, project: r.project, changedBy: req.user._id, changeType: 'edit',
      beforeText, afterText: text, beforeStatus, afterStatus: r.status,
      reason: cleanText(req.body.reason).slice(0, 300) || undefined,
    });
    await tellOther(req, {
      title: 'A requirement was edited',
      message: `${req.user.name || 'Your project partner'} edited ${r.requirementId}.`,
    });
    res.json({ requirement: r });
  } catch (err) {
    console.error('[Req:edit]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Confirm / reject / revert ───────────────────────────────────────────────
async function changeStatus(req, res, next, reason) {
  const r = req.requirement;
  if (r.status === 'locked') return res.status(409).json({ message: 'This requirement is locked and cannot be changed.' });
  if (r.status === next)     return res.status(409).json({ message: `It is already ${next.replace('_', ' ')}.` });

  const beforeStatus = r.status;
  r.status = next;
  r.reviewedBy = next === 'pending_review' ? undefined : req.user._id;
  r.reviewedAt = next === 'pending_review' ? undefined : new Date();
  r.rejectionReason = next === 'rejected' ? reason : undefined;
  await r.save();

  await log({
    requirement: r._id, project: r.project, changedBy: req.user._id, changeType: next === 'pending_review' ? 'revert' : 'status_change',
    beforeText: r.text, afterText: r.text, beforeStatus, afterStatus: next, reason,
  });
  await tellOther(req, {
    title: next === 'confirmed' ? 'Requirement confirmed' : next === 'rejected' ? 'Requirement rejected' : 'Requirement reopened',
    message: `${req.user.name || 'Your project partner'} ${next === 'confirmed' ? 'confirmed' : next === 'rejected' ? 'rejected' : 'reopened'} ${r.requirementId}.`,
  });
  res.json({ requirement: r });
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (err) { console.error('[Req]', err.message); res.status(500).json({ message: 'Server error.' }); }
};

exports.confirm = wrap((req, res) => changeStatus(req, res, 'confirmed'));
exports.revert  = wrap((req, res) => changeStatus(req, res, 'pending_review'));
exports.reject  = wrap((req, res) => {
  const reason = cleanText(req.body?.reason).slice(0, 300);
  if (!reason) return res.status(400).json({ message: 'Please say why you are rejecting it.' });
  return changeStatus(req, res, 'rejected', reason);
});

// POST /api/requirements/project/:projectId/bulk
// body: { action: 'confirm' | 'reject', ids?: [...], meetingId?, reason? }
// With no ids it applies to everything still waiting for review ("Confirm all").
exports.bulk = wrap(async (req, res) => {
  const { action, ids, meetingId } = req.body || {};
  if (!['confirm', 'reject'].includes(action)) return res.status(400).json({ message: 'Action must be "confirm" or "reject".' });
  const reason = cleanText(req.body?.reason).slice(0, 300);
  if (action === 'reject' && !reason) return res.status(400).json({ message: 'Please say why you are rejecting them.' });

  const filter = { project: req.project._id, status: 'pending_review' };
  if (Array.isArray(ids) && ids.length) filter._id = { $in: ids };
  if (meetingId) filter.meetingSession = meetingId;

  const items = await ExtractedRequirement.find(filter).select('_id text');
  if (!items.length) return res.json({ updated: 0 });

  const next = action === 'confirm' ? 'confirmed' : 'rejected';
  const set = { status: next, reviewedBy: req.user._id, reviewedAt: new Date() };
  if (next === 'rejected') set.rejectionReason = reason;
  await ExtractedRequirement.updateMany({ _id: { $in: items.map((i) => i._id) } }, { $set: set });
  await RequirementHistory.insertMany(items.map((i) => ({
    requirement: i._id, project: req.project._id, changedBy: req.user._id, changeType: 'status_change',
    beforeText: i.text, afterText: i.text, beforeStatus: 'pending_review', afterStatus: next, reason: reason || undefined,
    timestamp: new Date(),
  })));
  await tellOther(req, {
    title: next === 'confirmed' ? 'Requirements confirmed' : 'Requirements rejected',
    message: `${req.user.name || 'Your project partner'} ${next} ${items.length} requirement${items.length === 1 ? '' : 's'}.`,
  });
  res.json({ updated: items.length });
});

// ── Add by hand (the AI missed one) ─────────────────────────────────────────
// POST /api/requirements/project/:projectId     body: { text, type, meetingId? }
exports.addManual = wrap(async (req, res) => {
  if (req.project.requirementsLocked) return res.status(409).json({ message: 'Requirements are locked for this project.' });
  const text = cleanText(req.body?.text);
  const type = req.body?.type;
  if (text.length < 5 || text.length > 1000) return res.status(400).json({ message: 'Requirement text must be between 5 and 1000 characters.' });
  if (!TYPES.includes(type)) return res.status(400).json({ message: 'Type must be "functional" or "non-functional".' });

  // must belong to a meeting of this project
  let meeting;
  if (req.body?.meetingId) meeting = await MeetingSession.findOne({ _id: req.body.meetingId, project: req.project._id });
  if (!meeting) meeting = await MeetingSession.findOne({ project: req.project._id }).sort({ createdAt: -1 });
  if (!meeting) return res.status(409).json({ message: 'Create a meeting first, then add requirements to it.' });

  const n = await nextRequirementNumber(req.project._id);
  const requirement = await ExtractedRequirement.create({
    meetingSession: meeting._id, project: req.project._id, requirementId: formatRequirementId(n),
    type, text, source: 'manual', status: 'pending_review',
  });
  await log({
    requirement: requirement._id, project: req.project._id, changedBy: req.user._id, changeType: 'edit',
    afterText: text, afterStatus: 'pending_review', reason: 'Added manually',
  });
  await tellOther(req, {
    type: 'requirement_added', title: 'A requirement was added',
    message: `${req.user.name || 'Your project partner'} added ${requirement.requirementId}.`,
  });
  res.status(201).json({ requirement });
});

// ── Meeting document: summary, notes, user stories ──────────────────────────
// GET /api/requirements/meeting/:meetingId/document
exports.getDocument = wrap(async (req, res) => {
  const document = await RequirementDocument.findOne({ meetingSession: req.meeting._id });
  res.json({ document: document || null });
});

// PUT /api/requirements/meeting/:meetingId/document
// body: { summaryText?, focusAreas?, ambiguities?, recommendations?, meetingNotes? }
exports.saveDocument = wrap(async (req, res) => {
  const b = req.body || {};
  const list = (v) => (Array.isArray(v) ? v.map(cleanText).filter(Boolean).slice(0, 30) : undefined);
  const set = { project: req.project._id, meetingSession: req.meeting._id };

  if (b.summaryText   !== undefined) { set['summary.text'] = String(b.summaryText).slice(0, 5000); set['summary.editedByUser'] = true; }
  if (b.focusAreas    !== undefined) set['summary.focusAreas']      = list(b.focusAreas);
  if (b.ambiguities   !== undefined) set['summary.ambiguities']     = list(b.ambiguities);
  if (b.recommendations !== undefined) set['summary.recommendations'] = list(b.recommendations);
  if (b.meetingNotes  !== undefined) set.meetingNotes = String(b.meetingNotes).slice(0, 20000);

  const document = await RequirementDocument.findOneAndUpdate(
    { meetingSession: req.meeting._id }, { $set: set }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  res.json({ document });
});