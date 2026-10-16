const User = require('../models/User');
const GigOptimization = require('../models/gigOptimization');

// Python AI service. Set AI_SERVICE_URL in safire-backend/.env (e.g. http://localhost:8001)
const AI_URL = (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/$/, '');
const LEVELS = ['Beginner', 'Intermediate', 'Expert'];

// ── helpers ──────────────────────────────────────────────────────
const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const asArray = (v) => (Array.isArray(v) ? v : []);
const skillName = (s) => (typeof s === 'string' ? s : s?.name || s?.skill || s?.label || '');

// Reads the freelancer's profile. If your User.js uses different field names, add them here.
function buildProfile(user = {}) {
  const p = user.freelancerProfile || user.profile || {};
  const get = (keys) => pick(p, keys) ?? pick(user, keys);

  const name =
    get(['fullName', 'name']) || [user.firstName, user.lastName].filter(Boolean).join(' ') || '';
  const years = Number(get(['experienceYears', 'yearsOfExperience', 'totalExperience']));

  return {
    name: String(name),
    title: String(get(['title', 'headline', 'professionalTitle', 'jobTitle', 'designation']) || ''),
    bio: String(get(['bio', 'about', 'summary', 'description']) || ''),
    skills: asArray(get(['skills'])).map(skillName).filter(Boolean),
    experience_years: Number.isFinite(years) ? years : null,
    portfolio_count: asArray(get(['portfolio', 'portfolioItems', 'projects'])).length,
    certifications_count: asArray(get(['certifications', 'certificates'])).length,
  };
}

async function callAI(path, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${AI_URL}${path}`, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadUser(req) {
  return (await User.findById(req.user._id).lean()) || req.user;
}

// ── GET /api/freelancer/gig-optimizer/profile  (FR21.3 auto-fill skills) ──
exports.getGigOptimizerProfile = async (req, res) => {
  try {
    const { name, title, skills } = buildProfile(await loadUser(req));
    res.json({ name, title, skills });
  } catch (err) {
    res.status(500).json({ message: 'Could not load your profile.' });
  }
};

// ── GET /api/freelancer/gig-optimizer/categories  (FR21.1 auto-suggest) ──
exports.getGigCategories = async (req, res) => {
  try {
    const r = await callAI('/gig-optimizer/categories', {}, 5000);
    if (!r.ok) return res.json({ categories: [] });
    res.json(await r.json());
  } catch {
    res.json({ categories: [] });
  }
};

// ── POST /api/freelancer/optimize-gig  (FR21.4) ──────────────────
exports.optimizeGig = async (req, res) => {
  try {
    const gigType = String(req.body.gigType || '').trim();
    const experienceLevel = LEVELS.includes(req.body.experienceLevel) ? req.body.experienceLevel : 'Intermediate';
    const skills = [...new Set(asArray(req.body.skills).map((s) => String(s).trim()).filter(Boolean))].slice(0, 20);

    if (gigType.length < 3 || gigType.length > 120) {
      return res.status(400).json({ message: 'Gig type must be between 3 and 120 characters.' });
    }
    if (skills.length < 2) {
      return res.status(400).json({ message: 'Please add at least 2 skills.' });
    }

    const profile = buildProfile(await loadUser(req));

    let aiRes;
    try {
      aiRes = await callAI('/gig-optimizer/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gig_type: gigType,
          experience_level: experienceLevel,
          key_skills: skills,
          profile,
        }),
      });
    } catch (err) {
      const timedOut = err.name === 'AbortError';
      return res.status(timedOut ? 504 : 503).json({
        message: timedOut ? 'The AI service took too long. Please try again.' : 'AI service is unavailable right now.',
      });
    }

    const data = await aiRes.json().catch(() => ({}));
    if (!aiRes.ok) {
      // Python sends readable messages (e.g. "Could not recognize these skills: ...") in `detail`
      const detail = typeof data.detail === 'string' ? data.detail : 'Optimization failed.';
      return res.status(aiRes.status === 422 ? 400 : 502).json({ message: detail });
    }

    // Saving history must never break the response.
    GigOptimization.create({
      user: req.user._id, gigType, experienceLevel, skills, result: data,
    }).catch((e) => console.error('GigOptimization save failed:', e.message));

    res.json(data);
  } catch (err) {
    console.error('optimizeGig error:', err);
    res.status(500).json({ message: 'Something went wrong while optimizing your gig.' });
  }
};