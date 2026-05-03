const fetch = require('node-fetch');

const fetchGitHubProfile = async (token) => {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

const fetchGitHubRepos = async (token) => {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
};

const fetchLanguages = async (token, repos) => {
  const languageMap = {};
  for (const repo of repos.slice(0, 20)) {
    const res = await fetch(repo.languages_url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const langs = await res.json();
    for (const [lang, bytes] of Object.entries(langs)) {
      languageMap[lang] = (languageMap[lang] || 0) + bytes;
    }
  }
  return languageMap;
};

module.exports = { fetchGitHubProfile, fetchGitHubRepos, fetchLanguages };