const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const { protect } = require('../middleware/authMiddleware');

const {
  generateProposal,
  analyseSkillGap,
  enhanceResume,
  optimizeGig,
} = require('../controllers/freelancerController');

// ── Multer config for resume upload ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/resumes/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `resume_${req.user._id}_${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and DOCX files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Routes ───────────────────────────────────────────────────────

// POST /api/freelancer/generate-proposal
// FR2.1 — Generate AI proposal using job description + profile
router.post('/generate-proposal', protect, generateProposal);
// POST /api/freelancer/submit-proposal

// GET all proposals of logged in freelancer
router.get('/proposals', protect, async (req, res) => {
  try {
    const proposals = await Proposal.find({ freelancer: req.user._id })
      .sort({ createdAt: -1 });
    res.json(proposals);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch proposals.' });
  }
});

// DELETE a proposal
router.delete('/proposals/:id', protect, async (req, res) => {
  try {
    const proposal = await Proposal.findOne({ _id: req.params.id, freelancer: req.user._id });
    if (!proposal) return res.status(404).json({ message: 'Proposal not found.' });
    await proposal.deleteOne();
    res.json({ message: 'Proposal deleted.' });
  } catch (err) {
    res.status(500).json({ message: 'Delete failed.' });
  }
});

// submit-proposal route — save to DB
router.post('/submit-proposal', protect, async (req, res) => {
  try {
    const { jobDescription, profileHighlights, tone, generatedProposal, subject } = req.body;
    const proposal = await Proposal.create({
      freelancer: req.user._id,
      jobTitle: subject || 'Untitled Proposal',
      jobDescription,
      profileHighlights,
      tone: tone || 'professional',
      generatedProposal,
      status: 'submitted',
    });
    res.json({ message: 'Proposal submitted successfully!', proposal });
  } catch (err) {
    res.status(500).json({ message: 'Submit failed.' });
  }
});
// POST /api/freelancer/skill-gap
// FR2.3 — Skill gap analysis against target role
router.post('/skill-gap', protect, analyseSkillGap);

// POST /api/freelancer/enhance-resume
// FR2.2 — Resume enhancement (file upload OR paste text)
router.post(
  '/enhance-resume',
  protect,
  (req, res, next) => {
    // Only use multer if content-type is multipart (file upload)
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      upload.single('resume')(req, res, next);
    } else {
      next();
    }
  },
  enhanceResume
);

// POST /api/freelancer/optimize-gig
// FR2.4 — Gig optimization with TF-IDF market analysis
router.post('/optimize-gig', protect, optimizeGig);

module.exports = router;
