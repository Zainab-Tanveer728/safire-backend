// src/middleware/changeRequestAccess.js
// Same idea as projectAccess.js: "is this person really part of the project this change request / dispute belongs to?"
// After it passes:  req.changeRequest (or req.dispute), req.project, req.party
const mongoose = require('mongoose');
const Project       = require('../models/Project');
const ChangeRequest = require('../models/ChangeRequest');
const Dispute       = require('../models/Dispute');
const { partyOf }   = require('./projectAccess');

function loader(Model, label, key) {
  return (param = 'id', { write = false } = {}) => async (req, res, next) => {
    try {
      const id = req.params[param];
      if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: `Invalid ${label} id.` });
      const doc = await Model.findById(id);
      if (!doc) return res.status(404).json({ message: `${label[0].toUpperCase()}${label.slice(1)} not found.` });
      const project = await Project.findById(doc.project);
      if (!project) return res.status(404).json({ message: 'Project not found.' });

      const party = partyOf(project, req.user);
      if (!party) return res.status(403).json({ message: 'You are not part of this project.' });
      if (write && party === 'admin') return res.status(403).json({ message: 'Admins have read-only access.' });

      req[key] = doc; req.project = project; req.party = party;
      next();
    } catch (err) {
      console.error(`[Access:${label}]`, err.message);
      res.status(500).json({ message: 'Server error.' });
    }
  };
}

module.exports = {
  loadChangeRequest: loader(ChangeRequest, 'change request', 'changeRequest'),
  loadDispute:       loader(Dispute, 'dispute', 'dispute'),
};