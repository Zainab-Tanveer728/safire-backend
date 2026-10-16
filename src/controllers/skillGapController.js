// Skill Gap Detector (Module 2, FE-3 / mockup M19)
// Flow: logged-in freelancer -> we collect their skills + evidence from the DB -> Python AI service
//       compares them with the role profile -> we save the report -> we answer the frontend.
const SkillGapReport = require('../models/skillGapReport');
const aiService      = require('../services/aiService');

const VALID_SOURCES = ['profile', 'resume', 'github'];
const MAX_SKILLS    = 200;   // the AI service accepts at most 200

// ── helpers ───────────────────────────────────────────────────────────────────
// Frontend sends ['Profile','Resume','GitHub'] (any case). No value = use every source.
function parseSources(raw) {
  if (raw === undefined || raw === null) return VALID_SOURCES.slice();
  if (!Array.isArray(raw)) return null;
  const clean = [...new Set(raw.map((s) => String(s).trim().toLowerCase()).filter((s) => VALID_SOURCES.includes(s)))];
  return clean.length ? clean : null;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word match, so "Java" is not found inside "JavaScript". Very short names (R, C, Go) are skipped
// because they match too many ordinary words.
function mentions(text, name) {
  if (!text || name.length < 3) return false;
  return new RegExp(`(?<![A-Za-z0-9+#])${escapeRegex(name)}(?![A-Za-z0-9+#])`, 'i').test(text);
}

// Every skill on the profile counts as "profile" evidence. It also gets "resume" evidence if it was
// extracted from the resume or is written in the resume text, and "github" evidence if it came from GitHub
// or is one of the user's top GitHub languages. More sources = higher proficiency in the AI engine.
function buildSkillsWithEvidence(user) {
  const resumeText = user.resumeText || '';
  const languages  = (user.githubStats?.topLanguages || []).map((l) => String(l).toLowerCase());
  const merged = new Map();

  for (const s of user.skills || []) {
    const name = String(s?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const entry = merged.get(key) || { name, sources: new Set() };

    entry.sources.add('profile');
    if (s.source === 'resume' || s.source === 'both') entry.sources.add('resume');
    if (s.source === 'github' || s.source === 'both') entry.sources.add('github');
    if (mentions(resumeText, name)) entry.sources.add('resume');
    if (languages.includes(key))    entry.sources.add('github');

    merged.set(key, entry);
  }
  return [...merged.values()]
    .slice(0, MAX_SKILLS)
    .map(({ name, sources }) => ({ name, sources: [...sources] }));
}

// AI service (snake_case) -> frontend (camelCase). `strong / weak / missing` keep the old names so
// older screens still work.
function shapeResult(r) {
  const names = (list) => (list || []).map((name) => ({ name }));
  return {
    targetRole:   r.role.title,
    roleId:       r.role.id,
    overallMatch: r.overall_match_score,
    scoreBand:    r.score_band,
    counts:       r.counts,
    strong:       names(r.strong_skills),
    weak:         names(r.weak_skills),
    missing:      names(r.missing_skills),
    criticalGaps: r.critical_gaps || [],
    breakdown: (r.breakdown || []).map((b) => ({
      skill:       b.skill,
      tier:        b.tier,
      status:      b.status,
      proficiency: b.proficiency,
      matchedWith: b.matched_with,
      matchType:   b.match_type,
      sources:     b.sources || [],
    })),
    recommendations: (r.learning_recommendations || []).map((x) => ({
      skill: x.skill, tier: x.tier, status: x.status, courses: x.courses || [],
    })),
    confidence:     r.confidence,
    aiGenerated:    r.ai_generated !== false,
    warnings:       r.warnings || [],
    sourcesUsed:    r.sources_used || [],
    skillsAnalyzed: r.skills_analyzed,
    processingMs:   r.processing_ms,
  };
}

function toReportDoc(freelancerId, shaped, aiModel) {
  const flatRecs = [];
  shaped.recommendations.forEach((rec) =>
    rec.courses.forEach((c) =>
      flatRecs.push({ skill: rec.skill, tier: rec.tier, status: rec.status, course: c.title, platform: c.provider, url: c.url })));

  const of = (status) => shaped.breakdown.filter((b) => b.status === status);
  return {
    freelancer:        freelancerId,
    targetRole:        shaped.targetRole,
    roleId:            shaped.roleId,
    overallMatchScore: shaped.overallMatch,
    scoreBand:         shaped.scoreBand,
    confidence:        shaped.confidence,
    sourcesUsed:       shaped.sourcesUsed,
    skillsAnalyzed:    shaped.skillsAnalyzed,
    processingMs:      shaped.processingMs,
    warnings:          shaped.warnings,
    aiGenerated:       shaped.aiGenerated,
    aiModel,
    strongSkills:      of('STRONG').map((b) => ({ name: b.skill, proficiency: b.proficiency })),
    weakSkills:        of('WEAK').map((b) => ({ name: b.skill, proficiency: b.proficiency })),
    missingSkills:     of('MISSING').map((b) => ({ name: b.skill, importance: b.tier })),
    recommendations:   flatRecs,
    fullResult:        shaped,
  };
}

// ── POST /api/freelancer/skill-gap ─────────────────────────────────────────────
exports.analyseSkillGap = async (req, res) => {
  try {
    const targetRole = String(req.body?.targetRole || '').trim();
    if (targetRole.length < 2)   return res.status(400).json({ message: 'Target role is required.' });
    if (targetRole.length > 100) return res.status(400).json({ message: 'Target role is too long.' });

    const selected = parseSources(req.body?.sources);
    if (!selected) {
      return res.status(400).json({ message: 'Choose at least one skill source: Profile, Resume or GitHub.' });
    }

    const skills = buildSkillsWithEvidence(req.user);
    if (skills.length === 0) {
      return res.status(400).json({ message: 'Please add some skills in your profile first.' });
    }

    let result;
    try {
      result = await aiService.analyzeSkillGap({ targetRole, skills, selectedSources: selected });
    } catch (err) {
      if (err.status === 422) {   // unknown role, or no skills in the chosen sources
        return res.status(422).json({ message: err.message, code: err.code, suggestions: err.suggestions || [] });
      }
      console.error('Skill gap AI error:', err.message);
      return res.status(503).json({ message: 'Skill analysis is temporarily unavailable. Please try again in a moment.' });
    }

    const shaped = shapeResult(result);

    let reportId = null;   // a failed save must not hide a good analysis from the user
    try {
      const report = await SkillGapReport.create(toReportDoc(req.user._id, shaped, result.model));
      reportId = report._id;
    } catch (err) {
      console.error('Skill gap report save failed:', err.message);
    }

    res.json({ success: true, reportId, ...shaped });
  } catch (err) {
    console.error('Skill gap error:', err.message);
    res.status(500).json({ message: 'Skill gap analysis failed. Please try again.' });
  }
};

// ── GET /api/freelancer/skill-gap/latest ───────────────────────────────────────
// Reports saved before this version have no fullResult, so they are treated as "no report".
exports.getLatestSkillGapReport = async (req, res) => {
  try {
    const report = await SkillGapReport.findOne({ freelancer: req.user._id })
      .sort({ createdAt: -1 })
      .select('fullResult createdAt')
      .lean();
    if (!report || !report.fullResult) return res.json({ success: true, report: null });
    res.json({ success: true, report: { ...report.fullResult, reportId: report._id, createdAt: report.createdAt } });
  } catch (err) {
    console.error('Latest skill gap report error:', err.message);
    res.status(500).json({ message: 'Could not load your last report.' });
  }
};

// ── GET /api/freelancer/skill-gap/roles?q= ─────────────────────────────────────
exports.getSkillGapRoles = async (req, res) => {
  try {
    const roles = await aiService.getSkillGapRoles(req.query.q);
    res.json({ success: true, roles });
  } catch (err) {
    console.error('Skill gap roles error:', err.message);
    res.status(503).json({ message: 'Role list is temporarily unavailable.' });
  }
};