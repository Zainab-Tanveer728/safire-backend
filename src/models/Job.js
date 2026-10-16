// src/models/Job.js  (NEW)
// A job a client posts. Freelancers apply; hiring one creates a Project (Module 3 starts from there).
const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  client:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  skills:      [{ type: String, trim: true }],
  category:    { type: String, trim: true },
  budgetMin:   { type: Number, min: 0 },
  budgetMax:   { type: Number, min: 0 },
  currency:    { type: String, default: 'USD' },
  deadline:    { type: Date },
  startDate:   { type: Date },
  engagementType:  { type: String, enum: ['fixed', 'hourly'], default: 'fixed' },
  experienceLevel: { type: String, enum: ['junior', 'mid', 'senior'] },
  additionalRequirements: { type: String, trim: true, maxlength: 2000 },

  // draft (saved, not public) -> open -> in_progress (a freelancer was hired) | closed (closed without hiring)
  status:      { type: String, enum: ['draft', 'open', 'in_progress', 'closed'], default: 'open' },
  hiredFreelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  project:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
}, { timestamps: true });

jobSchema.index({ client: 1, createdAt: -1 });
jobSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Job', jobSchema);