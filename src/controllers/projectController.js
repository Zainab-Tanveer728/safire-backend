// src/controllers/projectController.js
const mongoose = require('mongoose');
const Project  = require('../models/Project');
const User     = require('../models/User');
const MeetingSession       = require('../models/MeetingSession');
const ExtractedRequirement = require('../models/ExtractedRequirement');
const { notify } = require('../services/notificationService');

// Fields of the other person that the pages are allowed to see
const PERSON_FIELDS =
  'name email avatarUrl role headline location trustScore.overall company.companyName company.companyLogoUrl';

const idOf = (x) => String(x?._id || x);

function canAccess(project, user) {
  if (user.role === 'admin') return true;
  const me = String(user._id);
  return idOf(project.client) === me || idOf(project.freelancer) === me;
}

// POST /api/projects   (client only)
// Body: { title, description, skills, freelancerEmail, deadline, budget, currency }
// Temporary stand-in for Module 5 (job post -> apply -> hire).
exports.createProject = async (req, res) => {
  try {
    const { title, description, skills, freelancerEmail, deadline, budget, currency } = req.body;

    if (!title || !title.trim())
      return res.status(400).json({ message: 'Project title is required.' });
    if (!freelancerEmail)
      return res.status(400).json({ message: 'Freelancer email is required.' });

    const freelancer = await User.findOne({
      email:  String(freelancerEmail).trim().toLowerCase(),
      role:   'freelancer',
      status: { $nin: ['suspended', 'removed'] },
    });
    if (!freelancer)
      return res.status(404).json({ message: 'No active freelancer found with that email.' });

    const skillList = Array.isArray(skills) ? skills : String(skills || '').split(',');

    const project = await Project.create({
      client:      req.user._id,
      freelancer:  freelancer._id,
      title:       title.trim(),
      description: description || '',
      skills:      skillList.map((s) => String(s).trim()).filter(Boolean),
      status:      'active',
      startDate:   new Date(),
      deadline:    deadline ? new Date(deadline) : undefined,
      budget:      budget !== undefined && budget !== '' ? Number(budget) : undefined,
      currency:    currency || 'USD',
    });

    await notify(freelancer._id, {
      type:    'project_created',
      title:   'New project assigned to you',
      message: `${req.user.name || 'A client'} started the project "${project.title}" with you.`,
      link:    `/freelancer/project/${project._id}`,
      email:   true,
    });

    res.status(201).json({ project });
  } catch (err) {
    console.error('[Project:create]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/projects   -> my projects (client, freelancer, or all for admin)
exports.listMyProjects = async (req, res) => {
  try {
    const filter =
      req.user.role === 'client'     ? { client: req.user._id } :
      req.user.role === 'freelancer' ? { freelancer: req.user._id } : {};

    const projects = await Project.find(filter)
      .populate('client',     PERSON_FIELDS)
      .populate('freelancer', PERSON_FIELDS)
      .sort({ updatedAt: -1 });

    // How many requirements are waiting for review, per project
    const pending = await ExtractedRequirement.aggregate([
      { $match: { project: { $in: projects.map((p) => p._id) }, status: 'pending_review' } },
      { $group: { _id: '$project', n: { $sum: 1 } } },
    ]);
    const pendingMap = Object.fromEntries(pending.map((x) => [String(x._id), x.n]));

    res.json({
      projects: projects.map((p) => ({
        ...p.toObject(),
        pendingReview: pendingMap[String(p._id)] || 0,
      })),
    });
  } catch (err) {
    console.error('[Project:list]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/projects/:id   -> everything the Project Details page (M22) needs
exports.getProject = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id))
      return res.status(400).json({ message: 'Invalid project id.' });

    const project = await Project.findById(req.params.id)
      .populate('client',     PERSON_FIELDS)
      .populate('freelancer', PERSON_FIELDS);

    if (!project) return res.status(404).json({ message: 'Project not found.' });
    if (!canAccess(project, req.user))
      return res.status(403).json({ message: 'You are not part of this project.' });

    const [meetingCount, lastMeeting, reqCounts] = await Promise.all([
      MeetingSession.countDocuments({ project: project._id }),
      MeetingSession.findOne({ project: project._id })
        .sort({ createdAt: -1 })
        .select('title status actualStartAt durationSec transcriptionStatus extractionStatus'),
      ExtractedRequirement.aggregate([
        { $match: { project: project._id } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
    ]);

    const requirements = { pending_review: 0, confirmed: 0, rejected: 0, locked: 0, total: 0 };
    reqCounts.forEach((r) => { requirements[r._id] = r.n; requirements.total += r.n; });

    res.json({
      project,
      stats: { meetings: meetingCount, lastMeeting, requirements },
    });
  } catch (err) {
    console.error('[Project:get]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};