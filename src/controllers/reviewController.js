// src/controllers/reviewController.js  (NEW)
// Complete a project -> both sides can rate each other (1-5 stars + comment) -> ratings show on profiles.
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Review  = require('../models/Review');
const User    = require('../models/User');
const { notify } = require('../services/notificationService');
let Dispute = null; try { Dispute = require('../models/Dispute'); } catch (_) { /* Module 5 not installed */ }

const DAY = 24 * 60 * 60 * 1000;
const BLIND_DAYS  = Number(process.env.REVIEW_PUBLISH_AFTER_DAYS) || 14;   // hidden at most this long
const WINDOW_DAYS = BLIND_DAYS;                                            // ONE deadline: 14 days after completion for both writing and the hidden period
const REPLY_EDIT_MIN = Number(process.env.REVIEW_REPLY_EDIT_MINUTES) || 15; // the reply can be edited this long
const ASPECTS = { freelancer: ['quality', 'communication', 'deadlines'], client: ['clarity', 'communication', 'responsiveness'] };

const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { console.error('[Review]', err.message); res.status(500).json({ message: 'Server error.' }); }
};
const idOf = (x) => String(x?._id || x);
const stars = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };
const visibleNow = () => ({ hidden: { $ne: true }, $or: [{ published: true }, { publishAt: { $lte: new Date() } }] });

// "4.6 from 12 reviews" for many people at once -> { [userId]: { avg, count } }   (only reviews that are public)
async function ratingSummaries(ids, revieweeRole) {
  if (!ids.length) return {};
  const rows = await Review.find({ reviewee: { $in: ids }, ...(revieweeRole ? { revieweeRole } : {}), ...visibleNow() }).select('reviewee rating').lean();
  const out = {};
  for (const r of rows) { const o = (out[String(r.reviewee)] ||= { total: 0, count: 0 }); o.total += r.rating; o.count += 1; }
  return Object.fromEntries(Object.entries(out).map(([k, o]) => [k, { avg: Math.round((o.total / o.count) * 10) / 10, count: o.count }]));
}
exports.ratingSummaries = ratingSummaries;

// Loads the project and checks the person is its client or freelancer.
async function myProject(req, res) {
  if (!isId(req.params.id)) { res.status(400).json({ message: 'Invalid project id.' }); return {}; }
  const project = await Project.findById(req.params.id);
  if (!project) { res.status(404).json({ message: 'Project not found.' }); return {}; }
  const me = String(req.user._id);
  const party = idOf(project.client) === me ? 'client' : idOf(project.freelancer) === me ? 'freelancer' : null;
  if (!party) { res.status(403).json({ message: 'You are not part of this project.' }); return {}; }
  return { project, party };
}

// POST /api/projects/:id/complete   (the client)
// Marks the project finished. This is what opens the reviews.
exports.completeProject = wrap(async (req, res) => {
  const { project, party } = await myProject(req, res); if (!project) return;
  if (party !== 'client') return res.status(403).json({ message: 'Only the client can mark the project as complete.' });
  if (Dispute && await Dispute.exists({ project: project._id, status: 'open' })) {
    return res.status(409).json({ message: 'Resolve the open dispute before completing the project.' });
  }
  const done = await finishProject(project._id);
  if (!done) return res.status(409).json({ message: 'Only an active project can be completed.' });
  res.json({ project: done });
});

// Shared by "client completes", "client accepts a delivery" and "7-day auto-accept".
// Only an active project can finish, and only once (this is the single switch that opens reviews for both people).
async function finishProject(projectId) {
  const done = await Project.findOneAndUpdate({ _id: projectId, status: 'active' },
    { $set: { status: 'completed', completedAt: new Date() } }, { returnDocument: 'after' });
  if (!done) return null;
  await Promise.all([
    notify(done.freelancer, { type: 'review_needed', title: 'Project completed',
      message: `"${done.title}" was marked complete. Please rate your experience with the client within ${BLIND_DAYS} days.`,
      link: `/freelancer/project-reviews/${done._id}`, email: true }),
    notify(done.client, { type: 'review_needed', title: 'Project completed',
      message: `"${done.title}" is complete. Please rate your experience with the freelancer within ${BLIND_DAYS} days.`,
      link: `/client/project-reviews/${done._id}`, email: true }),
  ]);
  return done;
}
exports.finishProject = finishProject;

// GET /api/projects/:id/reviews   (client or freelancer)
// -> { completed, canReview, reason?, reviewUntil, mine, theirs }   "theirs" only appears once it is public
exports.projectReviews = wrap(async (req, res) => {
  const { project, party } = await myProject(req, res); if (!project) return;
  const [mine, theirsRaw] = await Promise.all([
    Review.findOne({ project: project._id, reviewer: req.user._id }).lean(),
    Review.findOne({ project: project._id, reviewee: req.user._id }).lean(),
  ]);
  const theirs = theirsRaw && (theirsRaw.published || theirsRaw.publishAt <= new Date()) ? theirsRaw : null;
  const completed = project.status === 'completed';
  const reviewUntil = completed && project.completedAt ? new Date(+new Date(project.completedAt) + WINDOW_DAYS * DAY) : null;
  let canReview = completed && !mine && (!reviewUntil || reviewUntil > new Date()), reason;
  if (!completed) reason = 'The client has not marked this project as complete yet.';
  else if (mine) reason = 'You have already reviewed this project.';
  else if (!canReview) reason = 'The review period for this project has ended.';
  res.json({ party, status: project.status, completed, canReview, reason, reviewUntil, aspects: ASPECTS[party === 'client' ? 'freelancer' : 'client'],
    mine, theirs, theirsWaiting: !!theirsRaw && !theirs });
});

// POST /api/projects/:id/reviews   body: { rating, comment?, aspects?: { quality: 4, ... } }
exports.createReview = wrap(async (req, res) => {
  const { project, party } = await myProject(req, res); if (!project) return;
  if (project.status !== 'completed') return res.status(409).json({ message: 'You can review a project only after it is completed.' });
  if (project.completedAt && +new Date(project.completedAt) + WINDOW_DAYS * DAY < Date.now()) return res.status(409).json({ message: 'The review period for this project has ended.' });

  const rating = stars(req.body?.rating);
  if (!rating) return res.status(400).json({ message: 'Please choose a star rating from 1 to 5.' });
  const comment = String(req.body?.comment || '').trim();
  if (rating <= 2 && comment.length < 10) return res.status(400).json({ message: 'For a low rating, please tell the other person what went wrong (at least 10 characters).' });

  const revieweeRole = party === 'client' ? 'freelancer' : 'client';
  const aspects = {};
  for (const k of ASPECTS[revieweeRole]) { const v = req.body?.aspects?.[k]; if (v !== undefined && v !== null && v !== '') { const n = stars(v); if (!n) return res.status(400).json({ message: `The "${k}" rating must be from 1 to 5.` }); aspects[k] = n; } }

  const reviewee = revieweeRole === 'freelancer' ? project.freelancer : project.client;
  const base = project.completedAt ? new Date(project.completedAt) : new Date();
  let review;
  try {
    review = await Review.create({ project: project._id, reviewer: req.user._id, reviewee, revieweeRole, rating, aspects, comment: comment || undefined,
      publishAt: new Date(+base + BLIND_DAYS * DAY) });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You have already reviewed this project.' });
    throw err;
  }
  // If the other person already reviewed, both reviews become public now.
  const other = await Review.findOneAndUpdate({ project: project._id, reviewer: reviewee }, { $set: { published: true } }, { returnDocument: 'after' });
  if (other) { await Review.updateOne({ _id: review._id }, { $set: { published: true } }); review.published = true; }

  await notify(reviewee, {
    type: 'review_received', title: 'You received a review',
    message: other ? `${req.user.name || 'Someone'} reviewed you on "${project.title}". Both reviews are now public.`
      : `${req.user.name || 'Someone'} reviewed you on "${project.title}". You can read it once you review them too (or after ${BLIND_DAYS} days).`,
    link: `/${revieweeRole}/project-reviews/${project._id}`,
  });
  res.status(201).json({ review });
});

// POST /api/reviews/:reviewId/reply   body: { text }   (the person who was reviewed, once, after it is public)
exports.reply = wrap(async (req, res) => {
  if (!isId(req.params.reviewId)) return res.status(400).json({ message: 'Invalid review id.' });
  const text = String(req.body?.text || '').trim();
  if (text.length < 2) return res.status(400).json({ message: 'Write your reply first.' });
  const r = await Review.findOne({ _id: req.params.reviewId, reviewee: req.user._id });
  if (!r) return res.status(404).json({ message: 'Review not found.' });
  if (!(r.published || r.publishAt <= new Date())) return res.status(409).json({ message: 'You can reply once the review is public.' });
  if (r.hidden) return res.status(409).json({ message: 'This review is no longer available.' });
  if (r.reply?.text) {
    // one reply, but it can be fixed for a few minutes (typos)
    if (+new Date(r.reply.at) + REPLY_EDIT_MIN * 60 * 1000 < Date.now()) return res.status(409).json({ message: 'You have already replied to this review.' });
    const edited = await Review.findOneAndUpdate({ _id: r._id, 'reply.at': r.reply.at }, { $set: { 'reply.text': text.slice(0, 600) } }, { returnDocument: 'after' });
    return res.json({ review: edited, edited: true });
  }
  const done = await Review.findOneAndUpdate({ _id: r._id, 'reply.text': { $exists: false } }, { $set: { reply: { text: text.slice(0, 600), at: new Date() } } }, { returnDocument: 'after' });
  if (!done) return res.status(409).json({ message: 'You have already replied to this review.' });
  res.json({ review: done });
});

// POST /api/reviews/:reviewId/report   body: { reason }   (the reviewed person or anyone in the project flags an unfair review)
exports.report = wrap(async (req, res) => {
  if (!isId(req.params.reviewId)) return res.status(400).json({ message: 'Invalid review id.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) return res.status(400).json({ message: 'Tell us briefly what is wrong with this review.' });
  const r = await Review.findById(req.params.reviewId);
  if (!r || String(r.reviewee) !== String(req.user._id)) return res.status(404).json({ message: 'Review not found.' });
  if ((r.reports || []).some((x) => String(x.by) === String(req.user._id))) return res.status(409).json({ message: 'You have already reported this review.' });
  r.reports.push({ by: req.user._id, reason: reason.slice(0, 300) });
  await r.save();
  res.json({ ok: true });
});

// PATCH /api/reviews/:reviewId/hide   body: { hidden }   (admin only)
exports.hide = wrap(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only an admin can do this.' });
  if (!isId(req.params.reviewId)) return res.status(400).json({ message: 'Invalid review id.' });
  const r = await Review.findByIdAndUpdate(req.params.reviewId, { $set: { hidden: req.body?.hidden !== false } }, { returnDocument: 'after' });
  if (!r) return res.status(404).json({ message: 'Review not found.' });
  res.json({ review: r });
});

// GET /api/reviews/user/:userId   (any logged-in user)  -> { summary, reviews }  public reviews only
exports.userReviews = wrap(async (req, res) => {
  if (!isId(req.params.userId)) return res.status(400).json({ message: 'Invalid user id.' });
  const user = await User.findOne({ _id: req.params.userId, status: { $nin: ['suspended', 'removed'] } }).select('_id role');
  if (!user || !['freelancer', 'client'].includes(user.role)) return res.status(404).json({ message: 'User not found.' });
  const filter = { reviewee: user._id, revieweeRole: user.role, ...visibleNow() };
  const rows = await Review.find(filter).sort({ createdAt: -1 }).limit(50)
    .populate('reviewer', 'name avatarUrl company.companyName').populate('project', 'title').lean();
  const all = await Review.find(filter).select('rating aspects').lean();
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; let sum = 0; const asp = {};
  for (const r of all) {
    dist[r.rating]++; sum += r.rating;
    for (const [k, v] of Object.entries(r.aspects || {})) { (asp[k] ||= []).push(v); }
  }
  const summary = { count: all.length, avg: all.length ? Math.round((sum / all.length) * 10) / 10 : 0, distribution: dist,
    aspects: Object.fromEntries(Object.entries(asp).map(([k, a]) => [k, Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10])) };
  res.json({ summary, reviews: rows.map((r) => ({ _id: r._id, rating: r.rating, comment: r.comment, aspects: r.aspects, reply: r.reply, createdAt: r.createdAt,
    projectTitle: r.project?.title, reviewer: r.reviewer && { name: r.reviewer.company?.companyName || r.reviewer.name, avatarUrl: r.reviewer.avatarUrl } })) });
});