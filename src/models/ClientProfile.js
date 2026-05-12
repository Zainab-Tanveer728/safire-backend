// models/ClientProfile.js
const mongoose = require("mongoose");

const clientProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Company details (M12)
    companyName: {
      type: String,
      trim: true,
      default: null,
    },
    jobTitle: {
      type: String,
      trim: true,
      default: null,
    },
    logo: {
      type: String,   // relative path: /uploads/logos/<filename>
      default: null,
    },
    website: {
      type: String,
      default: null,
    },
    industry: {
      type: String,
      default: null,
    },
    companySize: {
      type: String,
      enum: ["1-10", "11-50", "51-200", "201-500", "500+", null],
      default: null,
    },
    country: {
      type: String,
      default: null,
    },
    about: {
      type: String,
      maxlength: 400,
      default: null,
    },

    // Onboarding flags (M13)
    companyProfileComplete: {
      type: Boolean,
      default: false,
    },

    // Trust score — set by AI service after onboarding
    trustScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    trustScoreBreakdown: {
      emailVerified: { type: Number, default: 0 },
      companyProfileFilled: { type: Number, default: 0 },
      websiteVerified: { type: Number, default: 0 },
      activityScore: { type: Number, default: 0 },
    },
    trustScoreLastUpdated: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: trust label
clientProfileSchema.virtual("trustLabel").get(function () {
  if (this.trustScore >= 75) return "High Trust";
  if (this.trustScore >= 50) return "Moderate Trust";
  return "Low Trust";
});

module.exports = mongoose.model("ClientProfile", clientProfileSchema);