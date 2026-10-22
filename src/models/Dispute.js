// src/models/Dispute.js   (Module 5 -> Module 6)
// Raised by the client or the freelancer about one requirement. It freezes that requirement
// (no new change requests, no approvals) until an admin records a decision.
const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
  project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  requirement: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractedRequirement', required: true },
  requirementId: { type: String },
  raisedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  raisedByRole:{ type: String, enum: ['client', 'freelancer'] },
  reason:      { type: String, required: true },

  status: { type: String, enum: ['open', 'resolved'], default: 'open' },

  // A copy of the evidence at the moment the dispute was raised (timeline, approvers).
  evidence: { type: mongoose.Schema.Types.Mixed },

  resolution: {
    decision:   { type: String, enum: ['in_favour_client', 'in_favour_freelancer', 'enforce_baseline', 'no_action', 'terminate_project'] },
    note:       { type: String },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
  },
}, { timestamps: true });

disputeSchema.index({ project: 1, createdAt: -1 });
disputeSchema.index({ requirement: 1, status: 1 });

module.exports = mongoose.model('Dispute', disputeSchema);