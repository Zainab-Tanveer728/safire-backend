const mongoose = require("mongoose");
// ── Sub-schema: Portfolio Item (M3/M5) ───────────────────────────────────────
const portfolioItemSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String },
  url:         { type: String },          // live link
  imageUrl:    { type: String },          // screenshot
  techStack:   [{ type: String }],        // ["React", "Node.js"]
  addedAt:     { type: Date, default: Date.now },
});

// ── Sub-schema: Skill (M1 FE-5 — AI extracted) ───────────────────────────────
const skillSchema = new mongoose.Schema({
  name:       { type: String, required: true },  // "React"
  source:     {
    type: String,
    enum: ["resume", "github", "linkedin", "manual", "bio"],
    default: "manual",
  },
  confidence: { type: Number, min: 0, max: 1 },  // AI confidence score 0–1
  verified:   { type: Boolean, default: false },  // employer-verified
  addedAt:    { type: Date, default: Date.now },
});
 
// ── Sub-schema: Employer Verification Request (M1 FE-6) ──────────────────────
const employerVerificationSchema = new mongoose.Schema({
  companyName:    { type: String, required: true },
  employerEmail:  { type: String, required: true },
  jobTitle:       { type: String },
  startDate:      { type: Date },
  endDate:        { type: Date },
  status: {
    type: String,
    enum: ["pending", "confirmed", "rejected"],
    default: "pending",
  },
  requestedAt:    { type: Date, default: Date.now },
  respondedAt:    { type: Date },
  verificationToken:  { type: String }, 
  notes:              { type: String },  
});
 
// ── Sub-schema: GitHub Stats (M1 FE-5) ───────────────────────────────────────
const githubStatsSchema = new mongoose.Schema({
  username:        { type: String },
  publicRepos:     { type: Number },
  followers:       { type: Number },
  topLanguages:    [{ type: String }],    // ["JavaScript", "Python"]
  totalCommits:    { type: Number },
  contributionScore: { type: Number },   // calculated by AI
  lastFetchedAt:   { type: Date },
});
 
// ── Sub-schema: Trust Score (Module 4) ───────────────────────────────────────
const trustScoreSchema = new mongoose.Schema({
  overall:          { type: Number, default: 0, min: 0, max: 100 },
  profileComplete:  { type: Number, default: 0 },  // 0-100
  behaviorScore:    { type: Number, default: 0 },  // from Isolation Forest
  verificationScore:{ type: Number, default: 0 },  // employer verified?
  feedbackScore:    { type: Number, default: 0 },  // from other users
  lastUpdated:      { type: Date, default: Date.now },
});
 
// ── Sub-schema: Client Company (M12) ─────────────────────────────────────────
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
    name:     { type: String, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String },             // null for Google/GitHub OAuth users
    passwordChangedAt: { 
    type: Date 
  },
    role:     { type: String, enum: ["freelancer", "client"], required: true },
    avatarUrl:{ type: String },             // profile picture URL
 
    // ── Auth & Verification ──────────────────────────────────────────────────
    isVerified:       { type: Boolean, default: false },
    otp:              { type: String },
    otpExpiry:        { type: Date },
    authProvider:     {
      type: String,
      enum: ["local", "google", "github"],
      default: "local",
    },
    googleId:         { type: String },
    githubId:         { type: String },     // GitHub unique ID
    
    // NEW FIELDS FOR SKILL VERIFICATION
    githubUsername:   { type: String },     // e.g., "zainab-dev"
    githubAccessToken:{ type: String },     // The private key Safire uses to read repos

    // ── Account Security ─────────────────────────────────────────────────────
    loginAttempts:    { type: Number, default: 0 },
    lockUntil:        { type: Date },

    // ── Password Reset ───────────────────────────────────────────────────────
    resetPasswordToken:  { type: String },
    resetPasswordExpiry: { type: Date },
 
    // ── Basic Profile ────────────────────────────────────────────────────────
    headline:    { type: String },
    bio:         { type: String },
    location:    { type: String },
    phone:       { type: String },
    profileComplete: { type: Boolean, default: false },
 
    // ── Social & External Links ──────────────────────────────────────────────
    linkedinUrl:  { type: String },
    githubUrl:    { type: String },
    websiteUrl:   { type: String },
 
    // ── Resume ───────────────────────────────────────────────────────────────
    resumeUrl:    { type: String },
    resumeText:   { type: String },
    resumeFileName: { type: String },
 
    // ── Skills — AI Extracted ────────────────────────────────────────────────
    skills:       [skillSchema],
 
    // ── GitHub Stats — fetched via GitHub API ────────────────────────────────
    githubStats:  { type: githubStatsSchema, default: () => ({}) },
 
    // ── Portfolio ────────────────────────────────────────────────────────────
    portfolio:    [portfolioItemSchema],
 
    // ── Employer Verification ────────────────────────────────────────────────
    employerVerifications: [employerVerificationSchema],
 
    // ── Trust Score ──────────────────────────────────────────────────────────
    trustScore:   { type: trustScoreSchema, default: () => ({}) },
    isFlagged:    { type: Boolean, default: false },
    flagReason:   { type: String },
 
    // ── Client-only: Company Profile ──────────────────────────────────────────
    company:      { type: companyProfileSchema, default: () => ({}) },
 
    // ── Admin Controls ───────────────────────────────────────────────────────
    isActive:     { type: Boolean, default: true },
    isSuspended:  { type: Boolean, default: false },
    suspendReason:{ type: String },
    isAdmin:      { type: Boolean, default: false },
 
    // ── Onboarding State ─────────────────────────────────────────────────────
    onboarding: {
      roleSelected:         { type: Boolean, default: false },
      emailVerified:        { type: Boolean, default: false },
      basicProfileDone:     { type: Boolean, default: false },
      socialLinked:         { type: Boolean, default: false },
      aiProcessingDone:     { type: Boolean, default: false },
      skillsReviewed:       { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);
// ════════════════════════════════════════════════════════════════════════════
//  INDEXES — speeds up common queries
// ════════════════════════════════════════════════════════════════════════════
userSchema.index({ role: 1 });
userSchema.index({ "trustScore.overall": -1 });
userSchema.index({ isFlagged: 1 });
userSchema.index({ isActive: 1, isSuspended: 1 });
 
// ════════════════════════════════════════════════════════════════════════════
//  VIRTUAL — isLocked (used by login route)
//  Usage: if (user.isLocked) { return res.status(423)... }
// ════════════════════════════════════════════════════════════════════════════
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});
 
// ════════════════════════════════════════════════════════════════════════════
//  VIRTUAL — profileCompletionPercent
//  Calculates how complete the profile is (0–100)
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
//  Returns user without sensitive fields (use when sending to frontend)
//  Usage: res.json(user.toSafeObject())
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
  delete obj.__v;
  return obj;
};
 
module.exports = mongoose.model("User", userSchema);