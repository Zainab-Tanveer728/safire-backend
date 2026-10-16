// src/models/ChangeRequest.js   (Module 5, M35)
// A request to change ONE confirmed requirement. Both the client and the freelancer must approve it.
//
//   pending -> awaiting_second_approval -> approved
//        \-> rejected (by either person, with a reason)
//        \-> stalled  (no activity for 7 + 3 days; shown to admins)
const mongoose = require('mongoose');

const OPEN_STATUSES = ['pending', 'awaiting_second_approval', 'stalled'];

const changeRequestSchema = new mongoose.Schema({
  // CR-1001, CR-1002 ... unique across the whole platform (FR35.3)
  number:      { type: Number, required: true, unique: true },

  project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  requirement: { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractedRequirement', required: true },
  requirementId: { type: String },                     // 'RQ-003' copied here so lists never need a join

  requestedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requesterRole: { type: String, enum: ['client', 'freelancer'], required: true },

  // what the requirement said when the request was made (kept even after the change is applied)
  beforeText:   { type: String },
  beforeType:   { type: String },
  proposedText: { type: String, required: true },      // read-only after submission (FR35.12)
  proposedType: { type: String, enum: ['functional', 'non-functional'] },
  reason:       { type: String },

  status: {
    type: String,
    enum: ['pending', 'awaiting_second_approval', 'approved', 'rejected', 'stalled'],
    default: 'pending',
  },

  approvals: [{
    _id: false,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role:       { type: String, enum: ['client', 'freelancer'] },
    approvedAt: { type: Date, default: Date.now },
  }],

  rejectedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectedAt:      { type: Date },
  rejectionReason: { type: String },

  lastActivity:   { type: Date, default: Date.now },
  reminderSentAt: { type: Date },                      // 7 days of silence -> reminder
  stalledAt:      { type: Date },                      // 3 more days of silence -> admin queue
  appliedAt:      { type: Date },

  discussion: [{
    author:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authorRole: { type: String, enum: ['client', 'freelancer'] },
    text:       { type: String },
    postedAt:   { type: Date, default: Date.now },
  }],
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

changeRequestSchema.virtual('crId').get(function crId() { return `CR-${this.number}`; });

changeRequestSchema.index({ project: 1, createdAt: -1 });
changeRequestSchema.index({ requirement: 1, status: 1 });
changeRequestSchema.index({ status: 1, lastActivity: 1 });      // the 7-day sweep

module.exports = mongoose.model('ChangeRequest', changeRequestSchema);
module.exports.OPEN_STATUSES = OPEN_STATUSES;