// src/models/ExtractedRequirement.js
// One requirement found by RoBERTa. Lifecycle: pending_review -> confirmed | rejected -> locked (Module 5).
const mongoose = require('mongoose');

const extractedRequirementSchema = new mongoose.Schema({
  meetingSession: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingSession', required: true },
  project:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },

  // 'RQ-001'. Unique PER PROJECT (see index below). A global unique here would
  // make the second project fail on its first requirement.
  requirementId:  { type: String, required: true },

  type: { type: String, enum: ['functional', 'non-functional'], required: true },
  text: { type: String, required: true },

  sourceSegmentId: { type: String },                     // links back to the transcript segment
  confidenceScore: { type: Number },                     // 0-100
  modelVersion:    { type: String },
  source:          { type: String, enum: ['ai', 'manual'], default: 'ai' },

  status: {
    type: String,
    enum: ['pending_review', 'confirmed', 'rejected', 'locked'],
    default: 'pending_review',
  },
  reviewedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt:      { type: Date },
  rejectionReason: { type: String },                     // kept as a training signal
}, { timestamps: true });

extractedRequirementSchema.index({ project: 1, requirementId: 1 }, { unique: true });
extractedRequirementSchema.index({ meetingSession: 1, status: 1 });

module.exports = mongoose.model('ExtractedRequirement', extractedRequirementSchema);