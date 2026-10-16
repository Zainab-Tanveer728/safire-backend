// src/models/ChangeHistory.js   (Module 5)
// IMMUTABLE record of every approved change: what it said before, what it says now, who approved.
// Used as evidence in disputes. Documents can be created but never changed or deleted.
const mongoose = require('mongoose');

const changeHistorySchema = new mongoose.Schema({
  project:       { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  requirement:   { type: mongoose.Schema.Types.ObjectId, ref: 'ExtractedRequirement', required: true },
  requirementId: { type: String },
  changeRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'ChangeRequest', required: true },
  crNumber:      { type: Number },

  beforeText: { type: String },
  afterText:  { type: String },
  beforeType: { type: String },
  afterType:  { type: String },
  reason:     { type: String },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  approvedBy: [{
    _id: false,
    user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role:       { type: String },
    approvedAt: { type: Date },
  }],
  appliedAt: { type: Date, default: Date.now },
}, { timestamps: { createdAt: true, updatedAt: false } });

changeHistorySchema.index({ project: 1, appliedAt: -1 });
changeHistorySchema.index({ requirement: 1, appliedAt: 1 });

const locked = () => { throw new Error('Change history is read-only.'); };
changeHistorySchema.pre('save', function onSave() { if (!this.isNew) locked(); });   // no next(): works on every Mongoose version
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach((op) => changeHistorySchema.pre(op, locked));

module.exports = mongoose.model('ChangeHistory', changeHistorySchema);