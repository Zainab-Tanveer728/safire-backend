// src/models/MeetingSession.js
// One client-freelancer meeting. Lifecycle: scheduled -> active -> completed | interrupted.
// The audio + AI pipeline status lives here so the pages can poll one document.
const mongoose = require('mongoose');

const meetingSessionSchema = new mongoose.Schema({
  project:      { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  title:        { type: String, default: 'Requirements meeting' },
  initiatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  status: {
    type: String,
    enum: ['scheduled', 'active', 'completed', 'interrupted'],
    default: 'scheduled',
  },
  scheduledAt:   { type: Date },
  actualStartAt: { type: Date },
  actualEndAt:   { type: Date },
  durationSec:   { type: Number },                       // auto-calculated on end (FR24.1)

  // WebRTC
  sessionToken: { type: String },
  roomUrl:      { type: String },

  // Consent (FR23.7): recording may start only when BOTH users have consented
  consents: [{
    user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    consentedAt: { type: Date, default: Date.now },
  }],

  // One audio file per participant -> speaker label is known without diarisation
  audioTracks: [{
    user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role:        { type: String, enum: ['client', 'freelancer'] },
    key:         { type: String },                         // storage key, never a URL
    offsetMs:    { type: Number, default: 0 },             // when this track started vs the meeting
    durationSec: { type: Number },
  }],
  audioStored: { type: Boolean, default: false },

  // Pipeline status
  transcriptionStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'low_confidence', 'failed'],
    default: 'pending',
  },
  extractionStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  processingError: { type: String },

  reviewComplete: { type: Boolean, default: false },

  // Share transcript link (FR24.5): expires after 7 days
  shareToken:     { type: String },
  shareExpiresAt: { type: Date },
}, { timestamps: true });

meetingSessionSchema.index({ project: 1, createdAt: -1 });
meetingSessionSchema.index({ shareToken: 1 }, { sparse: true });

module.exports = mongoose.model('MeetingSession', meetingSessionSchema);