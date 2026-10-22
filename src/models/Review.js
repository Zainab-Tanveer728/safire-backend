// src/models/Review.js  (NEW)
// One person's review of the other person on ONE finished project. Both sides review each other (like Upwork).
const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  project:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  reviewee: { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  revieweeRole: { type: String, enum: ['client', 'freelancer'], required: true },   // who is being reviewed
  rating:   { type: Number, required: true, min: 1, max: 5 },                       // overall stars
  // optional extra stars. Client -> freelancer: quality, communication, deadlines.  Freelancer -> client: clarity, communication, responsiveness.
  aspects:  { type: Map, of: Number },
  comment:  { type: String, trim: true, maxlength: 1000 },
  reply:    { text: { type: String, trim: true, maxlength: 600 }, at: { type: Date } },   // the reviewed person may answer once

  // Double-blind: a review stays hidden until the other person has also reviewed, or until publishAt (14 days after
  // the project was completed), whichever comes first. This stops "revenge" reviews.
  published: { type: Boolean, default: false },
  hidden:    { type: Boolean },                                   // set by an admin after a report; hidden reviews are not shown or counted
  reports:   [{ by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reason: { type: String, trim: true, maxlength: 300 }, at: { type: Date, default: Date.now } }],
  publishAt: { type: Date, required: true },
}, { timestamps: true });

reviewSchema.index({ project: 1, reviewer: 1 }, { unique: true });      // one review per person per project
reviewSchema.index({ reviewee: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);