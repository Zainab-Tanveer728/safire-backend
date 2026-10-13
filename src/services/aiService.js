// Node 18+ has a global fetch. 'node-fetch' v3 breaks with require(), so only use it as a fallback.
const fetch = global.fetch || require('node-fetch');

const AI_BACKEND_URL = process.env.AI_BACKEND_URL || 'http://localhost:8001';

exports.extractSkills = async ({ githubLanguages, githubRepos, resumeText }) => {
  const response = await fetch(`${AI_BACKEND_URL}/api/extract-skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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

  // Normalise snake_case -> camelCase for rest of Node app
  return {
    skills:          data.skills,
    summary:         data.summary,
    topCategory:     data.top_category,
    experienceLevel: data.experience_level,
  };
};

// ── Skill Gap Detector (Module 2, FE-3) ───────────────────────────
// Small helper: calls the Python AI service and turns its error replies into a JS Error that carries
// .status, .code and .suggestions, so the controller can answer the frontend properly.
async function callAi(path, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);   // first call can be slow while the model warms up
  try {
    const response = await fetch(`${AI_BACKEND_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body:    body ? JSON.stringify(body) : undefined,
      signal:  controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      let message = 'AI backend call failed';
      if (typeof detail === 'string') message = detail;
      else if (Array.isArray(detail)) message = 'Invalid request sent to the AI service.';
      else if (detail && detail.message) message = detail.message;
      const err = new Error(message);
      err.status      = response.status;
      err.code        = detail && detail.code;
      err.suggestions = (detail && detail.suggestions) || [];
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// skills: [{ name, sources: ['profile','resume','github'] }]   selectedSources: ['profile', ...]
exports.analyzeSkillGap = ({ targetRole, skills, selectedSources }) =>
  callAi('/skill-gap/analyze', {
    method: 'POST',
    body: { target_role: targetRole, skills, selected_sources: selectedSources },
  });

exports.getSkillGapRoles = async (q) => {
  const data = await callAi(`/skill-gap/roles${q ? `?q=${encodeURIComponent(q)}` : ''}`, { timeoutMs: 10000 });
  return data.roles || [];
};

// ── Resume Enhancer (Module 2, FE-2) ──────────────────────────────
// enhance: scores + suggested edits (calls the language model, so it gets a longer time limit)
// score:   scores only (no language model): quick, used by "Re-analyse"
exports.enhanceResume = ({ resumeText, targetRoles, profileSkills }) =>
  callAi('/resume/enhance', {
    method: 'POST',
    body: { resume_text: resumeText, target_roles: targetRoles || [], profile_skills: profileSkills || [] },
    timeoutMs: 60000,
  });

exports.scoreResume = ({ resumeText, targetRoles, profileSkills }) =>
  callAi('/resume/score', {
    method: 'POST',
    body: { resume_text: resumeText, target_roles: targetRoles || [], profile_skills: profileSkills || [] },
    timeoutMs: 20000,
  });