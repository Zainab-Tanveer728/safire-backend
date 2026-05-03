require('dotenv').config();
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User           = require('./src/models/User');

const googleClientId     = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl  = process.env.GOOGLE_REDIRECT_URI
                        || 'http://localhost:5000/api/auth/google/callback';

// ════════════════════════════════════════════════════════════════
//  GOOGLE STRATEGY ONLY
//  GitHub is handled manually in authController — no passport needed
// ════════════════════════════════════════════════════════════════

if (!googleClientId || !googleClientSecret) {
  console.warn('⚠️  Google OAuth not configured.');
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
        const email = profile.emails?.[0]?.value;
        if (!email) {
          console.error('❌ Google returned no email');
          return done(null, false);
        }

        let user = await User.findOne({ email });
        if (user) {
          console.log(`✅ Existing user signed in via Google: ${email}`);
          return done(null, user);
        }

        const assignedRole = req.oauthRole;
        if (!assignedRole || assignedRole === 'login') {
          console.error(`❌ No account for ${email} — cannot log in without registration`);
          return done(null, false);
        }

        user = await User.create({
          name:         profile.displayName || email.split('@')[0],
          email,
          isVerified:   true,
          role:         assignedRole,
          authProvider: 'google',
          googleId:     profile.id,
          onboarding: {
            emailVerified:    true,
            basicProfileDone: false,
            socialLinked:     false,
            aiProcessingDone: false,
            skillsReviewed:   false,
          }
        });

        console.log(`✨ New ${assignedRole} created via Google: ${email}`);
        return done(null, user);

      } catch (err) {
        console.error('🔥 Google Strategy Error:', err.message);
        return done(err, null);
      }
    }
  ));
  console.log('✅ Google OAuth strategy registered');
}

passport.serializeUser((user, done) => done(null, user._id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password -githubAccessToken');
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;