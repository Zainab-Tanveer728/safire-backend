// controllers/clientController.js
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const { apiResponse } = require("../utils/apiResponse");
const User = require("../models/User");
const ClientProfile = require("../models/ClientProfile");  // new model (see below)
const { hashPassword, comparePassword } = require("../utils/jwtHelper");
const { generateTokenPair } = require("../utils/tokenHelper");
const emailService = require("../services/emailService");
const aiService = require("../services/aiService");
const multer = require("../config/multer");
const path = require("path");

// ─── M11: Register Client ────────────────────────────────────────────────────
exports.registerClient = catchAsync(async (req, res, next) => {
  const { fullName, email, password, country } = req.body;

  // Check for duplicate email
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return next(new AppError("An account with this email already exists.", 409));
  }

  // Hash password
  const hashedPassword = await hashPassword(password);

  // Create user record
  const user = await User.create({
    fullName: fullName.trim(),
    email: email.toLowerCase(),
    password: hashedPassword,
    country,
    role: "client",
    status: "pending_verification",
    onboardingStep: "email_verification",
  });

  // Create empty client profile placeholder
  await ClientProfile.create({ userId: user._id });

  // Send OTP verification email
  await emailService.sendOTPVerification(user.email, user._id);

  return apiResponse(res, 201, "Account created. Please verify your email.", {
    userId: user._id,
  });
});

// ─── M12: Company Profile Setup ──────────────────────────────────────────────
exports.setupCompanyProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    companyName, jobTitle, website, industry,
    companySize, country, about,
  } = req.body;

  const logoPath = req.file
    ? `/uploads/logos/${req.file.filename}`
    : null;

  // Validate HTTPS for website if provided
  if (website && !website.startsWith("https://")) {
    return next(new AppError("Company website must use HTTPS.", 422));
  }

  const profile = await ClientProfile.findOneAndUpdate(
    { userId },
    {
      companyName: companyName?.trim(),
      jobTitle: jobTitle?.trim(),
      website,
      industry,
      companySize,
      country,
      about,
      ...(logoPath && { logo: logoPath }),
      companyProfileComplete: true,
    },
    { new: true, upsert: true }
  );

  // Update user onboarding step
  await User.findByIdAndUpdate(userId, {
    onboardingStep: "complete",
  });

  // Trigger trust score calculation via AI service (async, non-blocking)
  aiService
    .calculateClientTrustScore(userId)
    .catch((err) => console.error("Trust score calculation failed:", err));

  return apiResponse(res, 200, "Company profile saved.", { profile });
});

// ─── M13: Get Onboarding Status ───────────────────────────────────────────────
exports.getOnboardingStatus = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const user = await User.findById(userId).select("status emailVerified");
  const profile = await ClientProfile.findOne({ userId });

  if (!user) return next(new AppError("User not found.", 404));

  const trustScore = profile?.trustScore ?? 0;

  return apiResponse(res, 200, "Onboarding status retrieved.", {
    emailVerified: user.emailVerified || false,
    companyProfileComplete: profile?.companyProfileComplete || false,
    trustScoreAssigned: trustScore > 0,
    trustScore,
  });
});

// ─── Get Client Profile (for dashboard / profile page) ───────────────────────
exports.getClientProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const user = await User.findById(userId).select("-password");
  const profile = await ClientProfile.findOne({ userId });
  if (!user) return next(new AppError("User not found.", 404));
  return apiResponse(res, 200, "Profile retrieved.", { user, profile });
});

// ─── Update Client Profile ────────────────────────────────────────────────────
exports.updateClientProfile = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const allowed = ["fullName", "country"];
  const userUpdates = {};
  allowed.forEach((key) => { if (req.body[key]) userUpdates[key] = req.body[key]; });

  const profileAllowed = ["companyName", "jobTitle", "website", "industry", "companySize", "about"];
  const profileUpdates = {};
  profileAllowed.forEach((key) => { if (req.body[key] !== undefined) profileUpdates[key] = req.body[key]; });

  if (Object.keys(userUpdates).length > 0) {
    await User.findByIdAndUpdate(userId, userUpdates);
  }
  const profile = await ClientProfile.findOneAndUpdate(
    { userId },
    profileUpdates,
    { new: true }
  );
  return apiResponse(res, 200, "Profile updated.", { profile });
});