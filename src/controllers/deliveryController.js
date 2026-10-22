// src/controllers/deliveryController.js  (NEW)
// The freelancer SUBMITS the work; the client has 7 days to ACCEPT it or ask for a REVISION.
// If the client says nothing for 7 days (after a reminder) the delivery is accepted automatically and the project completes.
// Every submission and every revision stays in project.deliveries (nothing is overwritten).
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Project = require('../models/Project');
const storage = require('../services/storageService');
const { notify } = require('../services/notificationService');
const { finishProject } = require('./reviewController');
let Dispute = null; try { Dispute = require('../models/Dispute'); } catch (_) { /* Module 5 not installed */ }

const DAY = 24 * 60 * 60 * 1000;
const REVIEW_DAYS = Number(process.env.DELIVERY_REVIEW_DAYS) || 7;       // the client's time to answer a delivery (disclosed to both people)
const REMIND_DAYS = Number(process.env.DELIVERY_REMIND_BEFORE_DAYS) || 2; // reminder this many days before auto-accept
const MAX_REVISIONS = Number(process.env.DELIVERY_MAX_REVISIONS) || 3;    // after this many, accept or raise a dispute

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    console.error('[Delivery]', e.message);
    if (!res.headersSent) res.status(500).json({ message: 'Server error.' });
  } finally {
    await discardTempFile(req.file);
  }
};
const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const idOf = (x) => String(x?._id || x);
const hasOpenDispute = (pid) => (Dispute ? Dispute.exists({ project: pid, status: 'open' }) : false);

async function myProject(req, res) {
  if (!isId(req.params.id)) { res.status(400).json({ message: 'Invalid project id.' }); return {}; }
  const project = await Project.findById(req.params.id).select('+deliveries.fileKey');
  if (!project) { res.status(404).json({ message: 'Project not found.' }); return {}; }
  const me = String(req.user._id);
  const party = idOf(project.client) === me ? 'client' : idOf(project.freelancer) === me ? 'freelancer' : null;
  if (!party) { res.status(403).json({ message: 'You are not part of this project.' }); return {}; }
  return { project, party };
}
// Changes ONE delivery, but only if it is still 'submitted' (so two clicks / a click and the sweep cannot both win).
async function claimDelivery(projectId, n, set) {
  const i = n - 1;                                         // deliveries are only ever appended, so number n sits at index n-1
  const sets = Object.fromEntries(Object.entries(set).map(([k, v]) => [`deliveries.${i}.${k}`, v]));
  const r = await Project.updateOne({ _id: projectId, [`deliveries.${i}.status`]: 'submitted' }, { $set: sets });
  return r.modifiedCount === 1;
}
const view = (p) => ({
  reviewDays: REVIEW_DAYS,
  maxRevisions: MAX_REVISIONS,
  deliveries: (p.deliveries || []).map((d) => {
    const item = d.toObject ? d.toObject() : { ...d };
    const hasFile = !!item.fileKey;
    delete item.fileKey;
    if (hasFile) item.fileUrl = `/projects/${p._id}/deliveries/${item._id}/file`;
    return item;
  }),
});

async function discardTempFile(file) {
  if (file?.path) await fs.promises.unlink(file.path).catch((err) => {
    if (err.code !== 'ENOENT') console.error('[Delivery:temp-cleanup]', err.message);
  });
}

async function rejectSubmission(req, res, status, message) {
  await discardTempFile(req.file);
  return res.status(status).json({ message });
}

// GET /api/projects/:id/deliveries
exports.list = wrap(async (req, res) => {
  const { project } = await myProject(req, res); if (!project) return;
  res.json({ status: project.status, requirementsLocked: !!project.requirementsLocked, ...view(project) });
});

// POST /api/projects/:id/deliveries   body: { note, url? }   (freelancer)
exports.submit = wrap(async (req, res) => {
  const { project, party } = await myProject(req, res); if (!project) return;
  if (party !== 'freelancer') return rejectSubmission(req, res, 403, 'Only the freelancer submits work.');
  const note = String(req.body?.note || '').trim(), url = String(req.body?.url || '').trim();
  if (note.length < 10) return rejectSubmission(req, res, 400, 'Describe what you are delivering (at least 10 characters).');
  if (url && !/^https?:\/\/\S+$/i.test(url)) return rejectSubmission(req, res, 400, 'The link must start with http:// or https://');
  if (project.status !== 'active') return rejectSubmission(req, res, 409, 'Work can only be submitted on an active project.');
  if (!project.requirementsLocked) return rejectSubmission(req, res, 409, 'You both need to approve the requirements before work can be delivered.');
  if (await hasOpenDispute(project._id)) return rejectSubmission(req, res, 409, 'Resolve the open dispute first.');
  const now = new Date();
  let fileKey;
  let updated;
  try {
    const n = (project.deliveries || []).length + 1;
    if (req.file) {
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      fileKey = await storage.put(req.file.path, `deliveries/${project._id}/${n}_${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
    updated = await Project.findOneAndUpdate({ _id: project._id, status: 'active', 'deliveries.status': { $ne: 'submitted' } },
      { $push: { deliveries: {
        n, note: note.slice(0, 2000), url: url || undefined, fileKey,
        fileName: req.file ? path.posix.basename(req.file.originalname.replace(/\\/g, '/')).replace(/[\r\n]/g, '').slice(0, 255) : undefined,
        submittedAt: now, reviewDueAt: new Date(+now + REVIEW_DAYS * DAY), status: 'submitted',
      } } },
      { returnDocument: 'after' }).select('+deliveries.fileKey');
  } catch (err) {
    if (fileKey) await storage.remove(fileKey).catch((cleanupError) => console.error('[Delivery:file-cleanup]', cleanupError.message));
    throw err;
  }
  if (!updated) {
    if (fileKey) await storage.remove(fileKey);
    return res.status(409).json({ message: 'You already have a delivery waiting for the client.' });
  }
  const count = updated.deliveries.length;
  await notify(updated.client, { type: 'delivery_submitted', title: 'Work delivered',
    message: `The freelancer submitted ${count > 1 ? `delivery #${count}` : 'the work'} for "${updated.title}". Please review it within ${REVIEW_DAYS} days, or it is accepted automatically.`,
    link: `/client/project-reviews/${updated._id}`, email: true });
  res.status(201).json(view(updated));
});

// GET /api/projects/:id/deliveries/:did/file (either project participant)
exports.download = wrap(async (req, res) => {
  const { project } = await myProject(req, res); if (!project) return;
  if (!isId(req.params.did)) return res.status(400).json({ message: 'Invalid delivery id.' });
  const delivery = project.deliveries.id(req.params.did);
  if (!delivery?.fileKey) return res.status(404).json({ message: 'Delivery file not found.' });

  let localPath;
  try {
    localPath = await storage.getLocalPath(delivery.fileKey);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ message: 'Delivery file is no longer available.' });
    throw err;
  }
  res.download(localPath, path.basename(delivery.fileName || 'project-delivery'), (err) => {
    if (err && !res.headersSent) {
      console.error('[Delivery:download]', err.message);
      res.status(500).json({ message: 'Could not download the delivery file.' });
    }
  });
});

async function respond(req, res, status) {
  const { project, party } = await myProject(req, res); if (!project) return;
  if (party !== 'client') return res.status(403).json({ message: 'Only the client can respond to a delivery.' });
  if (!isId(req.params.did)) return res.status(400).json({ message: 'Invalid delivery id.' });
  const d = project.deliveries.id(req.params.did);
  if (!d) return res.status(404).json({ message: 'Delivery not found.' });
  if (d.status !== 'submitted') return res.status(409).json({ message: 'This delivery was already answered.' });
  if (await hasOpenDispute(project._id)) return res.status(409).json({ message: 'Resolve the open dispute first.' });
  const note = String(req.body?.note || '').trim();

  if (status === 'revision_requested') {
    if (note.length < 10) return res.status(400).json({ message: 'Say what is missing compared to the agreed requirements (at least 10 characters).' });
    const used = project.deliveries.filter((x) => x.status === 'revision_requested').length;
    if (used >= MAX_REVISIONS) return res.status(409).json({ message: `You have used all ${MAX_REVISIONS} revision requests. Accept the work, or raise a dispute.` });
  }
  const ok = await claimDelivery(project._id, d.n, { status, response: note.slice(0, 1000) || null, respondedAt: new Date() });
  if (!ok) return res.status(409).json({ message: 'This delivery was already answered.' });
  const claimed = await Project.findById(project._id).select('+deliveries.fileKey');

  if (status === 'accepted') {
    const done = await finishProject(project._id);
    if (!done) return res.status(409).json({ message: 'Only an active project can be completed.' });
    return res.json({ ...view(claimed), project: done });
  }
  await notify(project.freelancer, { type: 'revision_requested', title: 'Changes requested',
    message: `The client asked for changes on "${project.title}": ${note.slice(0, 160)}`, link: `/freelancer/project-reviews/${project._id}`, email: true });
  res.json(view(claimed));
}
exports.accept   = wrap((req, res) => respond(req, res, 'accepted'));
exports.revision = wrap((req, res) => respond(req, res, 'revision_requested'));

// Called by the hourly sweep. Reminds the client, then auto-accepts deliveries nobody answered. Returns counts.
exports.sweep = async function sweep(now = new Date()) {
  const out = { reminded: 0, autoAccepted: 0, skipped: 0 };
  const projects = await Project.find({ status: 'active', 'deliveries.status': 'submitted' });
  for (const p of projects) {
    const d = (p.deliveries || []).find((x) => x.status === 'submitted'); if (!d) continue;
    if (await hasOpenDispute(p._id)) { out.skipped += 1; continue; }          // a dispute pauses the clock
    const due = new Date(d.reviewDueAt);
    if (due <= now) {
      if (!await claimDelivery(p._id, d.n, { status: 'auto_accepted', respondedAt: now })) continue;
      const done = await finishProject(p._id);
      if (done) {
        await notify(p.client, { type: 'delivery_auto_accepted', title: 'Delivery accepted automatically',
          message: `You did not answer within ${REVIEW_DAYS} days, so the work on "${p.title}" was accepted.`, link: `/client/project-reviews/${p._id}`, email: true });
        out.autoAccepted += 1;
      }
    } else if (!d.reminderSent && due - now <= REMIND_DAYS * DAY) {
      if (!await claimDelivery(p._id, d.n, { reminderSent: true })) continue;
      await notify(p.client, { type: 'delivery_reminder', title: 'Please review the delivery',
        message: `The work on "${p.title}" will be accepted automatically on ${due.toDateString()} unless you accept it or ask for changes.`, link: `/client/project-reviews/${p._id}`, email: true });
      out.reminded += 1;
    }
  }
  return out;
};