// src/middleware/projectAccess.js
// "Is this person really part of this project / meeting / requirement?"
// Every Module 3 route goes through one of these, so nobody can read or change
// another pair's meetings just by guessing an id.
//
// After they pass, the route can use:  req.project, req.meeting, req.requirement, req.party
//   req.party = 'client' | 'freelancer' | 'admin'
// Admins can read but never change anything.
const mongoose = require('mongoose');
const Project  = require('../models/Project');
const MeetingSession       = require('../models/MeetingSession');
const ExtractedRequirement = require('../models/ExtractedRequirement');

const idOf = (x) => String(x?._id || x);

function partyOf(project, user) {
  const me = String(user._id);
  if (idOf(project.client) === me) return 'client';
  if (idOf(project.freelancer) === me) return 'freelancer';
  if (user.role === 'admin') return 'admin';
  return null;
}

const bad = (res, label) => res.status(400).json({ message: `Invalid ${label} id.` });

// Checks the person against the project. Returns false (and answers) if not allowed.
function authorise(req, res, project, write) {
  const party = partyOf(project, req.user);
  if (!party) { res.status(403).json({ message: 'You are not part of this project.' }); return false; }
  if (write && party === 'admin') { res.status(403).json({ message: 'Admins have read-only access.' }); return false; }
  req.project = project;
  req.party = party;
  return true;
}

const fail = (res, label, err) => {
  console.error(`[Access:${label}]`, err.message);
  res.status(500).json({ message: 'Server error.' });
};

function loadProject(param = 'projectId', { write = false } = {}) {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 'project');
      const project = await Project.findById(id);
      if (!project) return res.status(404).json({ message: 'Project not found.' });
      if (!authorise(req, res, project, write)) return;
      next();
    } catch (err) { fail(res, 'project', err); }
  };
}

function loadMeeting(param = 'id', { write = false } = {}) {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 'meeting');
      const meeting = await MeetingSession.findById(id);
      if (!meeting) return res.status(404).json({ message: 'Meeting not found.' });
      const project = await Project.findById(meeting.project);
      if (!project) return res.status(404).json({ message: 'Project not found.' });
      if (!authorise(req, res, project, write)) return;
      req.meeting = meeting;
      next();
    } catch (err) { fail(res, 'meeting', err); }
  };
}

function loadRequirement(param = 'id', { write = false } = {}) {
  return async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return bad(res, 'requirement');
      const requirement = await ExtractedRequirement.findById(id);
      if (!requirement) return res.status(404).json({ message: 'Requirement not found.' });
      const project = await Project.findById(requirement.project);
      if (!project) return res.status(404).json({ message: 'Project not found.' });
      if (!authorise(req, res, project, write)) return;
      req.requirement = requirement;
      next();
    } catch (err) { fail(res, 'requirement', err); }
  };
}

module.exports = { loadProject, loadMeeting, loadRequirement, partyOf };