const fetch              = require('node-fetch');
const User               = require('../models/User');

const AI_BACKEND_URL = process.env.AI_BACKEND_URL || 'http://localhost:8001';

// ════════════════════════════════════════════════════════════════
//  SKILL EXTRACTION
//  Calls Python FastAPI backend (Groq/Gemini)
// ════════════════════════════════════════════════════════════════

const extractSkills = async ({ githubLanguages, githubRepos, resumeText }) => {
  const response = await fetch(`${AI_BACKEND_URL}/api/extract-skills`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      github_languages: githubLanguages || {},
      github_repos:     githubRepos     || [],
      resume_text:      resumeText      || '',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'AI backend call failed');
  }

  const data = await response.json();

  return {
    skills:          data.skills,
    summary:         data.summary,
    topCategory:     data.top_category,
    experienceLevel: data.experience_level,
  };
};

// ════════════════════════════════════════════════════════════════
//  CLIENT TRUST SCORE
//  Calculates and persists trust score for a client user
//  Uses the user's company data already stored in MongoDB
//  No separate AI backend call needed — rule-based calculation
// ════════════════════════════════════════════════════════════════

const calculateClientTrustScore = async (userId) => {
  try {
    const user = await User.findById(userId).select(
      'name email isVerified company onboarding'
    );

    if (!user) throw new Error(`User ${userId} not found`);

    // ── Rule-based scoring ──────────────────────────────────────
    let score = 0;
    const breakdown = {};

    if (user.isVerified) {
      score += 20;
      breakdown.emailVerified = 20;
    }
    if (user.company?.companyName) {
      score += 15;
      breakdown.companyName = 15;
    }
    if (user.company?.industry) {
      score += 15;
      breakdown.industry = 15;
    }
    if (user.company?.website) {
      score += 10;
      breakdown.website = 10;
    }
    if (user.company?.description) {
      score += 15;
      breakdown.description = 15;
    }
    if (user.company?.companySize) {
      score += 10;
      breakdown.companySize = 10;
    }
    if (user.company?.location) {
      score += 10;
      breakdown.location = 10;
    }

    score = Math.min(score, 100);

    const label = score >= 80 ? 'Excellent'
                : score >= 60 ? 'Good'
                : score >= 40 ? 'Fair'
                : 'Low';

    // ── Persist result back to user ─────────────────────────────
    await User.findByIdAndUpdate(userId, {
      $set: {
        'trustScore.overall':     score,
        'trustScore.lastUpdated': new Date(),
      }
    });

    console.log(`[TrustScore] User ${userId}: score=${score} label="${label}"`);

    return { score, label, breakdown };

  } catch (err) {
    // Non-fatal — log but don't crash the main flow
    console.error(`[TrustScore] Failed for user ${userId}:`, err.message);
    throw err;
  }
};

// ════════════════════════════════════════════════════════════════
//  EXPORTS
// ════════════════════════════════════════════════════════════════

module.exports = {
  extractSkills,
  calculateClientTrustScore,
};
