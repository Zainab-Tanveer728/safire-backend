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
  status: {
    type: String,
    enum: ['active', 'paused', 'completed', 'disputed', 'cancelled'],
    default: 'active',
  },
  startDate:   { type: Date },
  deadline:    { type: Date },
  budget:      { type: Number },
  currency:    { type: String, default: 'USD' },
  job:         { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },   // the job this project came from (one project per job)
  contractUrl: { type: String },

  requirementsLocked: { type: Boolean, default: false },
  requirementDocUrl:  { type: String },                  // locked PDF (Module 5)

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