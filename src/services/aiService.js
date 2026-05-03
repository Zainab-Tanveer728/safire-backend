const fetch = require('node-fetch');   // or use axios

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

  // Normalise snake_case → camelCase for rest of Node app
  return {
    skills:          data.skills,
    summary:         data.summary,
    topCategory:     data.top_category,
    experienceLevel: data.experience_level,
  };
};