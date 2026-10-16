// src/middleware/attachFreelancerContext.js
// Put this after `protect` on the Module 2 routes. It gives every controller the user's REAL onboarding
// data without anything being passed between pages: the onboarding pages saved it in the database,
// this reads it back. Nothing is loaded unless a controller asks for it, and each version is loaded once.
//
//   app.use('/api/freelancer', protect, attachFreelancerContext, require('./routes/freelancerRoutes'));
//
//   // inside any Module 2 controller:
//   const ctx     = await req.getFreelancerContext();                        // structured data
//   const profile = await req.getProfilePrompt();                            // text block for an AI prompt
//   const resume  = await req.getProfilePrompt({ includeResumeText: true }); // resume enhancer only
const User = require('../models/User');
const { buildFreelancerContext, contextToPromptText, PROMPT_RULES } = require('../services/freelancerContext');

const FIELDS =
  'name headline bio location skills githubUsername githubStats githubCache resumeUrl resumeText resumeFileName ' +
  'employerVerifications portfolio trustScore aiProfile';

function attachFreelancerContext(req, res, next) {
  const memo = {};

  req.getFreelancerContext = async ({ includeResumeText = false } = {}) => {
    const key = includeResumeText ? 'full' : 'basic';
    if (!(key in memo)) {
      const user = await User.findById(req.user._id).select(FIELDS);
      memo[key] = user ? buildFreelancerContext(user, { includeResumeText }) : null;
    }
    return memo[key];
  };

  req.getProfilePrompt = async (opts) => {
    const ctx = await req.getFreelancerContext(opts);
    return ctx ? `${contextToPromptText(ctx)}\n\nRULES: ${PROMPT_RULES}` : '';
  };

  next();
}

module.exports = { attachFreelancerContext };