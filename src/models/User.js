// models/User.js
const mongoose = require("mongoose");

// ── Sub-schema: Portfolio Item ───────────────────────────────────────────────
const portfolioItemSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String },
  url:         { type: String },
  imageUrl:    { type: String },
  techStack:   [{ type: String }],
  addedAt:     { type: Date, default: Date.now },
});

// ── Sub-schema: Skill (AI extracted) ────────────────────────────────────────
const skillSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  source:     {
    type: String,
    enum: ["resume", "github", "linkedin", "manual", "bio"],
    default: "manual",
  },
  confidence: { type: Number, min: 0, max: 1 },
  verified:   { type: Boolean, default: false },
  addedAt:    { type: Date, default: Date.now },
});

// ── Sub-schema: Employer Verification Request ────────────────────────────────
const employerVerificationSchema = new mongoose.Schema({
  companyName:       { type: String, required: true },
  employerEmail:     { type: String, required: true },
  jobTitle:          { type: String },
  startDate:         { type: Date },
  endDate:           { type: Date },
  status: {
    type: String,
    enum: ["pending", "confirmed", "rejected"],
    default: "pending",
  },
  requestedAt:       { type: Date, default: Date.now },
  respondedAt:       { type: Date },
  verificationToken: { type: String },
  notes:             { type: String },
});

// ── Sub-schema: GitHub Stats ─────────────────────────────────────────────────
const githubStatsSchema = new mongoose.Schema({
  username:          { type: String },
  publicRepos:       { type: Number },
  followers:         { type: Number },
  topLanguages:      [{ type: String }],
  totalCommits:      { type: Number },
  contributionScore: { type: Number },
  lastFetchedAt:     { type: Date },
});

// ── Sub-schema: Trust Score ──────────────────────────────────────────────────
const trustScoreSchema = new mongoose.Schema({
  overall:           { type: Number, default: 0, min: 0, max: 100 },
  profileComplete:   { type: Number, default: 0 },
  behaviorScore:     { type: Number, default: 0 },
  verificationScore: { type: Number, default: 0 },
  feedbackScore:     { type: Number, default: 0 },
  lastUpdated:       { type: Date, default: Date.now },
});

// ── Sub-schema: Client Company ───────────────────────────────────────────────
const companyProfileSchema = new mongoose.Schema({
  companyName:    { type: String },
  industry:       { type: String },
  companySize:    {
    type: String,
    enum: ["1-10", "11-50", "51-200", "201-500", "500+"],
  },
  website:        { type: String },
  companyLogoUrl: { type: String },
  description:    { type: String },
  location:       { type: String },
});

// ════════════════════════════════════════════════════════════════════════════
//  MAIN USER SCHEMA
// ════════════════════════════════════════════════════════════════════════════
const userSchema = new mongoose.Schema(
  {
    // ── Core Identity ────────────────────────────────────────────────────────
    name:              { type: String, trim: true },
    email:             { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:          { type: String },
    passwordChangedAt: { type: Date },

    // ── Role ─────────────────────────────────────────────────────────────────
    // "admin" is in the enum so the field can store it, but NO registration
    // or update route should ever set role: "admin".
    // Only createAdmin.js (the seed script) can create an admin account.
    role: {
      type: String,
      enum: ["freelancer", "client", "admin"],
      required: true,
    },

    avatarUrl: { type: String },

    // ── Auth & Verification ──────────────────────────────────────────────────
    isVerified:       { type: Boolean, default: false },
    otp:              { type: String },
    otpExpiry:        { type: Date },
    authProvider: {
      type: String,
      enum: ["local", "google", "github"],
      default: "local",
    },
    googleId:          { type: String },
    githubId:          { type: String },
    githubUsername:    { type: String },
    githubAccessToken: { type: String },

    // ── Account Security ─────────────────────────────────────────────────────
    loginAttempts: { type: Number, default: 0 },
    lockUntil:     { type: Date },

    // ── Password Reset ───────────────────────────────────────────────────────
    resetPasswordToken:  { type: String },
    resetPasswordExpiry: { type: Date },

    // ── Basic Profile ────────────────────────────────────────────────────────
    headline:        { type: String },
    bio:             { type: String },
    location:        { type: String },
    phone:           { type: String },
    profileComplete: { type: Boolean, default: false },

    // ── Social & External Links ──────────────────────────────────────────────
    linkedinUrl: { type: String },
    githubUrl:   { type: String },
    websiteUrl:  { type: String },

    // ── Resume ───────────────────────────────────────────────────────────────
    resumeUrl:      { type: String },
    resumeText:     { type: String },
    resumeFileName: { type: String },

    // ── Skills ───────────────────────────────────────────────────────────────
    skills: [skillSchema],

    // ── GitHub Stats ─────────────────────────────────────────────────────────
    githubStats: { type: githubStatsSchema, default: () => ({}) },

    // ── Portfolio ────────────────────────────────────────────────────────────
    portfolio: [portfolioItemSchema],

    // ── Employer Verification ────────────────────────────────────────────────
    employerVerifications: [employerVerificationSchema],

    // ── Trust Score ──────────────────────────────────────────────────────────
    trustScore: { type: trustScoreSchema, default: () => ({}) },
    isFlagged:  { type: Boolean, default: false },
    flagReason: { type: String },

    // ── Client Company Profile ───────────────────────────────────────────────
    company: { type: companyProfileSchema, default: () => ({}) },

    // ── Account Status (used by admin panel) ─────────────────────────────────
    status: {
      type: String,
      enum: ["active", "pending", "suspended", "removed"],
      default: "active",
    },

    // Kept for backward compatibility with existing auth/middleware
    isActive:      { type: Boolean, default: true },
    isSuspended:   { type: Boolean, default: false },
    suspendReason: { type: String },
    isAdmin:       { type: Boolean, default: false },

    // ── Onboarding State ─────────────────────────────────────────────────────
    onboarding: {
      roleSelected:     { type: Boolean, default: false },
      emailVerified:    { type: Boolean, default: false },
      basicProfileDone: { type: Boolean, default: false },
      socialLinked:     { type: Boolean, default: false },
      aiProcessingDone: { type: Boolean, default: false },
      skillsReviewed:   { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

// ════════════════════════════════════════════════════════════════════════════
//  INDEXES
// ════════════════════════════════════════════════════════════════════════════
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ "trustScore.overall": -1 });
userSchema.index({ isFlagged: 1 });
userSchema.index({ isActive: 1, isSuspended: 1 });

// ════════════════════════════════════════════════════════════════════════════
//  PRE-SAVE GUARD — Mongoose v6/v7/v8 compatible (async, no next parameter)
//  Blocks any save() from setting role to "admin" unless __allowAdminRole
//  is set on the document (only User.createAdmin() does this).
// ════════════════════════════════════════════════════════════════════════════
userSchema.pre("save", async function () {
  if (this.role === "admin" && !this.__allowAdminRole) {
    throw new Error("Setting role to 'admin' is not permitted through normal save operations.");
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  STATIC — createAdmin()
//  The ONLY authorised way to create an admin account.
//  Called exclusively by the seed script (createAdmin.js).
// ════════════════════════════════════════════════════════════════════════════
userSchema.statics.createAdmin = async function ({ name, email, hashedPassword }) {
  const doc = new this({
    name,
    email,
    password:     hashedPassword,
    role:         "admin",
    status:       "active",
    isVerified:   true,
    isActive:     true,
    isAdmin:      true,
    authProvider: "local",
  });
  doc.__allowAdminRole = true; // bypass the pre-save guard
  return doc.save();
};

// ════════════════════════════════════════════════════════════════════════════
//  VIRTUAL — isLocked
// ════════════════════════════════════════════════════════════════════════════
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ════════════════════════════════════════════════════════════════════════════
//  VIRTUAL — profileCompletionPercent
// ════════════════════════════════════════════════════════════════════════════
userSchema.virtual("profileCompletionPercent").get(function () {
  const fields = [
    this.name,
    this.avatarUrl,
    this.headline,
    this.bio,
    this.location,
    this.linkedinUrl || this.githubUrl,
    this.resumeUrl,
    this.skills?.length > 0,
    this.portfolio?.length > 0,
  ];
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
});

// ════════════════════════════════════════════════════════════════════════════
//  METHOD — toSafeObject()
// ════════════════════════════════════════════════════════════════════════════
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  delete obj.otp;
  delete obj.otpExpiry;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpiry;
  delete obj.loginAttempts;
  delete obj.lockUntil;
  delete obj.githubAccessToken;
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model("User", userSchema);