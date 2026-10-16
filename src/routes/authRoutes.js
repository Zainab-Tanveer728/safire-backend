// const express    = require('express');
// const bcrypt     = require('bcryptjs');
// const jwt        = require('jsonwebtoken');
// const crypto     = require('crypto');
// const rateLimit  = require('express-rate-limit');
// const passport   = require('passport');
// const router     = express.Router();

// const User = require('../models/User');
// const { protect } = require('../middleware/authMiddleware');
// const { buildUserPayload } = require('../utils/userPayload');
// const { sendOtpEmail, sendPasswordResetEmail, sendVerifiedEmail } = require('../services/emailService');
// const {
//   githubConnect,
//   githubCallback,
//   getGitHubData,
// } = require('../controllers/authController');

// // ════════════════════════════════════════════════════════════════
// //  GOOGLE OAUTH
// // ════════════════════════════════════════════════════════════════

// router.get('/google', (req, res, next) => {
//   const role = req.query.role || 'login';
//   req.oauthRole = role;
//   passport.authenticate('google', {
//     scope:  ['profile', 'email'],
//     state:  role,
//     prompt: 'select_account',
//   })(req, res, next);
// });

// router.get('/google/callback',
//   (req, res, next) => {
//     req.oauthRole = req.query.state || 'login';
//     next();
//   },
//   passport.authenticate('google', {
//     failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed`,
//   }),
//   (req, res) => {
//     // B5: block suspended / removed accounts
//     if (['suspended', 'removed'].includes(req.user.status)) {
//       return res.redirect(`${process.env.FRONTEND_URL}/login?error=account_blocked`);
//     }

//     const token = jwt.sign(
//       { userId: req.user._id, role: req.user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: '7d' }
//     );
//     const name            = encodeURIComponent(req.user.name || '');
//     const profileComplete = req.user.onboarding?.basicProfileDone ? 'true' : 'false';
//     res.redirect(
//       `${process.env.FRONTEND_URL}/auth/callback?token=${token}&role=${req.user.role}&name=${name}&profileComplete=${profileComplete}`
//     );
//   }
// );

// // ════════════════════════════════════════════════════════════════
// //  GITHUB OAUTH
// // ════════════════════════════════════════════════════════════════

// router.get('/github/connect',  protect, githubConnect);
// router.get('/github/callback', githubCallback);
// router.get('/github/data',     protect, getGitHubData);

// // ════════════════════════════════════════════════════════════════
// //  REGISTER
// // ════════════════════════════════════════════════════════════════

// const registerLimiter = rateLimit({
//   windowMs: 60 * 60 * 1000,
//   max:      5,
//   message:  { message: 'Too many registration attempts. Please wait 1 hour.' },
// });

// // Limiter for OTP verify / resend
// const otpLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max:      10,
//   message:  { message: 'Too many attempts. Try again later.' },
// });

// router.post('/check-email', async (req, res) => {
//   try {
//     const { email } = req.body;
//     const existing = await User.findOne({ email: email.trim().toLowerCase() }).select('_id');
//     if (existing) return res.status(409).json({ message: 'Email already registered.' });
//     res.status(200).json({ message: 'Email is available.' });
//   } catch {
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// router.post('/register', registerLimiter, async (req, res) => {
//   try {
//     const { name, email, password, role } = req.body;
//     if (!name || !email || !password || !role)
//       return res.status(400).json({ message: 'All fields are required.' });

//     if (role === 'admin')
//       return res.status(400).json({ message: 'Invalid role.' });

//     const existing = await User.findOne({ email });
//     if (existing) return res.status(400).json({ message: 'Email already registered.' });

//     const hashed    = await bcrypt.hash(password, 12);
//     const otp       = crypto.randomInt(100000, 1000000).toString(); // B6
//     const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

//     const user = await User.create({ name, email, password: hashed, role, otp, otpExpiry });
//     const emailSent = await sendOtpEmail(email, otp, 10);

//     res.status(201).json({
//       message: emailSent
//         ? 'Check email for OTP.'
//         : 'Account created, but the verification email could not be sent. Use "Resend code".',
//       emailSent,
//       userId: user._id,
//       email:  user.email,
//     });
//   } catch (err) {
//     console.error('[Register]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// // ════════════════════════════════════════════════════════════════
// //  LOGIN
// // ════════════════════════════════════════════════════════════════

// router.post('/login', async (req, res) => {
//   try {
//     const { email, password } = req.body;
//     if (!email || !password)
//       return res.status(400).json({ message: 'Email and password are required.' });

//     const user = await User.findOne({ email: email.toLowerCase().trim() });

//     // Locked account
//     if (user?.lockUntil && user.lockUntil > Date.now()) {
//       const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
//       return res.status(423).json({ message: `Account locked. Try again in ${minutesLeft} minute(s).` });
//     }

//     // OAuth users have no password
//     if (user && !user.password) {
//       return res.status(401).json({
//         message: 'This account uses Google sign-in. Please use "Continue with Google".',
//       });
//     }

//     // Wrong credentials  (C1: lockout resets after it expires)
//     if (!user || !(await bcrypt.compare(password, user.password))) {
//       if (user) {
//         const lockExpired = user.lockUntil && user.lockUntil <= Date.now();
//         const attempts    = (lockExpired ? 0 : (user.loginAttempts || 0)) + 1;
//         await User.updateOne({ _id: user._id }, {
//           $set: {
//             loginAttempts: attempts,
//             lockUntil:     attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
//           },
//         });
//       }
//       return res.status(401).json({ message: 'Invalid email or password.' });
//     }

//     // Unverified
//     if (!user.isVerified) {
//       return res.status(403).json({ message: 'Please verify your email first.', userId: user._id });
//     }

//     // Suspended / removed
//     if (user.status === 'suspended') {
//       return res.status(403).json({ message: 'Account suspended. Contact support.' });
//     }
//     if (user.status === 'removed') {
//       return res.status(403).json({ message: 'Account no longer exists.' });
//     }

//     // Reset failed attempts
//     await User.updateOne(
//       { _id: user._id },
//       { $set: { loginAttempts: 0, lockUntil: null } }
//     );

//     const token = jwt.sign(
//       { userId: user._id, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: '7d' }
//     );

//     console.log(`✅ [Login] ${user.email} (${user.role})`);

//     // A1: return the full user payload including onboarding state
//     res.json({
//       token,
//       role:   user.role,
//       name:   user.name,
//       userId: user._id,
//       user:   buildUserPayload(user),
//     });

//   } catch (err) {
//     console.error('[Login]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// // ════════════════════════════════════════════════════════════════
// //  EMAIL VERIFICATION (OTP)
// // ════════════════════════════════════════════════════════════════

// router.post('/verify-otp', otpLimiter, async (req, res) => {
//   try {
//     const { userId, otp } = req.body;
//     const user = await User.findById(userId);

//     // B1: every part must exist AND match — no undefined === undefined
//     const valid =
//       user &&
//       user.otp &&
//       otp &&
//       user.otp === String(otp) &&
//       user.otpExpiry &&
//       user.otpExpiry > Date.now();

//     if (!valid) {
//       return res.status(400).json({ message: 'Invalid or expired OTP.' });
//     }

//     await User.updateOne(
//       { _id: user._id },
//       {
//         $set: {
//           isVerified:                 true,
//           otp:                        null,
//           otpExpiry:                  null,
//           'onboarding.emailVerified': true,
//         },
//       }
//     );

//     const token = jwt.sign(
//       { userId: user._id, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: '7d' }
//     );

//     sendVerifiedEmail({ to: user.email, name: user.name }); // fire-and-forget, never throws

//     res.json({
//       message:    'Email verified!',
//       token,
//       role:       user.role,
//       name:       user.name,
//       onboarding: buildUserPayload(user).onboarding,
//       user:       buildUserPayload(user),
//     });
//   } catch (err) {
//     console.error('[VerifyOTP]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// // C2: resend OTP
// router.post('/resend-otp', otpLimiter, async (req, res) => {
//   try {
//     const user = await User.findById(req.body.userId);
//     if (user && !user.isVerified) {
//       const otp = crypto.randomInt(100000, 1000000).toString();
//       await User.updateOne(
//         { _id: user._id },
//         { $set: { otp, otpExpiry: new Date(Date.now() + 10 * 60 * 1000) } }
//       );
//       const emailSent = await sendOtpEmail(user.email, otp, 10);
//       if (!emailSent) {
//         return res.status(503).json({ message: 'Could not send the email right now. Please try again shortly.' });
//       }
//     }
//     // Same message either way so it doesn't reveal which ids exist
//     res.json({ message: 'If eligible, a new code has been sent.' });
//   } catch (err) {
//     console.error('[ResendOTP]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// // ════════════════════════════════════════════════════════════════
// //  PASSWORD RESET — FORGOT
// // ════════════════════════════════════════════════════════════════

// router.post('/forgot-password', async (req, res) => {
//   try {
//     const { email } = req.body;
//     if (!email) return res.status(400).json({ message: 'Email is required.' });

//     const user = await User.findOne({ email: email.toLowerCase().trim() });

//     if (!user) {
//       console.log(`[ForgotPassword] No account for: ${email}`);
//       return res.json({ message: 'If that email is registered, a reset link has been sent.' });
//     }

//     // B2: purpose flag so this token can't be used as a login token
//     const resetToken = jwt.sign(
//       { userId: user._id, purpose: 'reset' },
//       process.env.JWT_SECRET,
//       { expiresIn: '15m' }
//     );

//     console.log(`[ForgotPassword] Sending to: ${email}`);

//     const emailSent = await sendPasswordResetEmail({
//       to: user.email, name: user.name, token: resetToken, minutes: 15,
//     });
//     if (!emailSent) {
//       console.error(`[ForgotPassword] ❌ Email failed for ${email}`);
//       return res.status(500).json({
//         message: 'Could not send reset email. Please check your email address or try again later.',
//       });
//     }
//     console.log(`[ForgotPassword] ✅ Email sent to: ${email}`);

//     res.json({ message: 'If that email is registered, a reset link has been sent.' });
//   } catch (err) {
//     console.error('[ForgotPassword]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// // ════════════════════════════════════════════════════════════════
// //  PASSWORD RESET — RESET
// // ════════════════════════════════════════════════════════════════

// router.post('/reset-password', async (req, res) => {
//   try {
//     const { token, newPassword } = req.body;
//     if (!token || !newPassword)
//       return res.status(400).json({ message: 'Token and new password are required.' });

//     let decoded;
//     try {
//       decoded = jwt.verify(token, process.env.JWT_SECRET);
//     } catch {
//       return res.status(400).json({ message: 'Reset link has expired or is invalid. Please request a new one.' });
//     }

//     // B2: only tokens issued by /forgot-password are accepted here
//     if (decoded.purpose !== 'reset') {
//       return res.status(400).json({ message: 'Reset link has expired or is invalid. Please request a new one.' });
//     }

//     const user = await User.findById(decoded.userId);
//     if (!user) return res.status(404).json({ message: 'Account not found.' });

//     await User.updateOne(
//       { _id: user._id },
//       {
//         $set: {
//           password:          await bcrypt.hash(newPassword, 12),
//           passwordChangedAt: new Date(),
//           loginAttempts:     0,
//           lockUntil:         null,
//         },
//       }
//     );

//     console.log(`[ResetPassword] ✅ Password updated for: ${user.email}`);
//     res.json({ message: 'Password reset successfully. You can now log in.' });
//   } catch (err) {
//     console.error('[ResetPassword]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// module.exports = router;

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const passport   = require('passport');
const router     = express.Router();

const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { buildUserPayload } = require('../utils/userPayload');
const { sendOtpEmail, sendPasswordResetEmail, sendVerifiedEmail } = require('../services/emailService');
const {
  githubConnect,
  githubCallback,
  getGitHubData,
} = require('../controllers/authController');

// ════════════════════════════════════════════════════════════════
//  GOOGLE OAUTH
// ════════════════════════════════════════════════════════════════

router.get('/google', (req, res, next) => {
  const role = req.query.role || 'login';
  req.oauthRole = role;
  passport.authenticate('google', {
    scope:  ['profile', 'email'],
    state:  role,
    prompt: 'select_account',
  })(req, res, next);
});

router.get('/google/callback',
  (req, res, next) => {
    req.oauthRole = req.query.state || 'login';
    next();
  },
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed`,
  }),
  (req, res) => {
    // B5: block suspended / removed accounts
    if (['suspended', 'removed'].includes(req.user.status)) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=account_blocked`);
    }

    const token = jwt.sign(
      { userId: req.user._id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const name            = encodeURIComponent(req.user.name || '');
    const profileComplete = req.user.onboarding?.basicProfileDone ? 'true' : 'false';
    res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${token}&role=${req.user.role}&name=${name}&profileComplete=${profileComplete}`
    );
  }
);

// ════════════════════════════════════════════════════════════════
//  GITHUB OAUTH
// ════════════════════════════════════════════════════════════════

router.get('/github/connect',  protect, githubConnect);
router.get('/github/callback', githubCallback);
router.get('/github/data',     protect, getGitHubData);

// ════════════════════════════════════════════════════════════════
//  REGISTER
// ════════════════════════════════════════════════════════════════

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      5,
  message:  { message: 'Too many registration attempts. Please wait 1 hour.' },
});

// Limiter for OTP verify / resend
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { message: 'Too many attempts. Try again later.' },
});

router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    const existing = await User.findOne({ email: email.trim().toLowerCase() }).select('_id');
    if (existing) return res.status(409).json({ message: 'Email already registered.' });
    res.status(200).json({ message: 'Email is available.' });
  } catch {
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role)
      return res.status(400).json({ message: 'All fields are required.' });

    if (role === 'admin')
      return res.status(400).json({ message: 'Invalid role.' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered.' });

    const hashed    = await bcrypt.hash(password, 12);
    const otp       = crypto.randomInt(100000, 1000000).toString(); // B6
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.create({ name, email, password: hashed, role, otp, otpExpiry });
    const emailSent = await sendOtpEmail(email, otp, 10);

    res.status(201).json({
      message: emailSent
        ? 'Check email for OTP.'
        : 'Account created, but the verification email could not be sent. Use "Resend code".',
      emailSent,
      userId: user._id,
      email:  user.email,
    });
  } catch (err) {
    console.error('[Register]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════════

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Locked account
    if (user?.lockUntil && user.lockUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      return res.status(423).json({ message: `Account locked. Try again in ${minutesLeft} minute(s).` });
    }

    // OAuth users have no password
    if (user && !user.password) {
      return res.status(401).json({
        message: 'This account uses Google sign-in. Please use "Continue with Google".',
      });
    }

    // Wrong credentials  (C1: lockout resets after it expires)
    if (!user || !(await bcrypt.compare(password, user.password))) {
      if (user) {
        const lockExpired = user.lockUntil && user.lockUntil <= Date.now();
        const attempts    = (lockExpired ? 0 : (user.loginAttempts || 0)) + 1;
        await User.updateOne({ _id: user._id }, {
          $set: {
            loginAttempts: attempts,
            lockUntil:     attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
          },
        });
      }
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Unverified
    if (!user.isVerified) {
      return res.status(403).json({ message: 'Please verify your email first.', userId: user._id });
    }

    // Suspended / removed
    if (user.status === 'suspended') {
      return res.status(403).json({ message: 'Account suspended. Contact support.' });
    }
    if (user.status === 'removed') {
      return res.status(403).json({ message: 'Account no longer exists.' });
    }

    // Reset failed attempts
    await User.updateOne(
      { _id: user._id },
      { $set: { loginAttempts: 0, lockUntil: null } }
    );

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ [Login] ${user.email} (${user.role})`);

    // A1: return the full user payload including onboarding state
    res.json({
      token,
      role:   user.role,
      name:   user.name,
      userId: user._id,
      user:   buildUserPayload(user),
    });

  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  EMAIL VERIFICATION (OTP)
// ════════════════════════════════════════════════════════════════

router.post('/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);

    // B1: every part must exist AND match — no undefined === undefined
    const valid =
      user &&
      user.otp &&
      otp &&
      user.otp === String(otp) &&
      user.otpExpiry &&
      user.otpExpiry > Date.now();

    if (!valid) {
      return res.status(400).json({ message: 'Invalid or expired OTP.' });
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          isVerified:                 true,
          otp:                        null,
          otpExpiry:                  null,
          'onboarding.emailVerified': true,
        },
      }
    );

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    sendVerifiedEmail({ to: user.email, name: user.name }); // fire-and-forget, never throws

    res.json({
      message:    'Email verified!',
      token,
      role:       user.role,
      name:       user.name,
      onboarding: buildUserPayload(user).onboarding,
      user:       buildUserPayload(user),
    });
  } catch (err) {
    console.error('[VerifyOTP]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

// C2: resend OTP
router.post('/resend-otp', otpLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.body.userId);
    if (user && !user.isVerified) {
      const otp = crypto.randomInt(100000, 1000000).toString();
      await User.updateOne(
        { _id: user._id },
        { $set: { otp, otpExpiry: new Date(Date.now() + 10 * 60 * 1000) } }
      );
      const emailSent = await sendOtpEmail(user.email, otp, 10);
      if (!emailSent) {
        return res.status(503).json({ message: 'Could not send the email right now. Please try again shortly.' });
      }
    }
    // Same message either way so it doesn't reveal which ids exist
    res.json({ message: 'If eligible, a new code has been sent.' });
  } catch (err) {
    console.error('[ResendOTP]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  PASSWORD RESET — FORGOT
// ════════════════════════════════════════════════════════════════

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      console.log(`[ForgotPassword] No account for: ${email}`);
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }

    // B2: purpose flag so this token can't be used as a login token
    const resetToken = jwt.sign(
      { userId: user._id, purpose: 'reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    console.log(`[ForgotPassword] Sending to: ${email}`);

    const emailSent = await sendPasswordResetEmail({
      to: user.email, name: user.name, token: resetToken, minutes: 15,
    });
    if (!emailSent) {
      console.error(`[ForgotPassword] ❌ Email failed for ${email}`);
      return res.status(500).json({
        message: 'Could not send reset email. Please check your email address or try again later.',
      });
    }
    console.log(`[ForgotPassword] ✅ Email sent to: ${email}`);

    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('[ForgotPassword]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  PASSWORD RESET — RESET
// ════════════════════════════════════════════════════════════════

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res.status(400).json({ message: 'Token and new password are required.' });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ message: 'Reset link has expired or is invalid. Please request a new one.' });
    }

    // B2: only tokens issued by /forgot-password are accepted here
    if (decoded.purpose !== 'reset') {
      return res.status(400).json({ message: 'Reset link has expired or is invalid. Please request a new one.' });
    }

    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ message: 'Account not found.' });

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          password:          await bcrypt.hash(newPassword, 12),
          passwordChangedAt: new Date(),
          loginAttempts:     0,
          lockUntil:         null,
        },
      }
    );

    console.log(`[ResetPassword] ✅ Password updated for: ${user.email}`);
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[ResetPassword]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;