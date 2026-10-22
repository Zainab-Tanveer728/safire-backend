// controllers/clientController.js
const { apiResponse } = require("../utils/apiResponse");
const User = require("../models/User");
const ClientProfile = require("../models/ClientProfile");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const emailService = require("../services/emailService");
const aiService = require("../services/aiService");

// ─── M11: Register Client ────────────────────────────────────────────────────
exports.registerClient = async (req, res) => {
  const { fullName, email, password, country } = req.body;

  // Check for duplicate email
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return apiResponse(res, 409, "An account with this email already exists.");
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);
  const otp = crypto.randomInt(100000, 1000000).toString();
  const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

  // Create user record
  const user = await User.create({
    name: fullName.trim(),
    email: email.toLowerCase(),
    password: hashedPassword,
    country,
    role: "client",
    status: "pending",
    otp,
    otpExpiry,
  });

  // Create empty client profile placeholder
  await ClientProfile.create({ userId: user._id });

  // Send OTP verification email
  const emailSent = await emailService.sendOtpEmail(user.email, otp, 10);

  return apiResponse(res, 201, "Account created. Please verify your email.", {
    userId: user._id,
    email: user.email,
    emailSent,
  });
};

// ─── M12: Company Profile Setup ──────────────────────────────────────────────
exports.setupCompanyProfile = async (req, res) => {
  const userId = req.user.id;
  const {
    companyName, jobTitle, website, industry,
    companySize, country, about,
  } = req.body;

  if (!companyName?.trim() || !industry?.trim() || !country?.trim()) {
    return apiResponse(res, 422, "Company name, industry, and country are required.");
  }

  const logoPath = req.file
    ? `/uploads/logos/${req.file.filename}`
    : null;

  // Validate HTTPS for website if provided
  if (website && !website.startsWith("https://")) {
    return apiResponse(res, 422, "Company website must use HTTPS.");
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
    { new: true, upsert: true, runValidators: true }
  );

  const userUpdates = {
    "company.companyName": profile.companyName,
    "company.industry": profile.industry,
    "company.website": profile.website || "",
    "company.location": profile.country,
    "company.description": profile.about || "",
    "onboarding.basicProfileDone": true,
    onboardingStep: "complete",
  };
  if (profile.companySize) userUpdates["company.companySize"] = profile.companySize;
  if (profile.jobTitle) userUpdates.headline = profile.jobTitle;
  if (profile.logo) userUpdates["company.companyLogoUrl"] = profile.logo;

  await User.findByIdAndUpdate(userId, {
    $set: userUpdates,
  }, { runValidators: true });

  // Trigger trust score calculation via AI service (async, non-blocking)
  aiService
    .calculateClientTrustScore(userId)
    .catch((err) => console.error("Trust score calculation failed:", err));

  return apiResponse(res, 200, "Company profile saved.", { profile });
};

// ─── M13: Get Onboarding Status ───────────────────────────────────────────────
exports.getOnboardingStatus = async (req, res) => {
  const userId = req.user.id;

  const user = await User.findById(userId).select("status isVerified");
  const profile = await ClientProfile.findOne({ userId });

  if (!user) return apiResponse(res, 404, "User not found.");

  const trustScore = profile?.trustScore ?? 0;

  return apiResponse(res, 200, "Onboarding status retrieved.", {
    emailVerified: user.isVerified || false,
    companyProfileComplete: profile?.companyProfileComplete || false,
    trustScoreAssigned: trustScore > 0,
    trustScore,
  });
};

// ─── Get Client Profile (for dashboard / profile page) ───────────────────────
exports.getClientProfile = async (req, res) => {
  const userId = req.user.id;
  const user = await User.findById(userId).select("-password");
  const profile = await ClientProfile.findOne({ userId });
  if (!user) return apiResponse(res, 404, "User not found.");
  return apiResponse(res, 200, "Profile retrieved.", { user, profile });
};

// ─── Update Client Profile ────────────────────────────────────────────────────
exports.updateClientProfile = async (req, res) => {
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
};