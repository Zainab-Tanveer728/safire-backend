// src/routes/freelancerContextRoutes.js   (mounted at /api/freelancer/context)
// The pages of Module 2 call this to show "what profile data is being used" and to prefill forms.
// It never returns the full resume text, email or tokens.
const express = require('express');
const router  = express.Router();
const { protect, restrictTo } = require('../middleware/authMiddleware');
const User = require('../models/User');
const { buildFreelancerContext } = require('../services/freelancerContext');

router.get('/', protect, restrictTo('freelancer'), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'name headline bio location skills githubUsername githubStats githubCache resumeUrl resumeText resumeFileName ' +
      'employerVerifications portfolio trustScore aiProfile'
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });
    const context = buildFreelancerContext(user);
    delete context.resume.excerpt;          // the pages only need to know a resume exists, not its text
    res.json({ context });
  } catch (err) {
    console.error('[FreelancerContext]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;