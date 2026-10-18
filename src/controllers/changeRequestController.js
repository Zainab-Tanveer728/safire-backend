// src/controllers/changeRequestController.js   (Module 5: Project Requirement Management, M35)
//
// The rules (from the SRS ERT for Module 5):
//   - Only a CONFIRMED + LOCKED requirement (part of the baseline) can be changed, and only by a change request.
//   - Either person can submit. The other person is told by in-app notification and email.
//   - Both people can discuss. Every comment resets the 7-day "no activity" clock.
//   - BOTH the client and the freelancer must approve. After the first approval the status is
//     "awaiting_second_approval". After the second, the change is applied.
//   - Either person can reject, but must give a reason.
//   - An applied change updates the requirement, marks linked user stories as outdated, and writes an
//     immutable ChangeHistory record (before / after / who approved).
//   - A requirement with an open dispute is frozen: no new requests, no approvals.
const mongoose = require('mongoose');
const ChangeRequest        = require('../models/ChangeRequest');
const ChangeHistory        = require('../models/ChangeHistory');
const Dispute              = require('../models/Dispute');
const ExtractedRequirement = require('../models/ExtractedRequirement');
const RequirementHistory   = require('../models/Requirementhistory');
const RequirementDocument  = require('../models/Requirementdocument');
const Project              = require('../models/Project');
const { notify } = require('../services/notificationService');

const { OPEN_STATUSES } = ChangeRequest;
const TYPES = ['functional', 'non-functional'];

// Set to true if you want the person who SUBMITS a request to count as the first approval.
// The SDS says both people approve, so the default is false.
const SUBMITTER_APPROVES_AUTOMATICALLY = false;

const idOf        = (x) => String(x?._id || x);
const otherParty  = (party) => (party === 'client' ? 'freelancer' : 'client');
const otherUserId = (project, party) => (party === 'client' ? project.freelancer : project.client);
const clean       = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const link        = (role, projectId, crId) => `/${role}/change-requests/${projectId}${crId ? `?cr=${crId}` : ''}`;

// Tell BOTH people (or just the other one) about something.
async function tellOther(req, cr, payload) {
  await notify(otherUserId(req.project, req.party), {
    ...payload, link: link(otherParty(req.party), req.project._id, cr._id),
  });
}
async function tellBoth(project, cr, payload) {
  await Promise.all(['client', 'freelancer'].map((role) => notify(project[role], {
    ...payload, link: link(role, project._id, cr._id),
  })));
}

// Next CR number: 1001, 1002 ... (the unique index makes two requests at once safe: one retries)
async function nextNumber() {
  const last = await ChangeRequest.findOne().sort({ number: -1 }).select('number').lean();
  return (last?.number || 1000) + 1;
}

async function findRequirement(project, ref) {
  const key = clean(ref);
  if (!key) return null;
  if (mongoose.isValidObjectId(key)) {
    const byId = await ExtractedRequirement.findOne({ _id: key, project: project._id });
    if (byId) return byId;
  }
  return ExtractedRequirement.findOne({ project: project._id, requirementId: key.toUpperCase() });
}

const openDispute = (requirementId) => Dispute.findOne({ requirement: requirementId, status: 'open' });

// Make a change request safe to send to the browser.
const publicCr = (cr) => {
  const o = cr.toObject ? cr.toObject() : { ...cr };
  o.crId = `CR-${o.number}`;
  o.discussionCount = (o.discussion || []).length;
  o.isOpen = OPEN_STATUSES.includes(o.status);
  return o;
};

// ── Create ──────────────────────────────────────────────────────────────────
// POST /api/change-requests/project/:projectId
// body: { requirementId, proposedText, proposedType?, reason? }
exports.create = async (req, res) => {
  try {
    const project = req.project;
    const requirement = await findRequirement(project, req.body.requirementId);
    if (!requirement) return res.status(404).json({ message: 'That requirement was not found in this project.' });

    if (requirement.status !== 'locked') {
      return res.status(409).json({
        message: requirement.status === 'confirmed'
          ? 'Set the project baseline first. Until then you can edit this requirement directly on the review page.'
          : 'Only confirmed requirements in the project baseline can be changed with a change request.',
      });
    }

    const proposedText = clean(req.body.proposedText);
    const proposedType = req.body.proposedType || requirement.type;
    const reason = clean(req.body.reason).slice(0, 500);
    if (proposedText.length < 5 || proposedText.length > 1000)
      return res.status(400).json({ message: 'The proposed text must be between 5 and 1000 characters.' });
    if (!TYPES.includes(proposedType))
      return res.status(400).json({ message: 'Type must be "functional" or "non-functional".' });
    if (proposedText === requirement.text && proposedType === requirement.type)
      return res.status(400).json({ message: 'The proposed change is the same as the current requirement.' });

    if (await openDispute(requirement._id))
      return res.status(409).json({ message: 'This requirement is frozen because of an open dispute.' });
    const existing = await ChangeRequest.findOne({ requirement: requirement._id, status: { $in: OPEN_STATUSES } });
    if (existing)
      return res.status(409).json({ message: `CR-${existing.number} is already open for this requirement. Finish it first.`, existing: existing._id });

    let cr = null;
    for (let attempt = 0; attempt < 4 && !cr; attempt += 1) {
      try {
        cr = await ChangeRequest.create({
          number: await nextNumber() + attempt,
          project: project._id,
          requirement: requirement._id,
          requirementId: requirement.requirementId,
          requestedBy: req.user._id,
          requesterRole: req.party,
          beforeText: requirement.text,
          beforeType: requirement.type,
          proposedText, proposedType, reason,
          lastActivity: new Date(),
          ...(SUBMITTER_APPROVES_AUTOMATICALLY
            ? { approvals: [{ approvedBy: req.user._id, role: req.party }], status: 'awaiting_second_approval' }
            : {}),
        });
      } catch (err) {
        if (err.code !== 11000 || attempt === 3) throw err;
      }
    }

    await tellOther(req, cr, {
      type: 'change_request_submitted',
      title: `New change request ${cr.requirementId ? `for ${cr.requirementId}` : ''}`.trim(),
      message: `${req.user.name || 'Your project partner'} asked to change ${requirement.requirementId} in "${project.title}". Please review it.`,
      email: true,
    });
    res.status(201).json({ changeRequest: publicCr(cr) });
  } catch (err) {
    console.error('[CR:create]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── List ────────────────────────────────────────────────────────────────────
// GET /api/change-requests/project/:projectId?status=all|pending|approved|rejected
exports.list = async (req, res) => {
  try {
    const rows = await ChangeRequest.find({ project: req.project._id })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'name role')
      .lean();

    const counts = { all: rows.length, pending: 0, approved: 0, rejected: 0 };
    rows.forEach((r) => {
      if (OPEN_STATUSES.includes(r.status)) counts.pending += 1;
      else if (r.status === 'approved') counts.approved += 1;
      else if (r.status === 'rejected') counts.rejected += 1;
    });

    const tab = String(req.query.status || 'all');
    const keep = {
      all: () => true,
      pending:  (r) => OPEN_STATUSES.includes(r.status),
      approved: (r) => r.status === 'approved',
      rejected: (r) => r.status === 'rejected',
    }[tab] || (() => true);

    const changeRequests = rows.filter(keep).map((r) => ({
      ...r,
      crId: `CR-${r.number}`,
      discussionCount: (r.discussion || []).length,
      discussion: undefined,                         // the detail call has the full thread
      isOpen: OPEN_STATUSES.includes(r.status),
    }));
    res.json({ changeRequests, counts, baselineSet: !!req.project.requirementsLocked });
  } catch (err) {
    console.error('[CR:list]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── One request (detail panel) ──────────────────────────────────────────────
// GET /api/change-requests/:id
exports.getOne = async (req, res) => {
  try {
    const cr = await ChangeRequest.findById(req.changeRequest._id)
      .populate('requestedBy', 'name email role')
      .populate('discussion.author', 'name role')
      .populate('approvals.approvedBy', 'name role');
    const requirement = await ExtractedRequirement.findById(cr.requirement)
      .select('requirementId text type status').lean();
    const dispute = await openDispute(cr.requirement);
    const iApproved = cr.approvals.some((a) => idOf(a.approvedBy) === String(req.user._id));
    res.json({
      changeRequest: publicCr(cr),
      requirement,
      dispute: dispute ? { _id: dispute._id, reason: dispute.reason } : null,
      party: req.party,
      canAct: OPEN_STATUSES.includes(cr.status) && !dispute && req.party !== 'admin',
      iApproved,
    });
  } catch (err) {
    console.error('[CR:get]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Comment ─────────────────────────────────────────────────────────────────
// POST /api/change-requests/:id/comments     body: { text }
exports.comment = async (req, res) => {
  try {
    const cr = req.changeRequest;
    if (!OPEN_STATUSES.includes(cr.status))
      return res.status(409).json({ message: 'This request is closed, so the discussion is closed too.' });
    const text = clean(req.body.text);
    if (!text || text.length > 1000)
      return res.status(400).json({ message: 'A comment must be between 1 and 1000 characters.' });

    cr.discussion.push({ author: req.user._id, authorRole: req.party, text, postedAt: new Date() });
    cr.lastActivity = new Date();
    if (cr.status === 'stalled') {                       // someone is talking again
      cr.status = cr.approvals.length ? 'awaiting_second_approval' : 'pending';
    }
    cr.reminderSentAt = undefined;
    cr.stalledAt = undefined;
    await cr.save();

    await tellOther(req, cr, {
      type: 'change_request_comment',
      title: `New comment on ${cr.requirementId || `CR-${cr.number}`}`,
      message: `${req.user.name || 'Your project partner'} commented on CR-${cr.number}.`,
    });
    res.status(201).json({ changeRequest: publicCr(cr) });
  } catch (err) {
    console.error('[CR:comment]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Apply an approved change (runs once) ────────────────────────────────────
async function applyChange(project, cr) {
  const requirement = await ExtractedRequirement.findById(cr.requirement);
  const beforeText = requirement.text;
  const beforeType = requirement.type;

  requirement.text = cr.proposedText;
  requirement.type = cr.proposedType || requirement.type;
  await requirement.save();                              // stays 'locked': only change requests move it

  await RequirementHistory.create({
    requirement: requirement._id, project: project._id, changedBy: cr.requestedBy, changeType: 'edit',
    beforeText, afterText: requirement.text, beforeStatus: 'locked', afterStatus: 'locked',
    reason: `Change request CR-${cr.number}`,
  });

  await ChangeHistory.create({
    project: project._id, requirement: requirement._id, requirementId: requirement.requirementId,
    changeRequest: cr._id, crNumber: cr.number,
    beforeText, afterText: requirement.text, beforeType, afterType: requirement.type,
    reason: cr.reason, requestedBy: cr.requestedBy,
    approvedBy: cr.approvals.map((a) => ({ user: a.approvedBy, role: a.role, approvedAt: a.approvedAt })),
    appliedAt: cr.appliedAt || new Date(),
  });

  // Linked user stories / documents: mark them so the next person knows they must be re-checked.
  let staleStories = 0;
  const docs = await RequirementDocument.find({ project: project._id, 'userStories.requirement': requirement._id });
  for (const doc of docs) {
    doc.userStories.forEach((s) => {
      if (idOf(s.requirement) === String(requirement._id)) {
        s.outdated = true;
        s.outdatedReason = `${requirement.requirementId} was changed by CR-${cr.number}.`;
        staleStories += 1;
      }
    });
    await doc.save();
  }
  return { staleStories };
}

// ── Approve ─────────────────────────────────────────────────────────────────
// POST /api/change-requests/:id/approve
exports.approve = async (req, res) => {
  try {
    const cr = req.changeRequest;
    if (await openDispute(cr.requirement))
      return res.status(409).json({ message: 'This requirement is frozen because of an open dispute.' });

    // Atomic: the filter makes sure the request is still open and that I have not already approved it.
    const updated = await ChangeRequest.findOneAndUpdate(
      { _id: cr._id, status: { $in: OPEN_STATUSES }, 'approvals.approvedBy': { $ne: req.user._id } },
      {
        $push: { approvals: { approvedBy: req.user._id, role: req.party, approvedAt: new Date() } },
        $set: { lastActivity: new Date(), status: 'awaiting_second_approval' },
        $unset: { reminderSentAt: '', stalledAt: '' },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      const fresh = await ChangeRequest.findById(cr._id);
      return res.status(409).json({
        message: fresh && !OPEN_STATUSES.includes(fresh.status)
          ? `This request is already ${fresh.status}.` : 'You have already approved this request.',
      });
    }

    const roles = new Set(updated.approvals.map((a) => a.role));
    if (roles.has('client') && roles.has('freelancer')) {
      // Claim the "apply" step so it can only ever run once, even if both people click at the same moment.
      const claimed = await ChangeRequest.findOneAndUpdate(
        { _id: cr._id, appliedAt: null },
        { $set: { status: 'approved', appliedAt: new Date() } },
        { returnDocument: 'after' },
      );
      if (claimed) {
        const { staleStories } = await applyChange(req.project, claimed);
        await tellBoth(req.project, claimed, {
          type: 'change_request_approved',
          title: 'Change approved and applied',
          message: `CR-${claimed.number}: ${claimed.requirementId} was updated in "${req.project.title}".${staleStories ? ` ${staleStories} linked user stor${staleStories === 1 ? 'y needs' : 'ies need'} a check.` : ''}`,
          email: true,
        });
        return res.json({ changeRequest: publicCr(claimed), applied: true, staleStories });
      }
    }

    await tellOther(req, updated, {
      type: 'change_request_awaiting_approval',
      title: 'Your approval is needed',
      message: `${req.user.name || 'Your project partner'} approved CR-${updated.number}. It needs your approval too.`,
      email: true,
    });
    res.json({ changeRequest: publicCr(updated), applied: false });
  } catch (err) {
    console.error('[CR:approve]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Reject ──────────────────────────────────────────────────────────────────
// POST /api/change-requests/:id/reject     body: { reason }   (a reason is required)
exports.reject = async (req, res) => {
  try {
    const reason = clean(req.body.reason);
    if (reason.length < 3 || reason.length > 500)
      return res.status(400).json({ message: 'Please give a reason (3 to 500 characters).' });

    const updated = await ChangeRequest.findOneAndUpdate(
      { _id: req.changeRequest._id, status: { $in: OPEN_STATUSES } },
      { $set: { status: 'rejected', rejectedBy: req.user._id, rejectedAt: new Date(), rejectionReason: reason, lastActivity: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(409).json({ message: `This request is already ${req.changeRequest.status}.` });

    await tellBoth(req.project, updated, {
      type: 'change_request_rejected',
      title: 'Change request rejected',
      message: `CR-${updated.number} for ${updated.requirementId} was rejected by ${req.user.name || 'your project partner'}. Reason: ${reason}`,
      email: true,
    });
    res.json({ changeRequest: publicCr(updated) });
  } catch (err) {
    console.error('[CR:reject]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Change history ──────────────────────────────────────────────────────────
// GET /api/change-requests/project/:projectId/history?page=1&limit=20&requirement=<id>
exports.history = async (req, res) => {
  try {
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = { project: req.project._id };
    if (req.query.requirement && mongoose.isValidObjectId(req.query.requirement)) filter.requirement = req.query.requirement;

    const [items, total] = await Promise.all([
      ChangeHistory.find(filter).sort({ appliedAt: -1 }).skip((page - 1) * limit).limit(limit)
        .populate('approvedBy.user', 'name role').populate('requestedBy', 'name role').lean(),
      ChangeHistory.countDocuments(filter),
    ]);
    res.json({ items, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
  } catch (err) {
    console.error('[CR:history]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Dashboard numbers (M31: Pending Requests card + Recent Change Requests panel) ──
// GET /api/change-requests/summary
exports.summary = async (req, res) => {
  try {
    const me = req.user._id;
    const projects = await Project.find({ $or: [{ client: me }, { freelancer: me }] }).select('title').lean();
    const titleOf = Object.fromEntries(projects.map((p) => [String(p._id), p.title]));
    const ids = projects.map((p) => p._id);

    const [pending, recent] = await Promise.all([
      ChangeRequest.countDocuments({ project: { $in: ids }, status: { $in: OPEN_STATUSES } }),
      ChangeRequest.find({ project: { $in: ids } }).sort({ createdAt: -1 }).limit(5).populate('requestedBy', 'name role').lean(),
    ]);
    res.json({
      pending,
      recent: recent.map((r) => ({
        _id: r._id, crId: `CR-${r.number}`, project: r.project, projectTitle: titleOf[String(r.project)] || 'Project',
        requirementId: r.requirementId, status: r.status, proposedText: r.proposedText, createdAt: r.createdAt,
        requestedBy: r.requestedBy ? { _id: r.requestedBy._id, name: r.requestedBy.name } : null,
        requesterRole: r.requesterRole,
      })),
    });
  } catch (err) {
    console.error('[CR:summary]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Baseline: lock the confirmed requirements so that only change requests can touch them ──
// POST /api/change-requests/project/:projectId/baseline
exports.setBaseline = async (req, res) => {
  try {
    const project = req.project;
    if (project.requirementsLocked) return res.status(409).json({ message: 'The baseline is already set for this project.' });

    const waiting = await ExtractedRequirement.countDocuments({ project: project._id, status: 'pending_review' });
    if (waiting) return res.status(409).json({ message: `${waiting} requirement${waiting === 1 ? ' is' : 's are'} still waiting for review. Confirm or reject them first.`, pending: waiting });

    const confirmed = await ExtractedRequirement.find({ project: project._id, status: 'confirmed' });
    if (!confirmed.length) return res.status(409).json({ message: 'Confirm at least one requirement before setting the baseline.' });

    await Promise.all(confirmed.map(async (r) => {
      r.status = 'locked';
      await r.save();
    }));
    await RequirementHistory.insertMany(confirmed.map((r) => ({
      requirement: r._id, project: project._id, changedBy: req.user._id, changeType: 'status_change',
      beforeText: r.text, afterText: r.text, beforeStatus: 'confirmed', afterStatus: 'locked', reason: 'Project baseline set',
    })));

    project.requirementsLocked = true;
    await project.save();

    await notify(otherUserId(project, req.party), {
      type: 'review_complete',
      title: 'Project requirements are locked in',
      message: `${confirmed.length} requirements for "${project.title}" are now the baseline. From now on, changes go through change requests.`,
      link: link(otherParty(req.party), project._id),
      email: true,
    });
    res.json({ locked: confirmed.length, requirementsLocked: true });
  } catch (err) {
    console.error('[CR:baseline]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// Used by the sweep (services/changeRequestScheduler.js) and by tests.
exports._internal = { publicCr, applyChange, SUBMITTER_APPROVES_AUTOMATICALLY };