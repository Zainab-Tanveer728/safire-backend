const jwt      = require('jsonwebtoken');
const passport = require('passport');
const fetch    = require('node-fetch');
const User     = require('../models/User');
const {
  fetchGitHubProfile,
  fetchGitHubRepos,
  fetchLanguages,
} = require('../services/githubService');

// ════════════════════════════════════════════════════════════════
//  GOOGLE OAUTH
// ════════════════════════════════════════════════════════════════

exports.googleAuth = (req, res, next) => {
  const role = req.query.role || 'login';
  req.oauthRole = role;
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state: role,
    prompt: 'select_account',
  })(req, res, next);
};

exports.googleCallback = [
  (req, res, next) => {
    req.oauthRole = req.query.state || 'login';
    next();
  },
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=google_failed`,
  }),
  (req, res) => {
    const token = jwt.sign(
      { userId: req.user._id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    const name = encodeURIComponent(req.user.name || '');
    res.redirect(
      `${process.env.FRONTEND_URL}/auth/callback?token=${token}&role=${req.user.role}&name=${name}`
    );
  },
];

// ════════════════════════════════════════════════════════════════
//  GITHUB OAUTH — MANUAL (no passport)
//
//  Why manual? Passport's GitHub strategy reuses browser sessions
//  which caused any user to silently connect to the same GitHub
//  account without showing the authorization screen.
//
//  Manual flow:
//  1. githubConnect → redirect to github.com/login/oauth/authorize
//     with state = user's MongoDB _id (signed for security)
//  2. GitHub redirects to /callback with code + state
//  3. githubCallback → exchange code for token, verify state,
//     find user by _id, save token to DB
// ════════════════════════════════════════════════════════════════

exports.githubConnect = (req, res) => {
  if (!req.user) {
    return res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
  }

  // Sign the user's _id as state — verifiable, not guessable
  const state = jwt.sign(
    { userId: req.user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  const params = new URLSearchParams({
    client_id:    process.env.GITHUB_CLIENT_ID,
    redirect_uri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:5000/api/auth/github/callback',
    scope:        'read:user user:email repo',
    state,
    // No 'login' param — GitHub will always ask which account to use
  });

  // Redirect directly to GitHub — bypasses passport session completely
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
};

exports.githubCallback = async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    console.error('❌ GitHub callback missing code or state');
    return res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
  }

  try {
    // Verify state to confirm this is a legitimate callback
    let decoded;
    try {
      decoded = jwt.verify(state, process.env.JWT_SECRET);
    } catch {
      console.error('❌ GitHub callback state verification failed');
      return res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
    }

    const userId = decoded.userId;

    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method:  'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client_id:     process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri:  process.env.GITHUB_REDIRECT_URI || 'http://localhost:5000/api/auth/github/callback',
      }),
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('❌ GitHub token exchange failed:', tokenData);
      return res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
    }

    // Get GitHub profile to confirm which account was authorized
    const profileRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await profileRes.json();

    if (!profile.login) {
      console.error('❌ GitHub profile fetch failed');
      return res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
    }

    // Find the specific user by _id from state — never by session
    const user = await User.findById(userId);
    if (!user) {
      console.error(`❌ User ${userId} not found`);
      return res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
    }

    // Link GitHub to this specific user
    user.githubId          = String(profile.id);
    user.githubUsername    = profile.login;
    user.githubAccessToken = accessToken;
    if (user.onboarding) {
      user.onboarding.socialLinked = true;
    }
    await user.save();

    console.log(`✅ GitHub @${profile.login} linked to ${user.email}`);
    res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=success`);

  } catch (err) {
    console.error('🔥 GitHub callback error:', err.message);
    res.redirect(`${process.env.FRONTEND_URL}/onboarding/connect?github=error`);
  }
};

// ════════════════════════════════════════════════════════════════
//  GITHUB DATA
// ════════════════════════════════════════════════════════════════

exports.getGitHubData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user?.githubAccessToken) {
      return res.status(400).json({ message: 'GitHub not connected yet.' });
    }

    const [profile, repos] = await Promise.all([
      fetchGitHubProfile(user.githubAccessToken),
      fetchGitHubRepos(user.githubAccessToken),
    ]);

    const languages = await fetchLanguages(user.githubAccessToken, repos);

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        'githubStats.username':      profile.login,
        'githubStats.publicRepos':   profile.public_repos,
        'githubStats.followers':     profile.followers,
        'githubStats.topLanguages':  Object.keys(languages).slice(0, 5),
        'githubStats.lastFetchedAt': new Date(),
        'onboarding.socialLinked':   true,
      },
    });

    res.json({
      profile,
      repos:     repos.slice(0, 20),
      languages,
    });

  } catch (err) {
    console.error('GitHub data fetch error:', err.message);
    res.status(500).json({ message: 'Failed to fetch GitHub data.' });
  }
};