const User              = require('../models/User');
const { extractSkills } = require('../services/aiService');
const { fetchGitHubRepos, fetchLanguages } = require('../services/githubService');

exports.processProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    let githubRepos     = [];
    let githubLanguages = {};
    const resumeText    = user.resumeText || '';

    if (user.githubAccessToken) {
      try {
        githubRepos     = await fetchGitHubRepos(user.githubAccessToken);
        githubLanguages = await fetchLanguages(user.githubAccessToken, githubRepos);
      } catch (ghErr) {
        console.warn('GitHub fetch failed during AI processing:', ghErr.message);
      }
    }

    if (!user.githubAccessToken && !resumeText) {
      return res.status(400).json({
        message: 'No data sources connected. Please connect GitHub or upload a resume first.',
      });
    }

    const result = await extractSkills({ githubLanguages, githubRepos, resumeText });

    const skillDocs = result.skills.map(s => ({
      name:       s.name,
      source:     s.source,
      confidence: s.confidence,
      verified:   s.verified || false,
    }));

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        skills:                        skillDocs,
        'onboarding.aiProcessingDone': true,
        'trustScore.overall':          calculateTrustScore(user, skillDocs),
      },
    });

    res.json({
      success:         true,
      skills:          result.skills,
      summary:         result.summary,
      topCategory:     result.topCategory,
      experienceLevel: result.experienceLevel,
      sourcesUsed: {
        github: !!user.githubAccessToken,
        resume: !!resumeText,
      },
    });

  } catch (err) {
    console.error('AI processing error:', err.message);
    res.status(500).json({ message: 'AI processing failed: ' + err.message });
  }
};

function calculateTrustScore(user, skills) {
  let score = 0;
  if (user.isVerified)                                              score += 20;
  if (user.onboarding?.basicProfileDone)                            score += 15;
  if (user.githubAccessToken)                                       score += 25;
  if (user.resumeText)                                              score += 20;
  if (skills.length >= 5)                                           score += 10;
  if (user.employerVerifications?.some(v => v.status === 'confirmed')) score += 10;
  return Math.min(score, 100);
}