const mongoose = require('mongoose');

const gigOptimizationSchema = new mongoose.Schema(
  {
    user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    gigType:         { type: String, required: true },
    experienceLevel: { type: String, enum: ['Beginner', 'Intermediate', 'Expert'], default: 'Intermediate' },
    skills:          [String],
    result:          { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GigOptimization', gigOptimizationSchema);