// require('dotenv').config();
// const passport = require('passport');
// const GoogleStrategy = require('passport-google-oauth20').Strategy;
// const User = require('./src/models/User');

// const googleClientId = process.env.GOOGLE_CLIENT_ID;
// const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
// const googleCallbackUrl = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

// if (!googleClientId || !googleClientSecret) {
//   console.warn('⚠️ Google OAuth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.');
// } else {
//   passport.use(new GoogleStrategy({
//     clientID: googleClientId,
//     clientSecret: googleClientSecret,
//     callbackURL: googleCallbackUrl,
//     passReqToCallback: true, // Required to access the session role
//   }, async (req, accessToken, refreshToken, profile, done) => {
//     try {
//       const email = profile.emails[0].value;
//       let user = await User.findOne({ email });

//       // ── EXISTING USER ─────────────────────────────────────────
//       if (user) {
//         console.log(`✅ User ${email} logged in via Google.`);
//         return done(null, user);
//       }

//       // ── NEW USER (STRICT CHECK) ────────────────────────────────
//       // We look specifically for the role in the session.
//       // No fallback to 'freelancer' is allowed.
//       const assignedRole = req.query?.state || null;

//       if (!assignedRole) {
//         console.error(`❌ Registration blocked: No role found in session for ${email}`);
        
//         // This error message will be caught by your Passport failure redirect
//         return done(null, false, { 
//           message: 'Please select a role (Freelancer or Client) before signing up with Google.' 
//         });
//       }

//       // If the role exists, proceed with creation
//       user = await User.create({
//         name: profile.displayName,
//         email,
//         isVerified: true,
//         role: assignedRole, 
//         authProvider: 'google',
//         googleId: profile.id,
//       });

//       console.log(`✨ New ${assignedRole} account created:`, email);
//       return done(null, user);

//     } catch (err) {
//       console.error('🔥 Google Strategy Error:', err);
//       return done(err, null);
//     }
//   }));

//   console.log('✅ Google OAuth initialized with Strict Role Verification.');
// }

// // ── SESSION SERIALIZATION ────────────────────────────────────────

// passport.serializeUser((user, done) => {
//   done(null, user._id);
// });

// passport.deserializeUser(async (id, done) => {
//   try {
//     // Exclude password for security and performance
//     const user = await User.findById(id).select('-password');
//     done(null, user);
//   } catch (err) {
//     done(err, null);
//   }
// });

// ================================================================
//  passport.js  (lives at safire-backend/passport.js)
//
//  THE TWO BUGS THAT WERE BREAKING GOOGLE AUTH:
//  1. User model path was './src/models/User' — wrong folder
//  2. req.query.state only works BEFORE passport.authenticate
//     consumes the request. After it runs, state is gone.
//     Fix: pass state through a middleware and store on req
// ================================================================

require('dotenv').config();
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const User = require('./src/models/User');

const googleClientId     = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl  = process.env.GOOGLE_REDIRECT_URI
                        || 'http://localhost:5000/api/auth/google/callback';

if (!googleClientId || !googleClientSecret) {
  console.warn('⚠️  Google OAuth not configured — GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing.');
} else {

  passport.use(new GoogleStrategy(
    {
      clientID:          googleClientId,
      clientSecret:      googleClientSecret,
      callbackURL:       googleCallbackUrl,
      passReqToCallback: true,
    },

    async (req, accessToken, refreshToken, profile, done) => {
      try {

        // ── Get email ─────────────────────────────────────────
        const email = profile.emails?.[0]?.value;
        if (!email) {
          console.error('❌ Google returned no email address');
          return done(null, false);
        }

        // ── Existing user → just log in ───────────────────────
        let user = await User.findOne({ email });
        if (user) {
          console.log(`✅ Existing user signed in via Google: ${email}`);
          return done(null, user);
        }

        // ── New user → MUST have role in session ───────────────
        const assignedRole = req.oauthRole;

        console.log('📌 Role for new Google user:', assignedRole);

        if (!assignedRole || assignedRole === 'login') {
          console.error(`❌ No account for ${email} — cannot log in without registration`);
          return done(null, false);
        }

        if (!['freelancer', 'client'].includes(assignedRole)) {
          console.error(`❌ Invalid role value: "${assignedRole}"`);
          return done(null, false);
        }

        // ── Create new user ───────────────────────────────────
        user = await User.create({
          name:         profile.displayName || email.split('@')[0],
          email,
          isVerified:   true,
          role:         assignedRole,
          authProvider: 'google',
          googleId:     profile.id,
        });

        console.log(`✨ New ${assignedRole} created via Google: ${email}`);
        return done(null, user);

      } catch (err) {
        console.error('🔥 Google Strategy Error:', err.message);
        return done(err, null);
      }
    }
  ));

  console.log('✅ Google OAuth strategy registered successfully');
}

// ── Serialise / Deserialise (for session — only used during OAuth flow) ──
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});