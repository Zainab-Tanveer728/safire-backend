// src/controllers/aiController.js
// POST /api/ai/process  -> reads the user's GitHub + resume text, asks the AI service for skills.
const User              = require('../models/User');
const { extractSkills } = require('../services/aiService');
const { fetchGitHubRepos, fetchLanguages, fetchGitHubProfile } = require('../services/githubService');
const { calculateFreelancerTrust } = require('../utils/trustScore');

const GITHUB_CACHE_MS = 6 * 60 * 60 * 1000;   // reuse GitHub data for 6 hours (retries are instant)

// Send the AI service only what it reads. Full GitHub repo objects are huge.
const slimRepo = (r) => ({
  name: r.name, description: r.description, language: r.language, topics: r.topics || [],
});

async function loadGithubData(user) {
  const cache = user.githubCache;
  if (cache?.repos && cache.fetchedAt && Date.now() - new Date(cache.fetchedAt).getTime() < GITHUB_CACHE_MS) {
    return { repos: cache.repos, languages: cache.languages || {}, cached: true };
  }
  const [repos, profile] = await Promise.all([
    fetchGitHubRepos(user.githubAccessToken),
    fetchGitHubProfile(user.githubAccessToken).catch(() => null),   // only for the stats; not critical
  ]);
  const languages = await fetchLanguages(user.githubAccessToken, repos);
  const slim      = repos.slice(0, 30).map(slimRepo);
  const topLanguages = Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);

  // Saved for Module 2 (proposal generator, skill gap...). Needs githubCache in the User schema.
  await User.updateOne({ _id: user._id }, { $set: {
    githubCache: { repos: slim, languages, fetchedAt: new Date() },
    'githubStats.username':      profile?.login ?? user.githubUsername,
    'githubStats.publicRepos':   profile?.public_repos ?? repos.length,
    'githubStats.followers':     profile?.followers ?? 0,
    'githubStats.topLanguages':  topLanguages,
    'githubStats.lastFetchedAt': new Date(),
  } });
  return { repos: slim, languages, cached: false };
}

exports.processProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const resumeText = user.resumeText || '';
    if (!user.githubAccessToken && !resumeText) {
      return res.status(400).json({
        message: 'No data sources connected. Please connect GitHub or upload a resume first.',
      });
    }

    let githubRepos = [];
    let githubLanguages = {};
    let githubFailed = false;
    if (user.githubAccessToken) {
      try {
        const g = await loadGithubData(user);
        githubRepos = g.repos;
        githubLanguages = g.languages;
      } catch (ghErr) {
        githubFailed = true;
        console.warn('GitHub fetch failed during AI processing:', ghErr.message);
      }
    }

    if (githubFailed && !resumeText) {
      return res.status(502).json({
        message: 'GitHub could not be reached right now. Please try again in a minute, or upload your resume.',
      });
    }

    let result;
    try {
      result = await extractSkills({ githubLanguages, githubRepos, resumeText });
    } catch (aiErr) {
      console.error('AI service error:', aiErr.message);
      return res.status(502).json({ message: 'The AI service is not reachable right now. Please try again in a minute.' });
    }

    // Python answers in snake_case unless aiService maps it; accept both
    const topCategory     = result.topCategory ?? result.top_category ?? 'Other';
    const experienceLevel = result.experienceLevel ?? result.experience_level ?? 'junior';

    const aiSkills = (result.skills || []).map((s) => ({
      name:       s.name,
      category:   s.category || 'Other',
      source:     s.source,
      confidence: s.confidence,
      verified:   s.verified || false,
    }));

    // Re-running must not wipe the skills the user typed in by hand
    const aiNames = new Set(aiSkills.map((s) => s.name.toLowerCase()));
    const keptManual = (user.skills || [])
      .filter((s) => s.source === 'manual' && !aiNames.has(String(s.name).toLowerCase()))
      .map((s) => ({ name: s.name, category: s.category || 'Other', source: 'manual', verified: false }));
    const allSkills = [...aiSkills, ...keptManual];

    const trust = calculateFreelancerTrust({ ...user.toObject(), skills: allSkills });

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        skills:                        allSkills,
        aiProfile: {
          summary:         typeof result.summary === 'string' ? result.summary.slice(0, 300) : '',
          topCategory,
          experienceLevel,
          generatedAt:     new Date(),
        },
        'onboarding.aiProcessingDone': true,
        'trustScore.overall':          trust,
        'trustScore.lastUpdated':      new Date(),
      },
    });

    res.json({
      success:         true,
      skills:          allSkills,
      summary:         result.summary,
      topCategory,
      experienceLevel,
      sourcesUsed: {
        github: !!user.githubAccessToken && !githubFailed,
        resume: !!resumeText,
      },
    });
  } catch (err) {
    console.error('AI processing error:', err.message);
    res.status(500).json({ message: 'AI processing failed. Please try again.' });
  }
};