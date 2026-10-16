// src/controllers/jobController.js  (NEW)
// Post a job -> freelancers apply -> client hires -> a Project is created.
const mongoose = require('mongoose');
const Job            = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const Project        = require('../models/Project');
const User           = require('../models/User');
const { notify }     = require('../services/notificationService');

const PERSON = 'name avatarUrl headline location trustScore.overall';
// A client's trust score. Same maths as the client dashboard, so the number a freelancer sees on a job
// is the number the client sees on their own dashboard.
const CLIENT_FIELDS = 'name avatarUrl isVerified company.companyName company.industry company.companySize company.country company.location company.website company.description';
function withTrust(client) {
  if (!client) return client;
  const c = client.company || {};
  let t = 0;
  if (client.isVerified) t += 20;
  if (c.companyName) t += 15;
  if (c.industry) t += 15;
  if (c.website) t += 10;
  if (c.description) t += 15;
  if (c.companySize) t += 10;
  if (c.country || c.location) t += 10;
  const { isVerified, ...rest } = client;
  return { ...rest, trustScore: { overall: Math.min(t, 100) } };
}
const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skillList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(clean).filter(Boolean).slice(0, 20);
const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { console.error('[Job]', err.message); res.status(500).json({ message: 'Server error.' }); }
};

// ── Jobs ────────────────────────────────────────────────────────────────────
const EXPERIENCE = ['junior', 'mid', 'senior'];
const ENGAGEMENT = ['fixed', 'hourly'];

// Checks the form and returns { error } or { data }. A draft may be incomplete; a published job may not.
function readJobForm(b, { draft }) {
  const title = clean(b.title);
  const description = String(b.description || '').trim();
  const skills = skillList(b.skills);
  if (draft) { if (title.length < 3) return { error: 'Give the draft a title so you can find it later.' }; }
  else {
    if (title.length < 5)        return { error: 'Please give the job a title (at least 5 characters).' };
    if (description.length < 20)  return { error: 'Please describe the job (at least 20 characters).' };
    if (!skills.length)           return { error: 'Add at least one required skill.' };
    if (!EXPERIENCE.includes(b.experienceLevel)) return { error: 'Please choose the experience level you need.' };
  }
  const min = num(b.budgetMin), max = num(b.budgetMax);
  if ([min, max].some((x) => x !== undefined && (Number.isNaN(x) || x < 0))) return { error: 'Budget must be a positive number.' };
  if (min !== undefined && max !== undefined && min > max) return { error: 'Minimum budget cannot be higher than maximum.' };
  const startDate = b.startDate ? new Date(b.startDate) : undefined;
  const deadline = b.deadline ? new Date(b.deadline) : undefined;
  if ((startDate && Number.isNaN(startDate.getTime())) || (deadline && Number.isNaN(deadline.getTime()))) return { error: 'A date is not valid.' };
  if (startDate && deadline && deadline < startDate) return { error: 'The end date must be after the start date.' };
  return { data: {
    title, description, skills, category: clean(b.category) || undefined, budgetMin: min, budgetMax: max, startDate, deadline,
    engagementType: ENGAGEMENT.includes(b.engagementType) ? b.engagementType : 'fixed',
    experienceLevel: EXPERIENCE.includes(b.experienceLevel) ? b.experienceLevel : undefined,
    additionalRequirements: String(b.additionalRequirements || '').trim().slice(0, 2000) || undefined,
  } };
}

// POST /api/jobs   (client)   body.draft = true saves a draft instead of publishing
exports.createJob = wrap(async (req, res) => {
  const draft = req.body?.draft === true || req.body?.draft === 'true';
  const { error, data } = readJobForm(req.body || {}, { draft });
  if (error) return res.status(400).json({ message: error });
  const job = await Job.create({ ...data, client: req.user._id, status: draft ? 'draft' : 'open' });
  res.status(201).json({ job });
});

// PUT /api/jobs/:id   (owner)  edit a draft; body.publish = true also publishes it
exports.updateJob = wrap(async (req, res) => {
  const job = await ownJob(req, res); if (!job) return;
  if (job.status !== 'draft') return res.status(409).json({ message: 'Only a draft can be edited.' });
  const publish = req.body?.publish === true || req.body?.publish === 'true';
  const { error, data } = readJobForm(req.body || {}, { draft: !publish });
  if (error) return res.status(400).json({ message: error });
  Object.assign(job, data);
  if (publish) job.status = 'open';
  await job.save();
  res.json({ job });
});

// DELETE /api/jobs/:id   (owner)  drafts only
exports.deleteDraft = wrap(async (req, res) => {
  const job = await ownJob(req, res); if (!job) return;
  if (job.status !== 'draft') return res.status(409).json({ message: 'Only a draft can be deleted. Close the job instead.' });
  await job.deleteOne();
  res.json({ ok: true });
});

// GET /api/jobs?mine=1&q=&skill=&status=
//  client: always their own jobs.  freelancer: all open jobs (with whether they already applied).
exports.listJobs = wrap(async (req, res) => {
  const { q, skill, status } = req.query;
  const filter = {};
  if (req.user.role === 'client') {
    filter.client = req.user._id;
    if (['draft', 'open', 'in_progress', 'closed'].includes(status)) filter.status = status;
  } else {
    filter.status = 'open';
  }
  if (q) { const r = new RegExp(esc(q), 'i'); filter.$or = [{ title: r }, { description: r }, { skills: r }]; }
  if (skill) filter.skills = new RegExp(`^${esc(skill)}$`, 'i');

  const jobs = await Job.find(filter).sort({ createdAt: -1 }).limit(100)
    .populate('client', CLIENT_FIELDS).lean();
  const ids = jobs.map((j) => j._id);

  const counts = await JobApplication.aggregate([
    { $match: { job: { $in: ids } } }, { $group: { _id: '$job', n: { $sum: 1 } } },
  ]);
  const countOf = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  let mine = {};
  if (req.user.role === 'freelancer') {
    const apps = await JobApplication.find({ job: { $in: ids }, freelancer: req.user._id }).select('job status').lean();
    mine = Object.fromEntries(apps.map((a) => [String(a.job), a.status]));
  }
  res.json({ jobs: jobs.map((j) => ({ ...j, client: withTrust(j.client), applicationCount: countOf[String(j._id)] || 0, myApplicationStatus: mine[String(j._id)] || null })) });
});

// GET /api/jobs/:id
exports.getJob = wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' });
  const job = await Job.findById(req.params.id)
    .populate('client', `${CLIENT_FIELDS} headline location`).lean();
  if (!job) return res.status(404).json({ message: 'Job not found.' });

  const isOwner = String(job.client._id) === String(req.user._id);
  if (req.user.role === 'client' && !isOwner) return res.status(403).json({ message: 'This is another client\'s job.' });
  if (req.user.role === 'freelancer' && job.status !== 'open') {
    const mine = await JobApplication.exists({ job: job._id, freelancer: req.user._id });
    if (!mine) return res.status(404).json({ message: 'Job not found.' });
  }
  const out = { job: { ...job, client: withTrust(job.client) }, isOwner, applicationCount: await JobApplication.countDocuments({ job: job._id }) };
  if (req.user.role === 'freelancer') out.myApplication = await JobApplication.findOne({ job: job._id, freelancer: req.user._id }).lean();
  res.json(out);
});

// POST /api/jobs/:id/close   (owner)  - stop taking applications without hiring
exports.closeJob = wrap(async (req, res) => {
  const job = await ownJob(req, res); if (!job) return;
  if (job.status !== 'open') return res.status(409).json({ message: 'Only an open job can be closed.' });
  job.status = 'closed'; await job.save();
  const live = { $in: ['pending', 'shortlisted'] };
  const pending = await JobApplication.find({ job: job._id, status: live }).select('freelancer');
  await JobApplication.updateMany({ job: job._id, status: live }, { $set: { status: 'rejected' } });
  await Promise.all(pending.map((a) => notify(a.freelancer, {
    type: 'application_rejected', title: 'A job was closed',
    message: `"${job.title}" is no longer taking applications.`, link: `/freelancer/job/${job._id}`,
  })));
  res.json({ job });
});

async function ownJob(req, res) {
  if (!isId(req.params.id)) { res.status(400).json({ message: 'Invalid job id.' }); return null; }
  const job = await Job.findById(req.params.id);
  if (!job) { res.status(404).json({ message: 'Job not found.' }); return null; }
  if (String(job.client) !== String(req.user._id)) { res.status(403).json({ message: 'This is not your job.' }); return null; }
  return job;
}

// ── Applications ────────────────────────────────────────────────────────────
// POST /api/jobs/:id/apply   (freelancer)
exports.apply = wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' });
  const job = await Job.findById(req.params.id);
  if (!job || job.status !== 'open') return res.status(404).json({ message: 'This job is not open any more.' });

  const coverLetter = String(req.body?.coverLetter || '').trim();
  if (coverLetter.length < 30) return res.status(400).json({ message: 'Please write a short cover letter (at least 30 characters).' });
  const proposedBudget = num(req.body?.proposedBudget), estimatedDays = num(req.body?.estimatedDays);
  if (proposedBudget !== undefined && (Number.isNaN(proposedBudget) || proposedBudget < 0)) return res.status(400).json({ message: 'Your price must be a positive number.' });
  if (estimatedDays !== undefined && (Number.isNaN(estimatedDays) || estimatedDays < 1)) return res.status(400).json({ message: 'Estimated days must be at least 1.' });

  let application;
  try {
    application = await JobApplication.create({ job: job._id, freelancer: req.user._id, coverLetter, proposedBudget, estimatedDays });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You have already applied to this job.' });
    throw err;
  }
  await notify(job.client, {
    type: 'new_application', title: 'New application',
    message: `${req.user.name || 'A freelancer'} applied to "${job.title}".`,
    link: `/client/job/${job._id}`, email: true,
  });
  res.status(201).json({ application });
});

// GET /api/jobs/:id/applications   (job owner)
exports.listApplications = wrap(async (req, res) => {
  const job = await ownJob(req, res); if (!job) return;
  const applications = await JobApplication.find({ job: job._id }).sort({ createdAt: -1 })
    .populate('freelancer', `${PERSON} skills.name`).lean();
  const ids = applications.map((a) => a.freelancer?._id).filter(Boolean);
  const done = await Project.aggregate([
    { $match: { freelancer: { $in: ids }, status: 'completed' } }, { $group: { _id: '$freelancer', n: { $sum: 1 } } },
  ]);
  const doneOf = Object.fromEntries(done.map((d) => [String(d._id), d.n]));
  res.json({ applications: applications.map((a) => ({ ...a, freelancer: a.freelancer && {
    ...a.freelancer, skills: (a.freelancer.skills || []).map((s) => s.name).slice(0, 8), completedProjects: doneOf[String(a.freelancer._id)] || 0,
  } })) });
});

// GET /api/jobs/applications/mine   (freelancer)
exports.myApplications = wrap(async (req, res) => {
  const applications = await JobApplication.find({ freelancer: req.user._id }).sort({ createdAt: -1 })
    .populate({ path: 'job', select: 'title status budgetMin budgetMax currency client project', populate: { path: 'client', select: 'name company.companyName' } }).lean();
  res.json({ applications: applications.filter((a) => a.job) });
});

// POST /api/jobs/applications/:appId/withdraw   (the freelancer)
exports.withdraw = wrap(async (req, res) => {
  if (!isId(req.params.appId)) return res.status(400).json({ message: 'Invalid id.' });
  const app = await JobApplication.findOne({ _id: req.params.appId, freelancer: req.user._id });
  if (!app) return res.status(404).json({ message: 'Application not found.' });
  if (!['pending', 'shortlisted'].includes(app.status)) return res.status(409).json({ message: 'Only a pending application can be withdrawn.' });
  app.status = 'withdrawn'; await app.save();
  res.json({ application: app });
});

// POST /api/jobs/applications/:appId/shortlist   (job owner)
exports.shortlist = wrap(async (req, res) => {
  const { app, job } = await ownApplication(req, res); if (!app) return;
  if (app.status !== 'pending') return res.status(409).json({ message: 'Only a pending application can be shortlisted.' });
  app.status = 'shortlisted'; await app.save();
  await notify(app.freelancer, {
    type: 'application_shortlisted', title: 'You were shortlisted',
    message: `You are on the shortlist for "${job.title}".`, link: `/freelancer/job/${job._id}`,
  });
  res.json({ application: app });
});

// POST /api/jobs/applications/:appId/reject   (job owner)
exports.reject = wrap(async (req, res) => {
  const { app, job } = await ownApplication(req, res); if (!app) return;
  if (!['pending', 'shortlisted'].includes(app.status)) return res.status(409).json({ message: 'Only a pending application can be declined.' });
  app.status = 'rejected'; await app.save();
  await notify(app.freelancer, {
    type: 'application_rejected', title: 'Application not selected',
    message: `Your application for "${job.title}" was not selected this time.`, link: `/freelancer/job/${job._id}`,
  });
  res.json({ application: app });
});

// POST /api/jobs/applications/:appId/accept   (job owner)  -> hires and creates the Project
exports.accept = wrap(async (req, res) => {
  const { app, job } = await ownApplication(req, res); if (!app) return;
  if (!['pending', 'shortlisted'].includes(app.status)) return res.status(409).json({ message: 'Only a pending application can be accepted.' });

  // claim the job first: only one request can flip it from "open", so a double click cannot hire twice
  const claimed = await Job.findOneAndUpdate(
    { _id: job._id, status: 'open' },
    { $set: { status: 'in_progress', hiredFreelancer: app.freelancer } },
    { returnDocument: 'after' },
  );
  if (!claimed) return res.status(409).json({ message: 'This job already has a hired freelancer or is closed.' });

  let project;
  try {
    project = await Project.create({
      client: job.client, freelancer: app.freelancer, title: job.title, description: job.description,
      skills: job.skills, status: 'active', startDate: new Date(), deadline: job.deadline,
      budget: app.proposedBudget ?? job.budgetMax ?? job.budgetMin, currency: job.currency, job: job._id,
    });
  } catch (err) {
    // a second project for the same job is refused by the database: someone else's hire won, so leave the job alone
    if (err.code === 11000) return res.status(409).json({ message: 'This job already has a hired freelancer or is closed.' });
    await Job.updateOne({ _id: job._id }, { $set: { status: 'open' }, $unset: { hiredFreelancer: '' } });   // undo the claim
    throw err;
  }
  await Job.updateOne({ _id: job._id }, { $set: { project: project._id } });

  app.status = 'accepted'; await app.save();
  const others = await JobApplication.find({ job: job._id, _id: { $ne: app._id }, status: { $in: ['pending', 'shortlisted'] } }).select('freelancer');
  await JobApplication.updateMany({ _id: { $in: others.map((o) => o._id) } }, { $set: { status: 'rejected' } });

  await notify(app.freelancer, {
    type: 'application_accepted', title: 'You were hired',
    message: `${req.user.name || 'The client'} accepted your application for "${job.title}". The project is ready.`,
    link: `/freelancer/project/${project._id}`, email: true,
  });
  await Promise.all(others.map((o) => notify(o.freelancer, {
    type: 'application_rejected', title: 'Application not selected',
    message: `"${job.title}" was given to another freelancer.`, link: `/freelancer/job/${job._id}`,
  })));
  res.json({ project, application: app });
});

async function ownApplication(req, res) {
  if (!isId(req.params.appId)) { res.status(400).json({ message: 'Invalid id.' }); return {}; }
  const app = await JobApplication.findById(req.params.appId);
  if (!app) { res.status(404).json({ message: 'Application not found.' }); return {}; }
  const job = await Job.findById(app.job);
  if (!job || String(job.client) !== String(req.user._id)) { res.status(403).json({ message: 'This is not your job.' }); return {}; }
  return { app, job };
}

// ── Freelancer directory ────────────────────────────────────────────────────
// GET /api/freelancers/:id   (any logged-in user). Public-safe fields only.
exports.freelancerProfile = wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ message: 'Invalid id.' });
  const u = await User.findOne({ _id: req.params.id, role: 'freelancer', status: { $nin: ['suspended', 'removed'] } })
    .select('name avatarUrl headline bio location trustScore.overall skills.name skills.verified portfolio githubUrl linkedinUrl websiteUrl githubStats.publicRepos githubStats.topLanguages createdAt').lean();
  if (!u) return res.status(404).json({ message: 'Freelancer not found.' });
  const [completed, active] = await Promise.all([
    Project.countDocuments({ freelancer: u._id, status: 'completed' }),
    Project.countDocuments({ freelancer: u._id, status: 'active' }),
  ]);
  res.json({ freelancer: {
    _id: u._id, name: u.name, avatarUrl: u.avatarUrl, headline: u.headline, bio: u.bio, location: u.location,
    trustScore: u.trustScore?.overall ?? 0, memberSince: u.createdAt,
    skills: (u.skills || []).map((s) => ({ name: s.name, verified: !!s.verified })),
    portfolio: (u.portfolio || []).map((p) => ({ title: p.title, description: p.description, url: p.url, techStack: p.techStack })),
    links: { github: u.githubUrl, linkedin: u.linkedinUrl, website: u.websiteUrl },
    githubStats: u.githubStats && { publicRepos: u.githubStats.publicRepos, topLanguages: u.githubStats.topLanguages },
    completedProjects: completed, activeProjects: active,
  } });
});

// GET /api/freelancers?q=&skill=   (any logged-in user). Public-safe fields only.
exports.directory = wrap(async (req, res) => {
  const { q, skill } = req.query;
  const filter = { role: 'freelancer', status: { $nin: ['suspended', 'removed'] } };
  const and = [];
  if (q) { const r = new RegExp(esc(q), 'i'); and.push({ $or: [{ name: r }, { headline: r }, { 'skills.name': r }] }); }
  if (skill) and.push({ 'skills.name': new RegExp(`^${esc(skill)}$`, 'i') });
  if (and.length) filter.$and = and;

  const rows = await User.find(filter).select('name avatarUrl headline bio location trustScore.overall skills.name')
    .sort({ 'trustScore.overall': -1, name: 1 }).limit(60).lean();
  res.json({ freelancers: rows.map((u) => ({
    _id: u._id, name: u.name, avatarUrl: u.avatarUrl, headline: u.headline, location: u.location,
    bio: u.bio ? String(u.bio).slice(0, 200) : undefined, trustScore: u.trustScore?.overall ?? 0,
    skills: (u.skills || []).map((s) => s.name).slice(0, 8),
  })) });
});