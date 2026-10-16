const mongoose = require('mongoose');

const skillGapSchema = new mongoose.Schema({
  freelancer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  targetRole: { type: String, required: true },
  roleId:     { type: String },

  overallMatchScore: { type: Number },
  scoreBand:         { type: String, enum: ['green', 'yellow', 'red'] },
  confidence:        { type: Number },            // AI confidence 0-100
  sourcesUsed:       [{ type: String }],          // profile | resume | github
  skillsAnalyzed:    { type: Number },
  processingMs:      { type: Number },
  warnings:          [{ type: String }],
  aiGenerated:       { type: Boolean, default: true },
  aiModel:           { type: String },

  // Kept as before, so older code that reads these keeps working
  strongSkills:  [{ name: String, proficiency: Number }],
  weakSkills:    [{ name: String, proficiency: Number }],
  missingSkills: [{ name: String, importance: String }],   // importance = Critical | Important | Optional
  recommendations: [{ skill: String, tier: String, status: String, course: String, platform: String, url: String }],

  // The complete result exactly as the frontend shows it, so an old report can be re-displayed as it was
  fullResult: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

skillGapSchema.index({ freelancer: 1, createdAt: -1 });

// "||" guards against OverwriteModelError if this file is loaded twice (file-name case differences on Windows)
module.exports = mongoose.models.SkillGapReport || mongoose.model('SkillGapReport', skillGapSchema);