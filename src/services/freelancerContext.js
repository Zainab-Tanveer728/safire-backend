// src/services/freelancerContext.js
// ONE place that turns a user's REAL onboarding data into a clean "freelancer context" for Module 2
// (proposal generator, skill gap, resume enhancer, gig optimizer) and for the pages that show it.
//
// Where the data comes from (all saved by the onboarding pages):
//   Basic profile page   -> name, headline, bio, location
//   Connect sources page -> githubUsername, githubStats, githubCache (repos + language bytes), resumeText, resumeFileName
//   Analysis page        -> skills[] (category, source, confidence), aiProfile (summary, level, main area)
//   Review skills page   -> skills[] (only the confirmed ones), onboarding.skillsReviewed
//   Employer verification-> employerVerifications[]
//
// Privacy: the result never contains email, phone, tokens or file paths. The full resume text is only
// included when a server-side feature asks for it (resume enhancer), never sent to the browser.

const MAX_SKILLS = 40;

const pct = (x) => (typeof x === 'number' ? Math.round(x * 100) : null);
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function languageShares(languages = {}) {
  const entries = Object.entries(languages).filter(([, v]) => Number(v) > 0);
  const total = entries.reduce((sum, [, v]) => sum + Number(v), 0);
  if (!total) return [];
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, bytes]) => ({ name, share: Math.round((Number(bytes) / total) * 100) }));
}

// What is missing, and where the user can fix it
function assessDataQuality(ctx) {
  const checks = [
    { key: 'skills',   ok: ctx.skills.verified.length > 0, label: 'Verified skills',        fixPath: '/onboarding/connect' },
    { key: 'github',   ok: ctx.github.connected,            label: 'GitHub connected',       fixPath: '/onboarding/connect' },
    { key: 'resume',   ok: ctx.resume.present,              label: 'Resume uploaded',        fixPath: '/onboarding/connect' },
    { key: 'headline', ok: !!ctx.profile.headline,          label: 'Headline',               fixPath: '/freelancer/profile/edit' },
    { key: 'bio',      ok: !!ctx.profile.bio,               label: 'Bio',                    fixPath: '/freelancer/profile/edit' },
  ];
  return {
    completeness: Math.round((checks.filter(c => c.ok).length / checks.length) * 100),
    missing: checks.filter(c => !c.ok).map(({ key, label, fixPath }) => ({ key, label, fixPath })),
  };
}

function buildFreelancerContext(user, { includeResumeText = false, maxResumeChars = 6000 } = {}) {
  const all = (user.skills || []).slice(0, MAX_SKILLS);
  const verified = all.filter(s => s.verified).map(s => ({
    name: s.name, category: s.category || 'Other', source: s.source || 'resume', confidence: pct(s.confidence),
  }));
  const selfReported = all.filter(s => !s.verified).map(s => s.name);

  const byCategory = {};
  all.forEach(s => { (byCategory[s.category || 'Other'] ||= []).push(s.name); });

  const cache = user.githubCache || {};
  let languages = languageShares(cache.languages);
  if (!languages.length && user.githubStats?.topLanguages?.length) {
    languages = user.githubStats.topLanguages.map(name => ({ name, share: null }));
  }

  const resumeText = user.resumeText || '';
  const ctx = {
    profile: {
      name: user.name || '',
      headline: clip(user.headline, 120),
      bio: clip(user.bio, 600),
      location: user.location || '',
    },
    experienceLevel: user.aiProfile?.experienceLevel || null,
    mainArea:        user.aiProfile?.topCategory || null,
    aiSummary:       clip(user.aiProfile?.summary, 300),
    skills: { verified, selfReported, byCategory },
    github: {
      connected:   !!user.githubUsername,
      username:    user.githubUsername || null,
      publicRepos: user.githubStats?.publicRepos ?? null,
      languages,
      topRepos: (cache.repos || []).slice(0, 6).map(r => ({ name: r.name, description: clip(r.description, 140), language: r.language || null })),
      asOf: cache.fetchedAt || user.githubStats?.lastFetchedAt || null,
    },
    resume: {
      present:  !!(resumeText || user.resumeUrl),
      fileName: user.resumeFileName || null,
      chars:    resumeText.length,
      ...(includeResumeText ? { text: resumeText.slice(0, maxResumeChars) } : { excerpt: clip(resumeText, 500) }),
    },
    employers: (user.employerVerifications || [])
      .filter(v => v.status === 'confirmed')
      .map(v => ({ company: v.companyName, jobTitle: v.jobTitle || '' })),
    portfolio: (user.portfolio || []).slice(0, 6).map(p => ({
      title: p.title, description: clip(p.description, 200), techStack: p.techStack || [], url: p.url || null,
    })),
    trustScore: typeof user.trustScore?.overall === 'number' ? user.trustScore.overall : null,
  };
  ctx.dataQuality = assessDataQuality(ctx);
  return ctx;
}

// Rules every Module 2 prompt should include, so the AI does not invent experience
const PROMPT_RULES =
  'Use ONLY the facts in the FREELANCER PROFILE above. Never invent skills, employers, years of experience, ' +
  'projects or results. Treat self-reported skills as unverified: mention them cautiously or not at all. ' +
  'If the profile lacks the information needed, say what is missing instead of guessing.';

// A compact text block to put into an AI prompt
function contextToPromptText(ctx) {
  const lines = ['FREELANCER PROFILE (taken from the user\'s real data)'];
  lines.push(`Name: ${ctx.profile.name || 'unknown'}`);
  if (ctx.profile.headline) lines.push(`Headline: ${ctx.profile.headline}`);
  if (ctx.profile.location) lines.push(`Location: ${ctx.profile.location}`);
  if (ctx.profile.bio)      lines.push(`Bio: ${ctx.profile.bio}`);
  if (ctx.experienceLevel)  lines.push(`Experience level (AI estimate): ${ctx.experienceLevel}${ctx.mainArea ? `, main area ${ctx.mainArea}` : ''}`);
  if (ctx.aiSummary)        lines.push(`Summary: ${ctx.aiSummary}`);

  lines.push('VERIFIED SKILLS (found in their GitHub or resume): ' + (
    ctx.skills.verified.length
      ? ctx.skills.verified.map(s => `${s.name} (${s.category}${s.confidence !== null ? `, ${s.confidence}%` : ''})`).join('; ')
      : 'none'));
  if (ctx.skills.selfReported.length) lines.push('SELF-REPORTED SKILLS (not verified): ' + ctx.skills.selfReported.join(', '));

  if (ctx.github.connected) {
    const langs = ctx.github.languages.map(l => (l.share !== null ? `${l.name} ${l.share}%` : l.name)).join(', ');
    lines.push(`GITHUB: @${ctx.github.username}${ctx.github.publicRepos !== null ? `, ${ctx.github.publicRepos} public repositories` : ''}${langs ? `. Main languages: ${langs}` : ''}`);
    if (ctx.github.topRepos.length) {
      lines.push('Notable repositories: ' + ctx.github.topRepos.map(r => `${r.name}${r.description ? ` - ${r.description}` : ''}${r.language ? ` [${r.language}]` : ''}`).join('; '));
    }
  } else {
    lines.push('GITHUB: not connected');
  }
  if (ctx.employers.length) lines.push('CONFIRMED EMPLOYERS: ' + ctx.employers.map(e => `${e.company}${e.jobTitle ? ` (${e.jobTitle})` : ''}`).join('; '));
  if (ctx.portfolio.length) lines.push('PORTFOLIO: ' + ctx.portfolio.map(p => `${p.title}${p.techStack.length ? ` [${p.techStack.join(', ')}]` : ''}`).join('; '));
  if (ctx.resume.text) lines.push('RESUME TEXT:\n' + ctx.resume.text);
  else if (ctx.resume.excerpt) lines.push('RESUME EXCERPT: ' + ctx.resume.excerpt);
  return lines.join('\n');
}

module.exports = { buildFreelancerContext, contextToPromptText, assessDataQuality, PROMPT_RULES };