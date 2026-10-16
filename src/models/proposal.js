const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema({
  version:   { type: Number, required: true },
  text:      { type: String, required: true },
  source:    { type: String, enum: ['model', 'template', 'edited'], default: 'model' },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const proposalSchema = new mongoose.Schema({
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  jobTitle: { type: String, trim: true },
  jobDescription: { type: String, required: true },
  profileHighlights: { type: String },
  tone: { type: String, enum: ['professional', 'friendly', 'concise'], default: 'professional' },

  generatedProposal: { type: String },          // current text (latest version)
  generationSource: { type: String, enum: ['model', 'template', 'edited'], default: 'model' },
  versions: [versionSchema],                     // full history
  version: { type: Number, default: 1 },         // current version number

  status: { type: String, enum: ['draft', 'submitted', 'accepted', 'rejected'], default: 'draft' },
  submittedAt: { type: Date },
}, { timestamps: true });

proposalSchema.index({ freelancer: 1, createdAt: -1 });

module.exports = mongoose.model('Proposal', proposalSchema);