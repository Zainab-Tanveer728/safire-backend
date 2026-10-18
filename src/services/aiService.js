const fetch              = require('node-fetch');
const User               = require('../models/User');

const AI_BACKEND_URL = process.env.AI_BACKEND_URL || 'http://localhost:8001';

// Small helper: call the Python AI backend and return its JSON.
//
// On failure it throws an Error that carries:
//   err.status       HTTP status (422 = a problem the user can fix, 503 = AI service down, ...)
//   err.code         e.g. "UNKNOWN_ROLE", "NO_SKILLS"   (from FastAPI's detail.code)
//   err.suggestions  e.g. role suggestions              (from FastAPI's detail.suggestions)
// The controllers rely on err.status === 422 to decide between "show the user a message"
// and "AI is temporarily unavailable".
const callAiBackend = async (path, { method = 'GET', body } = {}) => {
  let response;
  try {
    response = await fetch(`${AI_BACKEND_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (networkErr) {
    const err = new Error(`AI service is not reachable (${networkErr.message})`);
    err.status = 503;
    throw err;
  }

  if (!response.ok) {
    const data   = await response.json().catch(() => ({}));
    const detail = data.detail;
    const err    = new Error(`AI backend call failed (${response.status})`);
    err.status   = response.status;

    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      // Our own HTTPException({code, message, suggestions})
      err.message     = detail.message || err.message;
      err.code        = detail.code;
      err.suggestions = detail.suggestions || [];
    } else if (Array.isArray(detail)) {
      // Pydantic validation error = our request was malformed (a bug, not the user's fault).
      // Treat it as a server-side problem so the user sees "temporarily unavailable", and log the details.
      err.message = `AI service rejected the request: ${JSON.stringify(detail)}`;
      err.status  = 500;
    } else if (typeof detail === 'string' && detail) {
      err.message = detail;
    }
    throw err;
  }

  return response.json();
};

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
//  SKILL GAP DETECTOR
//    GET  /skill-gap/roles    -> list of target roles
//    POST /skill-gap/analyze  -> gap analysis for a role
//  The controller passes camelCase ({ targetRole, skills, selectedSources });
//  here we convert to the snake_case the Python service expects.
//  The backend's JSON is returned as-is (the controller shapes it for the frontend).
// ════════════════════════════════════════════════════════════════

const getSkillGapRoles = async (q) => {
  const query = q && String(q).trim() ? `?q=${encodeURIComponent(String(q).trim())}` : '';
  const data = await callAiBackend(`/skill-gap/roles${query}`);
  return data.roles || [];
};

const analyzeSkillGap = async ({ targetRole, skills, selectedSources } = {}) => {
  return callAiBackend('/skill-gap/analyze', {
    method: 'POST',
    body: {
      target_role:      targetRole,
      skills:           skills || [],
      selected_sources: selectedSources,   // undefined is dropped by JSON.stringify = "use every source"
    },
  });
};

// ════════════════════════════════════════════════════════════════
//  RESUME ENHANCER
//    POST /resume/enhance  -> scores + suggested edits + improved text
//    POST /resume/score    -> scores only (fast, no language model)
//  Input (camelCase): { resumeText, targetRoles: [..], profileSkills: [..] }
// ════════════════════════════════════════════════════════════════

const resumeBody = ({ resumeText, targetRoles, profileSkills }) => ({
  resume_text:    resumeText || '',
  target_roles:   targetRoles || [],
  profile_skills: profileSkills || [],
});

const enhanceResume = async (input = {}) =>
  callAiBackend('/resume/enhance', { method: 'POST', body: resumeBody(input) });

const scoreResume = async (input = {}) =>
  callAiBackend('/resume/score', { method: 'POST', body: resumeBody(input) });

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
  getSkillGapRoles,
  analyzeSkillGap,
  enhanceResume,
  scoreResume,
  calculateClientTrustScore,
};