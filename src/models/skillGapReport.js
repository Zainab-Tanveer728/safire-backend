const mongoose = require('mongoose');

const skillGapSchema = new mongoose.Schema({
  freelancer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  targetRole: { type: String, required: true },
  overallMatchScore: { type: Number },
  strongSkills: [{ name: String, proficiency: Number }],
  weakSkills:   [{ name: String, proficiency: Number }],
  missingSkills:[{ name: String, importance: String }],
  recommendations: [{ skill: String, course: String, platform: String, url: String }],
}, { timestamps: true });

module.exports = mongoose.model('SkillGapReport', skillGapSchema);
