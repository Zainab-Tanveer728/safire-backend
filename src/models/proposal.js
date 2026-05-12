const mongoose = require('mongoose');

const proposalSchema = new mongoose.Schema({
  freelancer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  jobTitle: { type: String },
  jobDescription: { type: String, required: true },
  profileHighlights: { type: String },
  tone: {
    type: String,
    enum: ['professional', 'friendly', 'concise'],
    default: 'professional',
  },
  generatedProposal: { type: String },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'accepted', 'rejected'],
    default: 'draft',
  },
  version: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model('Proposal', proposalSchema);
