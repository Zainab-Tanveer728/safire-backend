// src/models/MeetingTranscript.js
// Cleaned, speaker-labelled transcript produced by the ASR step (Whisper).
const mongoose = require('mongoose');

const meetingTranscriptSchema = new mongoose.Schema({
  meetingSession: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingSession', required: true, unique: true },

  audioDuration:     { type: Number },                   // seconds
  rawTranscript:     { type: String },                   // before cleaning
  cleanedTranscript: { type: String },                   // filler words removed
  confidenceScore:   { type: Number },                   // 0-100
  isLowConfidence:   { type: Boolean, default: false },  // < 70 after one retry

  segments: [{
    segmentId:  { type: String },                        // 'S1', 'S2'... requirements point back to this
    speaker:    { type: String, enum: ['Client', 'Freelancer'] },
    startTime:  { type: Number },                        // seconds from meeting start
    endTime:    { type: Number },
    text:       { type: String },
    confidence: { type: Number },
  }],

  asrEngine:    { type: String, default: 'whisper' },
  modelVersion: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('MeetingTranscript', meetingTranscriptSchema);