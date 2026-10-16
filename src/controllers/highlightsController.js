// safire-backend/src/controllers/highlightsController.js
// npm i multer pdf-parse mammoth
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { extractHighlightsAI } = require('../services/aiProposalService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
exports.uploadResume = upload.single('resume');

async function resumeText(file) {
  const name = (file.originalname || '').toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    return (await pdfParse(file.buffer)).text;
  }
  if (name.endsWith('.docx')) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  }
  throw new Error('Please upload a PDF or DOCX file');
}

async function githubSummary(username) {
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username || '')) throw new Error('Invalid GitHub username');

  const headers = { 'User-Agent': 'safire-app' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`; // optional, raises rate limit

  const r = await fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=pushed`, { headers });
  if (r.status === 404) throw new Error('GitHub user not found');
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);

  const repos = (await r.json()).filter((x) => !x.fork);
  if (!repos.length) throw new Error('No public repositories found');

  const langs = {};
  repos.forEach((x) => { if (x.language) langs[x.language] = (langs[x.language] || 0) + 1; });
  const topLangs = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `${l} (${n} repos)`);

  const topRepos = [...repos]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 6)
    .map((x) => `- ${x.name}: ${x.description || 'no description'} [${x.language || 'n/a'}, ${x.stargazers_count} stars]`);

  return `Public repos: ${repos.length}\nTop languages: ${topLangs.join(', ')}\nNotable repos:\n${topRepos.join('\n')}`;
}

exports.extract = async (req, res) => {
  try {
    const { source, username } = req.body;
    let text;

    if (source === 'resume') {
      if (!req.file) return res.status(400).json({ message: 'Resume file is required' });
      text = (await resumeText(req.file)).trim();
      if (text.length < 50) throw new Error('Could not read text from this file (scanned PDF?)');
    } else if (source === 'github') {
      text = await githubSummary(username);
    } else {
      return res.status(400).json({ message: 'Invalid source' });
    }

    const highlights = await extractHighlightsAI(source, text.slice(0, 6000));
    res.json({ highlights });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};