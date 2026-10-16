// src/models/RequirementHistory.js
// Append-only audit log. Never update or delete documents in this collection.
const mongoose = require('mongoose');

const requirementHistorySchema = new mongoose.Schema({
  requirement: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractedRequirement', required: true },
  project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  changedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changeType:  { type: String, enum: ['edit', 'status_change', 'revert'], required: true },
  beforeText:  { type: String },
  afterText:   { type: String },
  beforeStatus:{ type: String },
  afterStatus: { type: String },
  reason:      { type: String },
  timestamp:   { type: Date, default: Date.now },
});

requirementHistorySchema.index({ requirement: 1, timestamp: -1 });

module.exports = mongoose.model('RequirementHistory', requirementHistorySchema);