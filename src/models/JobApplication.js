// src/models/JobApplication.js  (NEW)
// One freelancer's application to one job. (Your older proposal.js is the AI proposal generator's
// saved text and is left untouched; its text can be pasted into coverLetter.)
const mongoose = require('mongoose');

const jobApplicationSchema = new mongoose.Schema({
  job:        { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coverLetter:    { type: String, required: true, trim: true, maxlength: 4000 },
  proposedBudget: { type: Number, min: 0 },
  estimatedDays:  { type: Number, min: 1 },
  status: { type: String, enum: ['pending', 'shortlisted', 'accepted', 'rejected', 'withdrawn'], default: 'pending' },
}, { timestamps: true });

// one application per freelancer per job
jobApplicationSchema.index({ job: 1, freelancer: 1 }, { unique: true });
jobApplicationSchema.index({ freelancer: 1, createdAt: -1 });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);