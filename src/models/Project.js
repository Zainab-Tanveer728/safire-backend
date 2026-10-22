// src/models/Project.js
// An active engagement between one client and one freelancer.
// Module 3 reads it (M22) and Module 5 locks its requirements.
const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
  client:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String },
  skills:      [{ type: String }],                       // tags shown on M22 (React.js, UI/UX...)
  // completed  = the work was accepted (client accepted it, or the 7-day review time ended)
  // cancelled  = one person asked and the OTHER person agreed
  // terminated = an admin ended it after a dispute (not a mutual decision)
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'disputed', 'cancelled', 'terminated'],
    default: 'active',
  },
  startDate:   { type: Date },
  completedAt: { type: Date },                           // set when the project is completed (opens reviews; the 14-day review time counts from here)
  deadline:    { type: Date },
  budget:      { type: Number },
  currency:    { type: String, default: 'USD' },
  job:         { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },   // the job this project came from (one project per job)
  contractUrl: { type: String },

  requirementsLocked: { type: Boolean, default: false },
  requirementDocUrl:  { type: String },                  // locked PDF (Module 5)
  baselineVersion:    { type: Number, default: 0 },      // 1 after BOTH people approve the first baseline
  // Both people must approve the SAME list of requirements before it is locked. 'hash' is a fingerprint of that list,
  // so an approval given before somebody edited a requirement does not count any more.
  baselineApprovals: {
    client:     { at: { type: Date }, hash: { type: String } },
    freelancer: { at: { type: Date }, hash: { type: String } },
  },

  // Work handed over by the freelancer. The client has reviewDueAt to answer; every submission/revision is kept.
  deliveries: [{
    n:            { type: Number },                      // 1, 2, 3... (a delivery is changed by its position, n-1)
    note:         { type: String, trim: true, maxlength: 2000 },
    url:          { type: String, trim: true },
    fileKey:      { type: String, select: false },
    fileName:     { type: String, trim: true, maxlength: 255 },
    submittedAt:  { type: Date, default: Date.now },
    reviewDueAt:  { type: Date },
    status:       { type: String, enum: ['submitted', 'accepted', 'revision_requested', 'auto_accepted'], default: 'submitted' },
    response:     { type: String, trim: true, maxlength: 1000 },
    respondedAt:  { type: Date },
    reminderSent: { type: Boolean },
  }],

  // "I want to end this project". Cancelling needs the OTHER person to agree; silence is never agreement
  // (after 7 days with no answer an admin is asked to look).
  cancelRequest: {
    by:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    byRole:      { type: String, enum: ['client', 'freelancer'] },
    reason:      { type: String, trim: true, maxlength: 1000 },
    at:          { type: Date },
    status:      { type: String, enum: ['pending', 'accepted', 'declined', 'withdrawn', 'escalated'] },
    respondedAt: { type: Date },
    escalatedAt: { type: Date },
    note:        { type: String, trim: true, maxlength: 500 },
  },
  endedAt:   { type: Date },                             // when it was cancelled or terminated
  endReason: { type: String },
  endedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  milestones: [{
    title:       { type: String },
    description: { type: String },
    dueDate:     { type: Date },
    status:      { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
    amount:      { type: Number },
  }],
}, { timestamps: true });

projectSchema.index({ client: 1 });
projectSchema.index({ freelancer: 1 });
// Hiring twice for the same job is impossible: the database refuses a second project with the same job.
projectSchema.index({ job: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Project', projectSchema);