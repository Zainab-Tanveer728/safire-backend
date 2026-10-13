const mongoose = require('mongoose');

// One entry per suggested edit ("tracked change")
const changeSchema = new mongoose.Schema({
  id:       { type: String },                                   // c1, c2 ...
  type:     { type: String, enum: ['wording', 'keyword'] },
  original: { type: String },
  improved: { type: String },
  reason:   { type: String },
  status:   { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
}, { _id: false });

const scoresSchema = new mongoose.Schema({
  overall:   { type: Number },
  keywords:  { type: Number, default: null },   // null = no target role, so keywords were not scored
  structure: { type: Number },
  content:   { type: Number },
}, { _id: false });

// Every enhancement is saved as its own version. The original text is never overwritten.
const resumeVersionSchema = new mongoose.Schema({
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sourceType: { type: String, enum: ['upload', 'paste'], default: 'paste' },
  fileName:   { type: String },
  targetRoles: [{ type: String }],

  originalText: { type: String },
  enhancedText: { type: String },               // original + every suggested edit applied
  finalText:    { type: String },               // what the freelancer finally kept (set by "apply")

  scores:      { before: scoresSchema, after: scoresSchema, final: scoresSchema },
  changes:     [changeSchema],
  suggestions: { type: mongoose.Schema.Types.Mixed },
  confidence:  { type: Number },
  aiGenerated: { type: Boolean, default: true },

  // How many edits the freelancer kept / dropped: a feedback signal for improving the AI later
  feedback:   { accepted: { type: Number, default: 0 }, rejected: { type: Number, default: 0 } },
  activated:  { type: Boolean, default: false },  // true once it was saved as the active resume

  fullResult: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

resumeVersionSchema.index({ freelancer: 1, createdAt: -1 });

module.exports = mongoose.models.ResumeVersion || mongoose.model('ResumeVersion', resumeVersionSchema);