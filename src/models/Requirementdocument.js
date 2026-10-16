// src/models/RequirementDocument.js
// AI summary, meeting notes and user stories for one meeting (FR25.7, FR26.1).
const mongoose = require('mongoose');

const requirementDocumentSchema = new mongoose.Schema({
  project:        { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  meetingSession: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingSession', required: true, unique: true },

  summary: {
    text:            { type: String },
    focusAreas:      [{ type: String }],
    ambiguities:     [{ type: String }],                 // flagged by the AI
    recommendations: [{ type: String }],
    editedByUser:    { type: Boolean, default: false },  // summary is editable before approval
  },
  meetingNotes: { type: String },

  userStories: [{
    requirement:        { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractedRequirement' },
    text:               { type: String },                // "As a ..., I want ..., so that ..."
    acceptanceCriteria: [{ type: String }],
    // Module 5: set when the requirement behind this story was changed by an approved change request
    outdated:           { type: Boolean, default: false },
    outdatedReason:     { type: String },
  }],
}, { timestamps: true });

// module.exports = mongoose.model('RequirementDocument', requirementDocumentSchema);
module.exports =
  mongoose.models.RequirementDocument ||
  mongoose.model('RequirementDocument', requirementDocumentSchema);