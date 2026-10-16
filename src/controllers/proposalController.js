const mongoose = require('mongoose');
const Proposal = require('../models/proposal');
const { generateProposal } = require('../services/aiProposalService');

const TONES = ['professional', 'friendly', 'concise'];

const findOwn = (id, userId) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Proposal.findOne({ _id: id, freelancer: userId });
};

const getSkillNames = (user) =>
  (user.skills || []).map((s) => s.name).filter(Boolean).slice(0, 15);

const callAI = (user, data) =>
  generateProposal({
    jobTitle: data.jobTitle,
    jobDescription: data.jobDescription,
    profileHighlights: data.profileHighlights,
    tone: data.tone,
    skills: getSkillNames(user),
    name: user.name,
  });

const aiDown = (res, err) => {
  console.error('AI proposal error:', err.message);
  return res.status(503).json({
    message: 'Proposal AI service is unavailable right now. Please try again.',
  });
};

// POST /api/proposals/generate  -> generate + save as draft
exports.generate = async (req, res) => {
  try {
    const { jobTitle, jobDescription, profileHighlights, tone = 'professional' } = req.body;

    if (!jobDescription || jobDescription.trim().length < 30) {
      return res.status(400).json({ message: 'Job description must be at least 30 characters.' });
    }
    if (!TONES.includes(tone)) {
      return res.status(400).json({ message: `Tone must be one of: ${TONES.join(', ')}` });
    }

    let ai;
    try {
      ai = await callAI(req.user, { jobTitle, jobDescription, profileHighlights, tone });
    } catch (err) {
      return aiDown(res, err);
    }

    const proposal = await Proposal.create({
      freelancer: req.user._id,
      jobTitle,
      jobDescription,
      profileHighlights,
      tone,
      generatedProposal: ai.text,
      generationSource: ai.source,
      version: 1,
      versions: [{ version: 1, text: ai.text, source: ai.source }],
    });

    res.status(201).json({ proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to generate proposal.' });
  }
};

// POST /api/proposals/:id/regenerate  -> new version (optionally new tone/highlights)
exports.regenerate = async (req, res) => {
  try {
    const proposal = await findOwn(req.params.id, req.user._id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });
    if (proposal.status !== 'draft') {
      return res.status(400).json({ message: 'Only drafts can be regenerated.' });
    }

    const { tone, profileHighlights } = req.body;
    if (tone) {
      if (!TONES.includes(tone)) return res.status(400).json({ message: 'Invalid tone.' });
      proposal.tone = tone;
    }
    if (profileHighlights !== undefined) proposal.profileHighlights = profileHighlights;

    let ai;
    try {
      ai = await callAI(req.user, proposal);
    } catch (err) {
      return aiDown(res, err);
    }

    proposal.version += 1;
    proposal.generatedProposal = ai.text;
    proposal.generationSource = ai.source;
    proposal.versions.push({ version: proposal.version, text: ai.text, source: ai.source });
    await proposal.save();

    res.json({ proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to regenerate proposal.' });
  }
};

// PUT /api/proposals/:id  -> user edits text (saved as a new version)
exports.update = async (req, res) => {
  try {
    const proposal = await findOwn(req.params.id, req.user._id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });
    if (proposal.status !== 'draft') {
      return res.status(400).json({ message: 'Submitted proposals cannot be edited.' });
    }

    const { generatedProposal, jobTitle } = req.body;
    if (jobTitle !== undefined) proposal.jobTitle = jobTitle;

    if (generatedProposal !== undefined && generatedProposal !== proposal.generatedProposal) {
      if (!generatedProposal.trim()) {
        return res.status(400).json({ message: 'Proposal text cannot be empty.' });
      }
      proposal.version += 1;
      proposal.generatedProposal = generatedProposal;
      proposal.generationSource = 'edited';
      proposal.versions.push({ version: proposal.version, text: generatedProposal, source: 'edited' });
    }

    await proposal.save();
    res.json({ proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update proposal.' });
  }
};

// PATCH /api/proposals/:id/submit
exports.submit = async (req, res) => {
  try {
    const proposal = await findOwn(req.params.id, req.user._id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });
    if (proposal.status !== 'draft') {
      return res.status(400).json({ message: 'Proposal already submitted.' });
    }
    proposal.status = 'submitted';
    proposal.submittedAt = new Date();
    await proposal.save();
    res.json({ proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to submit proposal.' });
  }
};

// GET /api/proposals?status=draft
exports.list = async (req, res) => {
  try {
    const filter = { freelancer: req.user._id };
    if (req.query.status) filter.status = req.query.status;

    const proposals = await Proposal.find(filter)
      .select('-versions')
      .sort({ createdAt: -1 });

    res.json({ proposals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch proposals.' });
  }
};

// GET /api/proposals/:id  (includes version history)
exports.getOne = async (req, res) => {
  try {
    const proposal = await findOwn(req.params.id, req.user._id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });
    res.json({ proposal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch proposal.' });
  }
};

// DELETE /api/proposals/:id  (any status - the owner can remove their own proposal)
exports.remove = async (req, res) => {
  try {
    const proposal = await findOwn(req.params.id, req.user._id);
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });
    await proposal.deleteOne();
    res.json({ message: 'Proposal deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete proposal.' });
  }
};
