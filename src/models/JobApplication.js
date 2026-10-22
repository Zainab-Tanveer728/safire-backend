// src/models/JobApplication.js  (REPLACE the earlier version)
// One freelancer's relationship with one job: invited -> pending -> shortlisted -> offered -> accepted
const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  message:     { type: String, trim: true, maxlength: 2000 },     // scope / what the client expects
  startDate:   { type: Date },
  deadline:    { type: Date },
  agreedBudget:{ type: Number, min: 0 },
  sentAt:      { type: Date },
  expiresAt:   { type: Date },                                    // the freelancer must answer before this
  declineReason: { type: String, trim: true, maxlength: 500 },
  respondedAt: { type: Date },
  withdrawnAt: { type: Date },
  expiredAt:   { type: Date },
}, { _id: false });

const jobApplicationSchema = new mongoose.Schema({
  job:        { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // not needed while the row is only an invitation (the freelancer has not written a proposal yet)
  coverLetter:    { type: String, trim: true, maxlength: 4000, required() { return this.status !== 'invited'; } },
  proposedBudget: { type: Number, min: 0 },
  estimatedDays:  { type: Number, min: 1 },
  answers: [{ _id: false, question: String, answer: { type: String, trim: true, maxlength: 2000 } }],

  // invited   - the client invited the freelancer from the directory; waiting for a proposal or a decline
  // pending   - proposal sent, the client has not decided
  // shortlisted - client likes it   offered - formal offer sent, waiting for the freelancer
  // accepted  - freelancer accepted the offer (project exists)   declined - freelancer declined an invitation/offer
  // rejected  - client said no / job closed / job given to someone else   withdrawn - freelancer withdrew
  status: { type: String, enum: ['invited', 'pending', 'shortlisted', 'offered', 'accepted', 'declined', 'rejected', 'withdrawn'], default: 'pending' },

  invitationMessage: { type: String, trim: true, maxlength: 1000 },
  viewedAt: { type: Date },                       // the client opened this proposal (the freelancer sees "Viewed")
  offer: { type: offerSchema },
  offerSlot: { type: mongoose.Schema.Types.ObjectId },   // = job while an offer is waiting; removed afterwards
  messages: [{ sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, system: { type: Boolean }, text: { type: String, trim: true, maxlength: 2000 }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true });

// one application per freelancer per job
jobApplicationSchema.index({ job: 1, freelancer: 1 }, { unique: true });
jobApplicationSchema.index({ freelancer: 1, createdAt: -1 });
// only ONE live offer per job: the database refuses a second "offered" row for the same job
// (offerSlot holds the job id only while status is 'offered'; a sparse unique index then allows one per job)
jobApplicationSchema.index({ offerSlot: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('JobApplication', jobApplicationSchema);