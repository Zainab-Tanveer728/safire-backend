// src/controllers/disputeController.js   (Module 5 raises it, Module 6 admin decides it)
//   Raise  -> collect the evidence (change history, requests, approvers), freeze the requirement, tell the other person and the admins.
//   Decide -> an admin records a decision, the requirement is unfrozen, both people are told.
const mongoose = require('mongoose');
const Dispute              = require('../models/Dispute');
const ChangeHistory        = require('../models/ChangeHistory');
const ChangeRequest        = require('../models/ChangeRequest');
const ExtractedRequirement = require('../models/ExtractedRequirement');
const User                 = require('../models/User');
const { notify } = require('../services/notificationService');

const clean       = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const otherParty  = (party) => (party === 'client' ? 'freelancer' : 'client');
const otherUserId = (project, party) => (party === 'client' ? project.freelancer : project.client);
const DECISIONS = ['in_favour_client', 'in_favour_freelancer', 'no_action'];

// The evidence report: one timeline of everything that happened to this requirement.
async function buildEvidence(project, requirement) {
  const [history, requests] = await Promise.all([
    ChangeHistory.find({ requirement: requirement._id }).sort({ appliedAt: 1 })
      .populate('approvedBy.user', 'name role').lean(),
    ChangeRequest.find({ requirement: requirement._id }).sort({ createdAt: 1 })
      .populate('requestedBy', 'name role').populate('discussion.author', 'name role').lean(),
  ]);

  const timeline = [];
  requests.forEach((r) => {
    timeline.push({ at: r.createdAt, kind: 'requested', crId: `CR-${r.number}`, by: r.requestedBy?.name, role: r.requesterRole, text: r.proposedText, reason: r.reason });
    (r.discussion || []).forEach((d) => timeline.push({ at: d.postedAt, kind: 'comment', crId: `CR-${r.number}`, by: d.author?.name, role: d.authorRole, text: d.text }));
    if (r.status === 'rejected') timeline.push({ at: r.rejectedAt, kind: 'rejected', crId: `CR-${r.number}`, text: r.rejectionReason });
  });
  history.forEach((h) => timeline.push({
    at: h.appliedAt, kind: 'applied', crId: `CR-${h.crNumber}`, before: h.beforeText, after: h.afterText,
    approvers: (h.approvedBy || []).map((a) => ({ name: a.user?.name, role: a.role, at: a.approvedAt })),
  }));
  timeline.sort((a, b) => new Date(a.at) - new Date(b.at));

  return {
    project: { _id: project._id, title: project.title },
    requirement: { _id: requirement._id, requirementId: requirement.requirementId, text: requirement.text, type: requirement.type },
    generatedAt: new Date(),
    changeCount: history.length,
    timeline,
  };
}

// POST /api/disputes/project/:projectId      body: { requirementId, reason }
exports.raise = async (req, res) => {
  try {
    const project = req.project;
    const key = clean(req.body.requirementId);
    const requirement = mongoose.isValidObjectId(key)
      ? await ExtractedRequirement.findOne({ _id: key, project: project._id })
      : await ExtractedRequirement.findOne({ project: project._id, requirementId: key.toUpperCase() });
    if (!requirement) return res.status(404).json({ message: 'That requirement was not found in this project.' });

    const reason = clean(req.body.reason);
    if (reason.length < 10 || reason.length > 1000)
      return res.status(400).json({ message: 'Please explain the problem in 10 to 1000 characters.' });

    if (await Dispute.findOne({ requirement: requirement._id, status: 'open' }))
      return res.status(409).json({ message: 'There is already an open dispute for this requirement.' });
    if (!(await ChangeHistory.countDocuments({ requirement: requirement._id })))
      return res.status(409).json({ message: 'A dispute needs change history. This requirement has not been changed yet.' });

    const dispute = await Dispute.create({
      project: project._id, requirement: requirement._id, requirementId: requirement.requirementId,
      raisedBy: req.user._id, raisedByRole: req.party, reason,
      evidence: await buildEvidence(project, requirement),
    });

    await notify(otherUserId(project, req.party), {
      type: 'dispute_opened', title: 'A dispute was opened',
      message: `${req.user.name || 'Your project partner'} opened a dispute about ${requirement.requirementId} in "${project.title}". Changes to it are frozen until an admin decides.`,
      link: `/${otherParty(req.party)}/change-requests/${project._id}`, email: true,
    });
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    await Promise.all(admins.map((a) => notify(a._id, {
      type: 'admin_review_needed', title: 'Dispute needs review',
      message: `A dispute was opened about ${requirement.requirementId} in "${project.title}".`, link: '/admin/disputes',
    })));

    res.status(201).json({ dispute });
  } catch (err) {
    console.error('[Dispute:raise]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/disputes/project/:projectId
exports.listForProject = async (req, res) => {
  try {
    const disputes = await Dispute.find({ project: req.project._id }).sort({ createdAt: -1 })
      .select('-evidence').populate('raisedBy', 'name role').lean();
    res.json({ disputes });
  } catch (err) {
    console.error('[Dispute:list]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/disputes/:id     (people in the project and admins)
exports.getOne = async (req, res) => {
  res.json({ dispute: req.dispute });
};

// POST /api/disputes/:id/resolve     admin only. body: { decision, note }
exports.resolve = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only an admin can decide a dispute.' });
    const { decision } = req.body;
    const note = clean(req.body.note);
    if (!DECISIONS.includes(decision)) return res.status(400).json({ message: `Decision must be one of: ${DECISIONS.join(', ')}.` });
    if (note.length < 5) return res.status(400).json({ message: 'Please write a short note explaining the decision.' });

    const updated = await Dispute.findOneAndUpdate(
      { _id: req.dispute._id, status: 'open' },
      { $set: { status: 'resolved', resolution: { decision, note, resolvedBy: req.user._id, resolvedAt: new Date() } } },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(409).json({ message: 'This dispute is already resolved.' });

    const words = { in_favour_client: 'in favour of the client', in_favour_freelancer: 'in favour of the freelancer', no_action: 'with no action needed' };
    await Promise.all(['client', 'freelancer'].map((role) => notify(req.project[role], {
      type: 'dispute_resolved', title: 'Dispute resolved',
      message: `An admin decided ${words[decision]} for ${updated.requirementId}. ${note}`,
      link: `/${role}/change-requests/${req.project._id}`, email: true,
    })));
    res.json({ dispute: updated });
  } catch (err) {
    console.error('[Dispute:resolve]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};