// src/controllers/jobController.js  (REPLACE the earlier version)
// The hiring flow, the way real platforms do it:
//   post job (+ screening questions) -> freelancers apply with answers (or get invited) -> client opens the proposal
//   ("viewed"), shortlists, chats -> client sends ONE offer -> the freelancer accepts or declines
//   -> only when the freelancer accepts is the Project created.
const mongoose = require('mongoose');
const Job            = require('../models/Job');
const JobApplication = require('../models/JobApplication');
const Project        = require('../models/Project');
const User           = require('../models/User');
const { notify }     = require('../services/notificationService');
const { ratingSummaries } = require('./reviewController');

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
const OFFER_HOURS_DEFAULT = Number(process.env.OFFER_EXPIRES_HOURS) || 48;   // default time the freelancer has to answer an offer
const OFFER_HOURS_ALLOWED = [24, 48, 72];                                    // what the client may choose
const HOUR = 60 * 60 * 1000;
const MSG_LIMIT = Number(process.env.CHAT_MAX_PER_MINUTE) || 8;              // simple anti-spam
const DAY = 24 * 60 * 60 * 1000;
const LIVE = ['pending', 'shortlisted', 'offered'];            // an application the client can still decide on
const date = (v) => { if (!v) return undefined; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
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
  const rawQ = Array.isArray(b.screeningQuestions) ? b.screeningQuestions : [];
  const screeningQuestions = rawQ.map((q) => clean(typeof q === 'string' ? q : q?.question)).filter(Boolean).slice(0, 5)
    .map((question) => ({ question: question.slice(0, 300) }));
  return { data: {
    screeningQuestions,
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

  await expireOffers({ job: job._id });
  const isOwner = String(job.client._id) === String(req.user._id);
  if (req.user.role === 'client' && !isOwner) return res.status(403).json({ message: 'This is another client\'s job.' });
  if (req.user.role === 'freelancer' && job.status !== 'open') {
    const mine = await JobApplication.exists({ job: job._id, freelancer: req.user._id });
    if (!mine) return res.status(404).json({ message: 'Job not found.' });
  }
  const clientRating = (await ratingSummaries([job.client._id], 'client'))[String(job.client._id)] || { avg: 0, count: 0 };
  const out = { job: { ...job, client: { ...withTrust(job.client), rating: clientRating } }, isOwner, applicationCount: await JobApplication.countDocuments({ job: job._id }) };
  if (req.user.role === 'freelancer') {
    const mine = await JobApplication.findOne({ job: job._id, freelancer: req.user._id }).lean();
    if (mine) { const { messages, ...rest } = mine; out.myApplication = { ...rest, messageCount: (messages || []).length }; }
  }
  res.json(out);
});

// POST /api/jobs/:id/close   (owner)  - stop taking applications without hiring
exports.closeJob = wrap(async (req, res) => {
  const job = await ownJob(req, res); if (!job) return;
  if (job.status !== 'open') return res.status(409).json({ message: 'Only an open job can be closed.' });
  job.status = 'closed'; await job.save();
  const live = { $in: ['invited', 'pending', 'shortlisted', 'offered'] };
  const pending = await JobApplication.find({ job: job._id, status: live }).select('freelancer');
  await JobApplication.updateMany({ job: job._id, status: live }, { $set: { status: 'rejected' }, $unset: { offerSlot: '' } });
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
// POST /api/jobs/:id/apply   (freelancer)  body: { coverLetter, proposedBudget?, estimatedDays?, answers: [string] }
// answers are in the same order as job.screeningQuestions. A freelancer who was invited uses the same call to
// turn the invitation into a proposal.
exports.apply = wrap(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ message: 'Invalid job id.' });
  const job = await Job.findById(req.params.id);
  if (!job || job.status !== 'open') return res.status(404).json({ message: 'This job is not open any more.' });

  const coverLetter = String(req.body?.coverLetter || '').trim();
  if (coverLetter.length < 30) return res.status(400).json({ message: 'Please write a short cover letter (at least 30 characters).' });
  const proposedBudget = num(req.body?.proposedBudget), estimatedDays = num(req.body?.estimatedDays);
  if (proposedBudget !== undefined && (Number.isNaN(proposedBudget) || proposedBudget < 0)) return res.status(400).json({ message: 'Your price must be a positive number.' });
  if (estimatedDays !== undefined && (Number.isNaN(estimatedDays) || estimatedDays < 1)) return res.status(400).json({ message: 'Estimated days must be at least 1.' });

  // every screening question must be answered
  const given = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const answers = [];
  for (let i = 0; i < (job.screeningQuestions || []).length; i++) {
    const a = String(typeof given[i] === 'object' ? given[i]?.answer : given[i] ?? '').trim();
    if (!a) return res.status(400).json({ message: `Please answer the question: "${job.screeningQuestions[i].question}"` });
    answers.push({ question: job.screeningQuestions[i].question, answer: a.slice(0, 2000) });
  }

  let application;
  // an invitation becomes a proposal (atomic: a double click cannot do it twice)
  application = await JobApplication.findOneAndUpdate(
    { job: job._id, freelancer: req.user._id, status: 'invited' },
    { $set: { status: 'pending', coverLetter, proposedBudget, estimatedDays, answers } },
    { returnDocument: 'after' });
  if (!application) {
    try {
      application = await JobApplication.create({ job: job._id, freelancer: req.user._id, coverLetter, proposedBudget, estimatedDays, answers });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ message: 'You have already applied to this job.' });
      throw err;
    }
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
  await expireOffers({ job: job._id });
  const applications = await JobApplication.find({ job: job._id }).sort({ createdAt: -1 })
    .populate('freelancer', `${PERSON} skills.name`).lean();
  const ids = applications.map((a) => a.freelancer?._id).filter(Boolean);
  const done = await Project.aggregate([
    { $match: { freelancer: { $in: ids }, status: 'completed' } }, { $group: { _id: '$freelancer', n: { $sum: 1 } } },
  ]);
  const doneOf = Object.fromEntries(done.map((d) => [String(d._id), d.n]));
  const ratings = await ratingSummaries(ids, 'freelancer');
  res.json({ applications: applications.map(({ messages, ...a }) => ({ ...a, messageCount: (messages || []).length, freelancer: a.freelancer && {
    ...a.freelancer, rating: ratings[String(a.freelancer._id)] || { avg: 0, count: 0 }, skills: (a.freelancer.skills || []).map((s) => s.name).slice(0, 8), completedProjects: doneOf[String(a.freelancer._id)] || 0,
  } })) });
});

// GET /api/jobs/applications/mine   (freelancer)
exports.myApplications = wrap(async (req, res) => {
  await expireOffers({ freelancer: req.user._id });
  const applications = await JobApplication.find({ freelancer: req.user._id }).sort({ createdAt: -1 })
    .populate({ path: 'job', select: 'title status budgetMin budgetMax currency client project', populate: { path: 'client', select: 'name company.companyName' } }).lean();
  res.json({ applications: applications.filter((a) => a.job).map(({ messages, ...a }) => ({ ...a, messageCount: (messages || []).length })) });
});

// GET /api/jobs/inbox   (client or freelancer)  ->  { conversations }
// One list of every proposal conversation. Once the proposal is over (hired, declined, rejected...) the chat stays here
// as READ-ONLY history (readOnly: true); when someone was hired, projectId links to the project.
exports.inbox = wrap(async (req, res) => {
  const me = req.user._id;
  let apps;
  if (req.user.role === 'client') {
    const jobs = await Job.find({ client: me }).select('_id').lean();
    apps = await JobApplication.find({ job: { $in: jobs.map((j) => j._id) }, status: { $ne: 'invited' } }).lean();
  } else {
    apps = await JobApplication.find({ freelancer: me, status: { $ne: 'invited' } }).lean();
  }
  const jobs = await Job.find({ _id: { $in: [...new Set(apps.map((a) => String(a.job)))] } }).select('title status client').lean();
  const jobBy = Object.fromEntries(jobs.map((j) => [String(j._id), j]));
  const people = await User.find({ _id: { $in: apps.flatMap((a) => [a.freelancer, jobBy[String(a.job)]?.client]).filter(Boolean) } }).select('name').lean();
  const nameBy = Object.fromEntries(people.map((u) => [String(u._id), u.name]));
  const projects = await Project.find({ job: { $in: jobs.map((j) => j._id) } }).select('job').lean();
  const projBy = Object.fromEntries(projects.map((p) => [String(p.job), p._id]));
  const conversations = apps.map((a) => {
    const messages = a.messages || [];
    const job = jobBy[String(a.job)] || {}; const last = [...messages].reverse().find((m) => !m.system) || messages[messages.length - 1];
    const otherId = req.user.role === 'client' ? a.freelancer : job.client;
    return { applicationId: a._id, jobId: a.job, jobTitle: job.title, status: a.status, other: { _id: otherId, name: nameBy[String(otherId)] || 'User' },
      lastMessage: last?.text, lastAt: last?.createdAt || a.updatedAt, count: messages.length,
      readOnly: !(LIVE.includes(a.status) && job.status === 'open'), projectId: a.status === 'accepted' ? projBy[String(a.job)] : undefined };
  }).sort((x, y) => +new Date(y.lastAt) - +new Date(x.lastAt));
  res.json({ conversations });
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
  const moved = await JobApplication.findOneAndUpdate({ _id: app._id, status: 'pending' },
    { $set: { status: 'shortlisted' }, $push: { messages: { system: true, text: 'You have been shortlisted for this job. You can chat here about scope, price and timing.', createdAt: new Date() } } },
    { returnDocument: 'after' });
  if (!moved) return res.status(409).json({ message: 'Only a pending application can be shortlisted.' });
  await notify(app.freelancer, {
    type: 'application_shortlisted', title: 'You were shortlisted',
    message: `You are on the shortlist for "${job.title}".`, link: `/freelancer/inbox?applicationId=${app._id}`,
  });
  res.json({ application: moved });
});

// POST /api/jobs/applications/:appId/reject   (job owner)
exports.reject = wrap(async (req, res) => {
  const { app, job } = await ownApplication(req, res); if (!app) return;
  if (!['invited', 'pending', 'shortlisted'].includes(app.status)) return res.status(409).json({ message: app.status === 'offered' ? 'Withdraw the offer first.' : 'This application can no longer be declined.' });
  app.status = 'rejected'; await app.save();
  await notify(app.freelancer, {
    type: 'application_rejected', title: 'Application not selected',
    message: `Your application for "${job.title}" was not selected this time.`, link: `/freelancer/job/${job._id}`,
  });
  res.json({ application: app });
});

// ── Offers ──────────────────────────────────────────────────────────────────
// An offer that was not answered in time goes back to "shortlisted" (the client may send a new one).
async function expireOffers(extra = {}) {
  const stale = await JobApplication.find({ ...extra, status: 'offered', 'offer.expiresAt': { $lt: new Date() } }).select('_id job freelancer');
  for (const a of stale) {
    const moved = await JobApplication.findOneAndUpdate({ _id: a._id, status: 'offered', 'offer.expiresAt': { $lt: new Date() } },
      { $set: { status: 'shortlisted', 'offer.expiredAt': new Date() }, $unset: { offerSlot: '' } }, { returnDocument: 'after' });
    if (!moved) continue;
    const job = await Job.findById(a.job).select('title client');
    if (!job) continue;
    await notify(job.client, { type: 'offer_expired', title: 'Offer expired', message: `Your offer for "${job.title}" was not answered in time.`, link: `/client/job/${job._id}` });
    await notify(a.freelancer, { type: 'offer_expired', title: 'Offer expired', message: `The offer for "${job.title}" expired before you answered.`, link: `/freelancer/job/${job._id}` });
  }
}
exports.expireOffers = expireOffers;

// Creates the Project once the freelancer has accepted the offer.
// Returns { project, application } or { error: { status, message } }.
async function createProjectFromOffer({ job, app }) {
  // claim the job first: only one request can flip it from "open", so a double click cannot hire twice
  const claimed = await Job.findOneAndUpdate(
    { _id: job._id, status: 'open' },
    { $set: { status: 'in_progress', hiredFreelancer: app.freelancer } },
    { returnDocument: 'after' },
  );
  if (!claimed) return { error: { status: 409, message: 'This job was closed or already given to someone else.' } };

  const o = app.offer || {};
  let project;
  try {
    project = await Project.create({
      client: job.client, freelancer: app.freelancer, title: job.title, description: job.description,
      skills: job.skills, status: 'active', startDate: o.startDate || new Date(), deadline: o.deadline || job.deadline,
      budget: o.agreedBudget ?? app.proposedBudget ?? job.budgetMax ?? job.budgetMin, currency: job.currency, job: job._id,
    });
  } catch (err) {
    // a second project for the same job is refused by the database: someone else's hire won, so leave the job alone
    if (err.code === 11000) return { error: { status: 409, message: 'This job was closed or already given to someone else.' } };
    await Job.updateOne({ _id: job._id }, { $set: { status: 'open' }, $unset: { hiredFreelancer: '' } });   // undo the claim
    throw err;
  }
  await Job.updateOne({ _id: job._id }, { $set: { project: project._id } });

  // everyone else is told the job was filled
  const others = await JobApplication.find({ job: job._id, freelancer: { $ne: app.freelancer }, status: { $in: ['invited', 'pending', 'shortlisted', 'offered'] } }).select('freelancer');
  await JobApplication.updateMany({ _id: { $in: others.map((o2) => o2._id) } }, { $set: { status: 'rejected' }, $unset: { offerSlot: '' } });
  await Promise.all(others.map((o2) => notify(o2.freelancer, {
    type: 'application_rejected', title: 'Application not selected',
    message: `"${job.title}" was given to another freelancer.`, link: `/freelancer/job/${job._id}`,
  })));
  return { project, application: app };
}

// POST /api/jobs/applications/:appId/offer   (job owner)   body: { message, startDate?, deadline?, agreedBudget? }
// The client's formal offer. Only ONE live offer per job at a time. The freelancer has OFFER_EXPIRES_DAYS to answer.
exports.sendOffer = wrap(async (req, res) => {
  const { app, job } = await ownApplication(req, res); if (!app) return;
  await expireOffers({ job: job._id });
  if (job.status !== 'open') return res.status(409).json({ message: 'This job is not open any more.' });

  const message = String(req.body?.message || '').trim();
  if (message.length < 10) return res.status(400).json({ message: 'Describe what you expect from the freelancer (at least 10 characters).' });
  const startDate = date(req.body?.startDate), deadline = date(req.body?.deadline);
  if (startDate === null || deadline === null) return res.status(400).json({ message: 'A date is not valid.' });
  if (startDate && deadline && deadline < startDate) return res.status(400).json({ message: 'The end date must be after the start date.' });
  const agreedBudget = num(req.body?.agreedBudget);
  if (agreedBudget !== undefined && (Number.isNaN(agreedBudget) || agreedBudget < 0)) return res.status(400).json({ message: 'The agreed budget must be a positive number.' });

  const hours = req.body?.expiresInHours === undefined || req.body?.expiresInHours === '' ? OFFER_HOURS_DEFAULT : Number(req.body.expiresInHours);
  if (!OFFER_HOURS_ALLOWED.includes(hours)) return res.status(400).json({ message: `Choose how long the freelancer has to answer: ${OFFER_HOURS_ALLOWED.join(', ')} hours.` });

  if (await JobApplication.exists({ job: job._id, status: 'offered' })) {
    return res.status(409).json({ message: 'You already have an offer waiting for an answer on this job. Withdraw it first.' });
  }
  let sent;
  try {
    sent = await JobApplication.findOneAndUpdate(
      { _id: app._id, status: { $in: ['pending', 'shortlisted'] } },
      { $set: { status: 'offered', offer: { message: message.slice(0, 2000), startDate, deadline, agreedBudget: agreedBudget ?? app.proposedBudget,
          sentAt: new Date(), expiresAt: new Date(Date.now() + hours * HOUR) }, offerSlot: job._id } },
      { returnDocument: 'after' });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You already have an offer waiting for an answer on this job. Withdraw it first.' });
    throw err;
  }
  if (!sent) return res.status(409).json({ message: 'An offer can only be sent to someone who has applied and is still being considered.' });
  await notify(app.freelancer, {
    type: 'offer_received', title: 'You received an offer',
    message: `${req.user.name || 'A client'} sent you an offer for "${job.title}". Please answer within ${hours} hours.`,
    link: `/freelancer/job/${job._id}`, email: true,
  });
  res.status(201).json({ application: sent });
});

// POST /api/jobs/applications/:appId/offer/withdraw   (job owner)
exports.withdrawOffer = wrap(async (req, res) => {
  const { app, job } = await ownApplication(req, res); if (!app) return;
  const moved = await JobApplication.findOneAndUpdate({ _id: app._id, status: 'offered' },
    { $set: { status: 'shortlisted', 'offer.withdrawnAt': new Date() }, $unset: { offerSlot: '' } }, { returnDocument: 'after' });
  if (!moved) return res.status(409).json({ message: 'There is no offer to withdraw.' });
  await notify(app.freelancer, { type: 'offer_withdrawn', title: 'Offer withdrawn', message: `The offer for "${job.title}" was withdrawn.`, link: `/freelancer/job/${job._id}` });
  res.json({ application: moved });
});

// POST /api/jobs/applications/:appId/offer/accept   (the freelancer)  -> the Project is created
exports.acceptOffer = wrap(async (req, res) => {
  if (!isId(req.params.appId)) return res.status(400).json({ message: 'Invalid id.' });
  await expireOffers({ freelancer: req.user._id });
  const mine = await JobApplication.findOne({ _id: req.params.appId, freelancer: req.user._id });
  if (!mine) return res.status(404).json({ message: 'Application not found.' });
  const job = await Job.findById(mine.job);
  if (!job) return res.status(404).json({ message: 'Job not found.' });

  // claim the offer first (offered -> accepted) so a double click cannot run this twice
  const claimed = await JobApplication.findOneAndUpdate({ _id: mine._id, status: 'offered' },
    { $set: { status: 'accepted', 'offer.respondedAt': new Date() }, $unset: { offerSlot: '' } }, { returnDocument: 'after' });
  if (!claimed) {
    return res.status(409).json({ message: mine.status === 'shortlisted' && mine.offer?.expiredAt ? 'This offer has expired.' : 'There is no offer waiting for your answer.' });
  }
  const out = await createProjectFromOffer({ job, app: claimed });
  if (out.error) {
    await JobApplication.updateOne({ _id: mine._id }, { $set: { status: 'offered', offerSlot: job._id }, $unset: { 'offer.respondedAt': '' } });   // give the offer back
    return res.status(out.error.status).json({ message: out.error.message });
  }
  await notify(job.client, {
    type: 'offer_accepted', title: 'Offer accepted',
    message: `${req.user.name || 'The freelancer'} accepted your offer for "${job.title}". The project is ready.`,
    link: `/client/project/${out.project._id}`, email: true,
  });
  res.json(out);
});

// POST /api/jobs/applications/:appId/decline   (the freelancer)  body: { reason? }
// Declines an invitation or an offer. The job stays open.
exports.decline = wrap(async (req, res) => {
  if (!isId(req.params.appId)) return res.status(400).json({ message: 'Invalid id.' });
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  const moved = await JobApplication.findOneAndUpdate(
    { _id: req.params.appId, freelancer: req.user._id, status: { $in: ['invited', 'offered'] } },
    { $set: { status: 'declined', ...(reason ? { 'offer.declineReason': reason } : {}) }, $unset: { offerSlot: '' } }, { returnDocument: 'before' });
  if (!moved) return res.status(409).json({ message: 'There is nothing to decline here.' });
  const job = await Job.findById(moved.job).select('title client');
  if (job) await notify(job.client, {
    type: moved.status === 'offered' ? 'offer_declined' : 'invitation_declined',
    title: moved.status === 'offered' ? 'Offer declined' : 'Invitation declined',
    message: `${req.user.name || 'The freelancer'} declined ${moved.status === 'offered' ? 'your offer' : 'your invitation'} for "${job.title}".${reason ? ` Reason: ${reason}` : ''}`,
    link: `/client/job/${job._id}`,
  });
  res.json({ ok: true });
});

// ── Invitations ─────────────────────────────────────────────────────────────
// POST /api/jobs/:id/invite   (job owner)   body: { freelancerId, message? }
// Invite someone from the directory to apply for an open job. NOTHING is hired: the freelancer must send a proposal
// (or decline), and the client must still send an offer.
exports.invite = wrap(async (req, res) => {
  const job = await ownJob(req, res); if (!job) return;
  if (job.status !== 'open') return res.status(409).json({ message: 'You can only invite people to an open job.' });
  const freelancerId = req.body?.freelancerId;
  if (!isId(freelancerId)) return res.status(400).json({ message: 'Choose a freelancer to invite.' });
  const freelancer = await User.findOne({ _id: freelancerId, role: 'freelancer', status: { $nin: ['suspended', 'removed'] } }).select('_id name');
  if (!freelancer) return res.status(404).json({ message: 'Freelancer not found.' });
  const message = String(req.body?.message || '').trim().slice(0, 1000);

  let application;
  try {
    application = await JobApplication.create({ job: job._id, freelancer: freelancer._id, status: 'invited', invitationMessage: message || undefined });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'This freelancer has already applied to, or been invited to, this job.' });
    throw err;
  }
  await notify(freelancer._id, {
    type: 'job_invitation', title: 'You were invited to a job',
    message: `${req.user.name || 'A client'} invited you to apply for "${job.title}".`,
    link: `/freelancer/job/${job._id}`, email: true,
  });
  res.status(201).json({ application });
});

// ── Viewing and chatting about one application ──────────────────────────────
// Finds an application the logged-in user is part of (the job owner or the freelancer).
async function participantApplication(req, res) {
  if (!isId(req.params.appId)) { res.status(400).json({ message: 'Invalid id.' }); return {}; }
  const app = await JobApplication.findById(req.params.appId);
  if (!app) { res.status(404).json({ message: 'Application not found.' }); return {}; }
  const job = await Job.findById(app.job);
  if (!job) { res.status(404).json({ message: 'Job not found.' }); return {}; }
  const isClient = String(job.client) === String(req.user._id);
  const isFreelancer = String(app.freelancer) === String(req.user._id);
  if (!isClient && !isFreelancer) { res.status(403).json({ message: 'This is not your conversation.' }); return {}; }
  return { app, job, isClient };
}

// GET /api/jobs/applications/:appId   (either person)
// When the CLIENT opens a proposal for the first time it is marked "viewed" so the freelancer can see it.
exports.getApplication = wrap(async (req, res) => {
  const found = await participantApplication(req, res); if (!found.app) return;
  let { app } = found;
  if (found.isClient && !app.viewedAt && app.status !== 'invited') {
    app = await JobApplication.findOneAndUpdate({ _id: app._id, viewedAt: { $exists: false } }, { $set: { viewedAt: new Date() } }, { returnDocument: 'after' }) || app;
  }
  res.json({ application: app });
});

// POST /api/jobs/applications/:appId/messages   (either person)   body: { text }
// Either person can write once a proposal exists (an invitation alone is not a proposal).
exports.postMessage = wrap(async (req, res) => {
  const found = await participantApplication(req, res); if (!found.app) return;
  const { app, job, isClient } = found;
  if (!LIVE.includes(app.status)) return res.status(409).json({ message: app.status === 'invited' ? 'You can chat after the freelancer sends a proposal.' : 'This conversation is closed.' });
  if (job.status !== 'open') return res.status(409).json({ message: 'This job is not open any more.' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ message: 'Write a message first.' });
  // either side may write once a proposal exists; a small rate limit stops floods
  const since = Date.now() - 60 * 1000;
  const recent = (app.messages || []).filter((m) => !m.system && String(m.sender) === String(req.user._id) && +new Date(m.createdAt) > since).length;
  if (recent >= MSG_LIMIT) return res.status(429).json({ message: 'You are sending messages too fast. Please wait a moment.' });
  const updated = await JobApplication.findOneAndUpdate({ _id: app._id, status: { $in: LIVE } },
    { $push: { messages: { $each: [{ sender: req.user._id, text: text.slice(0, 2000), createdAt: new Date() }], $slice: -300 } } },
    { returnDocument: 'after' });
  if (!updated) return res.status(409).json({ message: 'This conversation is closed.' });
  await notify(isClient ? app.freelancer : job.client, {
    type: 'application_message', title: 'New message',
    message: `${req.user.name || 'Someone'} wrote to you about "${job.title}".`,
    link: `/${isClient ? 'freelancer' : 'client'}/inbox?applicationId=${app._id}`,
    payload: { applicationId: String(app._id), jobId: String(job._id) },
  });
  res.status(201).json({ application: updated });
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
  const rating = (await ratingSummaries([u._id], 'freelancer'))[String(u._id)] || { avg: 0, count: 0 };
  res.json({ freelancer: {
    rating, _id: u._id, name: u.name, avatarUrl: u.avatarUrl, headline: u.headline, bio: u.bio, location: u.location,
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
  const ratings = await ratingSummaries(rows.map((u) => u._id), 'freelancer');
  res.json({ freelancers: rows.map((u) => ({
    rating: ratings[String(u._id)] || { avg: 0, count: 0 }, _id: u._id, name: u.name, avatarUrl: u.avatarUrl, headline: u.headline, location: u.location,
    bio: u.bio ? String(u.bio).slice(0, 200) : undefined, trustScore: u.trustScore?.overall ?? 0,
    skills: (u.skills || []).map((s) => s.name).slice(0, 8),
  })) });
});