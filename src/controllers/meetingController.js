// src/controllers/meetingController.js
// Module 3: meetings, consent, audio upload, and the Whisper -> RoBERTa pipeline.
//
// Flow (upload-recording path):
//   create meeting -> both people consent -> each uploads their own recording
//   -> POST /:id/process -> transcript + requirements appear (page polls GET /:id)
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const MeetingSession       = require('../models/MeetingSession');
const MeetingTranscript    = require('../models/MeetingTranscript');
const ExtractedRequirement = require('../models/ExtractedRequirement');
const storage = require('../services/storageService');
const ai      = require('../services/meetingAiService');
const { notify } = require('../services/notificationService');
const { formatRequirementId, nextRequirementNumber } = require('../utils/requirementId');

const idOf = (x) => String(x?._id || x);

const otherParty  = (party) => (party === 'client' ? 'freelancer' : 'client');
const otherUserId = (project, party) => (party === 'client' ? project.freelancer : project.client);
// Page addresses live here (not in a separate file) so a stale utils/pageLinks.js can never cause a 404 again.
const pageLinks = {
  meetingRoom: (role, pid, mid) => `/${role}/meeting-room/${pid}/${mid}`,
  transcript:  (role, pid, mid) => `/${role}/meeting-transcription/${pid}/${mid}`,
  review:      (role, pid)      => `/${role}/requirements-review/${pid}`,
};

// Hide things the browser must never see (storage keys, tokens).
function publicMeeting(meeting, userId, project) {
  const m = meeting.toObject ? meeting.toObject() : { ...meeting };
  delete m.sessionToken;
  delete m.shareToken;
  m.audioTracks = (m.audioTracks || []).map((t) => ({
    _id: t._id, user: t.user, role: t.role, offsetMs: t.offsetMs, durationSec: t.durationSec,
  }));
  const consentIds = (m.consents || []).map((c) => idOf(c.user));
  m.myConsent       = userId ? consentIds.includes(String(userId)) : false;
  m.bothConsented   = consentIds.length >= 2 && new Set(consentIds).size >= 2;
  // Real per-person consent, so the page never has to guess who agreed.
  // project is optional; without it the page falls back to myConsent / bothConsented.
  const pr = project || meeting.$project;
  if (pr) {
    m.consentedParties = {
      client:     consentIds.includes(idOf(pr.client)),
      freelancer: consentIds.includes(idOf(pr.freelancer)),
    };
  }
  return m;
}

const hasBothConsents = (meeting) =>
  new Set((meeting.consents || []).map((c) => idOf(c.user))).size >= 2;

async function dropTempFile(file) {
  if (file?.path) { try { await fs.promises.unlink(file.path); } catch { /* already gone */ } }
}

// ── Create / list / read ────────────────────────────────────────────────────
// POST /api/meetings/projects/:projectId        body: { title, scheduledAt }
exports.createMeeting = async (req, res) => {
  try {
    const { title, scheduledAt } = req.body || {};
    let when;
    if (scheduledAt) {
      when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ message: 'Invalid meeting date.' });
    }
    const project = req.project;

    const meeting = await MeetingSession.create({
      project: project._id,
      title: (title || '').trim().slice(0, 120) || 'Requirements meeting',
      initiatedBy: req.user._id,
      participants: [project.client, project.freelancer],
      scheduledAt: when,
      status: 'scheduled',
    });

    const other = otherParty(req.party);
    await notify(otherUserId(project, req.party), {
      type: 'meeting_invite',
      title: 'New meeting scheduled',
      message: `${req.user.name || 'Your project partner'} set up "${meeting.title}" for "${project.title}".`,
      link: pageLinks.meetingRoom(other, project._id, meeting._id),
      email: true,
    });

    res.status(201).json({ meeting: publicMeeting(meeting, req.user._id, project) });
  } catch (err) {
    console.error('[Meeting:create]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/meetings/projects/:projectId
exports.listMeetings = async (req, res) => {
  try {
    const meetings = await MeetingSession.find({ project: req.project._id }).sort({ createdAt: -1 });
    res.json({ meetings: meetings.map((m) => publicMeeting(m, req.user._id)) });
  } catch (err) {
    console.error('[Meeting:list]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/meetings        every meeting in all of MY projects (the Meetings page)
exports.listMyMeetings = async (req, res) => {
  try {
    const Project = require('../models/Project');
    const mine = req.user.role === 'client' ? { client: req.user._id } : { freelancer: req.user._id };
    const projects = await Project.find(mine).select('title client freelancer').populate('client freelancer', 'name').lean();
    const byId = Object.fromEntries(projects.map((p) => [String(p._id), p]));
    const meetings = await MeetingSession.find({ project: { $in: projects.map((p) => p._id) } })
      .sort({ createdAt: -1 }).limit(200);
    res.json({ meetings: meetings.map((m) => {
      const pr = byId[String(m.project)];
      return { ...publicMeeting(m, req.user._id), project: { _id: pr._id, title: pr.title, client: pr.client, freelancer: pr.freelancer } };
    }) });
  } catch (err) {
    console.error('[Meeting:mine]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/meetings/:id     (the pages poll this while the AI is working)
exports.getMeeting = async (req, res) => {
  try {
    const [hasTranscript, requirementCount] = await Promise.all([
      MeetingTranscript.exists({ meetingSession: req.meeting._id }),
      ExtractedRequirement.countDocuments({ meetingSession: req.meeting._id }),
    ]);
    res.json({
      meeting: publicMeeting(req.meeting, req.user._id, req.project),
      project: { _id: req.project._id, title: req.project.title },
      party: req.party,
      hasTranscript: !!hasTranscript,
      requirementCount,
    });
  } catch (err) {
    console.error('[Meeting:get]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Consent (FR23.7: recording only when BOTH people agree) ─────────────────
// POST /api/meetings/:id/consent
exports.giveConsent = async (req, res) => {
  try {
    const meeting = req.meeting;
    if (['completed', 'interrupted'].includes(meeting.status))
      return res.status(409).json({ message: 'This meeting has already ended.' });

    const mine = String(req.user._id);
    const already = meeting.consents.some((c) => idOf(c.user) === mine);
    if (!already) {
      meeting.consents.push({ user: req.user._id, consentedAt: new Date() });
      await meeting.save();

      await notify(otherUserId(req.project, req.party), {
        type: 'meeting_consent',
        title: hasBothConsents(meeting) ? 'Recording is ready' : 'Consent requested',
        message: hasBothConsents(meeting)
          ? `Both of you agreed to record "${meeting.title}".`
          : `${req.user.name || 'Your project partner'} agreed to record "${meeting.title}". Please give your consent too.`,
        link: pageLinks.meetingRoom(otherParty(req.party), req.project._id, meeting._id),
      });
    }
    res.json({ meeting: publicMeeting(meeting, req.user._id, req.project) });
  } catch (err) {
    console.error('[Meeting:consent]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Start / end ─────────────────────────────────────────────────────────────
// POST /api/meetings/:id/start
exports.startMeeting = async (req, res) => {
  try {
    const meeting = req.meeting;
    if (meeting.status !== 'scheduled')
      return res.status(409).json({ message: `Meeting is already ${meeting.status}.` });
    if (!hasBothConsents(meeting))
      return res.status(403).json({ message: 'Both people must give recording consent first.' });

    meeting.status = 'active';
    meeting.actualStartAt = new Date();
    meeting.sessionToken = crypto.randomBytes(16).toString('hex');
    await meeting.save();
    res.json({ meeting: publicMeeting(meeting, req.user._id, req.project) });
  } catch (err) {
    console.error('[Meeting:start]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// POST /api/meetings/:id/end     (duration is calculated automatically, FR24.1)
exports.endMeeting = async (req, res) => {
  try {
    const meeting = req.meeting;
    if (meeting.status !== 'active')
      return res.status(409).json({ message: 'Only a meeting in progress can be ended.' });

    meeting.status = 'completed';
    meeting.actualEndAt = new Date();
    meeting.durationSec = Math.max(0, Math.round((meeting.actualEndAt - meeting.actualStartAt) / 1000));
    await meeting.save();
    try { require('../socket/meetingSignaling').notifyMeeting(req.app.get('io'), meeting._id, 'meeting:ended', { by: req.party }); } catch { /* the call just closes on their side a moment later */ }
    res.json({ meeting: publicMeeting(meeting, req.user._id, req.project) });
  } catch (err) {
    console.error('[Meeting:end]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Audio upload ────────────────────────────────────────────────────────────
// POST /api/meetings/:id/audio     multipart: audio=<file>, offsetMs (optional)
// Each person uploads THEIR OWN recording, so we know who spoke without guessing.
exports.uploadAudio = async (req, res) => {
  const file = req.file;
  try {
    const meeting = req.meeting;
    if (!file) return res.status(400).json({ message: 'Choose an audio file first.' });
    if (!hasBothConsents(meeting)) {
      await dropTempFile(file);
      return res.status(403).json({ message: 'Both people must give recording consent before audio is uploaded.' });
    }
    if (meeting.transcriptionStatus === 'processing' || meeting.extractionStatus === 'processing') {
      await dropTempFile(file);
      return res.status(409).json({ message: 'The meeting is being processed. Wait until it finishes.' });
    }

    const ext = path.extname(file.originalname || file.filename).toLowerCase() || '.webm';
    const key = `meetings/${meeting._id}/${req.party}_${Date.now()}${ext}`;
    await storage.put(file.path, key);

    // one track per person: a new upload replaces the old one
    const mine = String(req.user._id);
    const old = meeting.audioTracks.find((t) => idOf(t.user) === mine);
    const offsetMs = Math.max(0, Number(req.body?.offsetMs) || 0);
    if (old) {
      await storage.remove(old.key);
      old.key = key; old.offsetMs = offsetMs; old.role = req.party;
    } else {
      meeting.audioTracks.push({ user: req.user._id, role: req.party, key, offsetMs });
    }
    meeting.audioStored = true;
    await meeting.save();

    res.status(201).json({ meeting: publicMeeting(meeting, req.user._id, req.project) });
  } catch (err) {
    await dropTempFile(file);
    console.error('[Meeting:audio]', err.message);
    res.status(500).json({ message: 'Could not save the recording.' });
  }
};

// GET /api/meetings/:id/audio/:trackId     (for playback on the transcript page)
exports.streamAudio = async (req, res) => {
  try {
    const track = req.meeting.audioTracks.id(req.params.trackId);
    if (!track) return res.status(404).json({ message: 'Recording not found.' });
    const filePath = await storage.getLocalPath(track.key);
    res.sendFile(filePath);
  } catch (err) {
    console.error('[Meeting:stream]', err.message);
    res.status(404).json({ message: 'Recording not found.' });
  }
};

// ── The AI pipeline ─────────────────────────────────────────────────────────
// POST /api/meetings/:id/process
// Answers at once (202) and keeps working in the background.
// The page polls GET /api/meetings/:id and watches transcriptionStatus / extractionStatus.
exports.processMeeting = async (req, res) => {
  try {
    const meeting = req.meeting;
    if (!meeting.audioTracks.length)
      return res.status(400).json({ message: 'Upload at least one recording first.' });
    if (meeting.transcriptionStatus === 'processing' || meeting.extractionStatus === 'processing')
      return res.status(409).json({ message: 'This meeting is already being processed.' });

    meeting.transcriptionStatus = 'processing';
    meeting.extractionStatus = 'pending';
    meeting.processingError = undefined;
    await meeting.save();

    res.status(202).json({ message: 'Processing started.', meeting: publicMeeting(meeting, req.user._id, req.project) });

    runPipeline(meeting._id, req.project).catch((err) =>
      console.error('[Meeting:pipeline]', err.message));
  } catch (err) {
    console.error('[Meeting:process]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

async function notifyBoth(project, meeting, { type, title, message, tail }) {
  for (const [userId, role] of [[project.client, 'client'], [project.freelancer, 'freelancer']]) {
    const link = tail === '/review'
      ? pageLinks.review(role, project._id)
      : pageLinks.transcript(role, project._id, meeting._id);
    await notify(userId, { type, title, message, link });
  }
}

async function runPipeline(meetingId, project) {
  const meeting = await MeetingSession.findById(meetingId);
  let stage = 'transcription';
  try {
    // 1. Whisper: audio -> transcript
    const tracks = [];
    for (const t of meeting.audioTracks) {
      tracks.push({
        filePath: await storage.getLocalPath(t.key),
        filename: path.basename(t.key),
        speaker: t.role === 'client' ? 'Client' : 'Freelancer',
        offsetSec: (t.offsetMs || 0) / 1000,
      });
    }

    let tr = await ai.transcribe(tracks);
    if (tr.isLowConfidence) {                       // one retry, keep the better result
      const again = await ai.transcribe(tracks);
      if ((again.confidenceScore || 0) >= (tr.confidenceScore || 0)) tr = again;
    }
    if (!tr.segments || !tr.segments.length)
      throw new Error('No speech was found in the recording.');

    await MeetingTranscript.findOneAndUpdate(
      { meetingSession: meeting._id },
      {
        meetingSession: meeting._id,
        audioDuration: tr.audioDuration,
        rawTranscript: tr.rawTranscript,
        cleanedTranscript: tr.cleanedTranscript,
        confidenceScore: tr.confidenceScore,
        isLowConfidence: !!tr.isLowConfidence,
        segments: tr.segments,
        asrEngine: tr.asrEngine || 'whisper',
        modelVersion: tr.modelVersion,
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    meeting.transcriptionStatus = tr.isLowConfidence ? 'low_confidence' : 'completed';
    if (['scheduled', 'active'].includes(meeting.status)) {
      meeting.status = 'completed';
      meeting.actualEndAt = meeting.actualEndAt || new Date();
    }
    if (!meeting.durationSec) meeting.durationSec = Math.round(tr.audioDuration || 0);
    meeting.extractionStatus = 'processing';
    await meeting.save();

    await notifyBoth(project, meeting, {
      type: 'transcript_ready', title: 'Transcript ready',
      message: `The transcript of "${meeting.title}" is ready.`, tail: '/transcript',
    });

    // 2. RoBERTa: transcript -> requirements
    stage = 'extraction';
    const ex = await ai.extractRequirements(tr.segments.map((s) => ({
      segmentId: s.segmentId, speaker: s.speaker, startTime: s.startTime, endTime: s.endTime, text: s.text,
    })));

    // a re-run replaces the unreviewed AI results but never touches confirmed/rejected ones
    await ExtractedRequirement.deleteMany({ meetingSession: meeting._id, source: 'ai', status: 'pending_review' });
    let n = await nextRequirementNumber(project._id);
    const docs = (ex.requirements || []).map((r) => ({
      meetingSession: meeting._id,
      project: project._id,
      requirementId: formatRequirementId(n++),
      type: r.type,
      text: r.text,
      sourceSegmentId: r.sourceSegmentId,
      confidenceScore: r.confidence,
      modelVersion: ex.modelVersion,
      source: 'ai',
      status: 'pending_review',
    }));
    if (docs.length) await ExtractedRequirement.insertMany(docs);

    meeting.extractionStatus = 'completed';
    await meeting.save();

    await notifyBoth(project, meeting, {
      type: 'requirements_ready', title: 'Requirements ready for review',
      message: docs.length
        ? `${docs.length} requirement${docs.length === 1 ? '' : 's'} found in "${meeting.title}". Please review them.`
        : `No requirements were found in "${meeting.title}".`,
      tail: '/review',
    });
  } catch (err) {
    meeting.processingError = String(err.message || err).slice(0, 300);
    if (stage === 'transcription') meeting.transcriptionStatus = 'failed';
    else meeting.extractionStatus = 'failed';
    await meeting.save();
    throw err;
  }
}

// ── Transcript ──────────────────────────────────────────────────────────────
// GET /api/meetings/:id/transcript
exports.getTranscript = async (req, res) => {
  try {
    const transcript = await MeetingTranscript.findOne({ meetingSession: req.meeting._id });
    res.json({
      transcript: transcript || null,
      transcriptionStatus: req.meeting.transcriptionStatus,
      extractionStatus: req.meeting.extractionStatus,
      processingError: req.meeting.processingError || null,
    });
  } catch (err) {
    console.error('[Meeting:transcript]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Share link (FR24.5): works for 7 days, no login needed ──────────────────
// POST /api/meetings/:id/share
exports.shareTranscript = async (req, res) => {
  try {
    const meeting = req.meeting;
    if (!(await MeetingTranscript.exists({ meetingSession: meeting._id })))
      return res.status(409).json({ message: 'There is no transcript to share yet.' });

    meeting.shareToken = crypto.randomBytes(24).toString('hex');
    meeting.shareExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await meeting.save();

    const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    res.json({ url: `${base}/shared/transcript/${meeting.shareToken}`, expiresAt: meeting.shareExpiresAt });
  } catch (err) {
    console.error('[Meeting:share]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// GET /api/meetings/shared/:token      (public: no login)
exports.getSharedTranscript = async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (token.length < 20) return res.status(404).json({ message: 'This link is not valid.' });

    const meeting = await MeetingSession.findOne({ shareToken: token, shareExpiresAt: { $gt: new Date() } })
      .populate('project', 'title');
    if (!meeting) return res.status(404).json({ message: 'This link is not valid or has expired.' });

    const transcript = await MeetingTranscript.findOne({ meetingSession: meeting._id });
    if (!transcript) return res.status(404).json({ message: 'Transcript not found.' });

    // only what a reader needs: no emails, no ids of people
    res.json({
      meeting: { title: meeting.title, projectTitle: meeting.project?.title, durationSec: meeting.durationSec },
      segments: transcript.segments.map((s) => ({
        segmentId: s.segmentId, speaker: s.speaker, startTime: s.startTime, endTime: s.endTime, text: s.text,
      })),
      expiresAt: meeting.shareExpiresAt,
    });
  } catch (err) {
    console.error('[Meeting:shared]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Live call: network servers the browsers use to find each other ──────────
// GET /api/meetings/:id/ice
// STUN works when both people are on normal home/university networks.
// A TURN server is the safety net for strict networks; add it in .env:
//   TURN_URL=turn:your.server:3478   TURN_USER=...   TURN_PASS=...
exports.getIceServers = (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((u) => u.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  res.json({ iceServers });
};