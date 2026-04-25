const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const passport = require('passport');
const router = express.Router();

// ════════════════════════════════════════════════════════════════
//  GOOGLE OAUTH ROUTES (FIXED)
// ════════════════════════════════════════════════════════════════

router.get('/google', (req, res, next) => {
  // 1. Read role from query param (freelancer, client, or login)
  const role = req.query.role || 'login';
  
  // 2. Store role on req so passport strategy can read it
  req.oauthRole = role;

  // 3. Start Google OAuth — pass role as 'state' so Google sends it back to us
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state: role,
    prompt: 'select_account', 
  })(req, res, next);
});

router.get('/google/callback', 
  // Middleware 1: Recover the role from the state param
  (req, res, next) => {
    req.oauthRole = req.query.state || 'login';
    next();
  },
  // Middleware 2: Passport handles the handshake
  passport.authenticate('google', { 
    // FIXED: Redirects to FRONTEND instead of backend port 5000
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed` 
  }),
  // Middleware 3: Success! Create JWT and send to frontend callback page
  (req, res) => {
    const token = jwt.sign(
      { userId: req.user._id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const name = encodeURIComponent(req.user.name || '');
    const profileComplete = req.user.onboarding?.basicProfileDone ? 'true' : 'false';

    // Redirect to your React "AuthCallback" page
    res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${token}&role=${req.user.role}&name=${name}&profileComplete=${profileComplete}`
    );
  }
);

// ════════════════════════════════════════════════════════════════
//  EXISTING EMAIL/PASSWORD ROUTES (UNTOUCHED)
// ════════════════════════════════════════════════════════════════

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from: `"Safire" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your Safire verification code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <h2 style="color:#6C2BD9;margin-bottom:8px;">Verify your email</h2>
        <p style="color:#6B7280;margin-bottom:24px;">Use the code below to verify your account.</p>
        <div style="background:#F5F0FF;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:#6C2BD9;">${otp}</span>
        </div>
      </div>
    `,
  });
}

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { message: "Too many registration attempts. Please wait 1 hour." },
});

router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    const existing = await User.findOne({ email: email.trim().toLowerCase() }).select("_id");
    if (existing) return res.status(409).json({ message: "Email already registered." });
    res.status(200).json({ message: "Email is available." });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ message: "All fields are required." });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already registered." });

    const hashed = await bcrypt.hash(password, 12);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.create({ name, email, password: hashed, role, otp, otpExpiry });
    await sendOtpEmail(email, otp);

    res.status(201).json({ message: "Check email for OTP.", userId: user._id, email: user.email });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (user?.lockUntil && user.lockUntil > Date.now()) {
      return res.status(423).json({ message: "Account locked. Try again later." });
    }

    if (!user || !(await bcrypt.compare(password, user.password))) {
      if (user) {
        user.loginAttempts += 1;
        if (user.loginAttempts >= 5) user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();
      }
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!user.isVerified) return res.status(403).json({ message: "Verify email first.", userId: user._id });

    user.loginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, role: user.role, name: user.name, userId: user._id });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);
    if (!user || user.otp !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP." });
    }
    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();
    res.json({ message: "Email verified!" });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: "Reset link sent if email exists." });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    await transporter.sendMail({
      from: `"Safire"`,
      to: email,
      subject: "Reset Password",
      html: `<a href="${resetUrl}">Reset Password</a>`
    });
    res.json({ message: "Reset link sent." });
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.password = await bcrypt.hash(newPassword, 12);
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ message: 'Password reset successfully.' });
  } catch (err) {
    res.status(400).json({ message: 'Link expired or invalid.' });
  }
});

module.exports = router;