const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// Gig optimizer: new controller (TF-IDF + LLM + skill validation)
const {
  optimizeGig,
  getGigOptimizerProfile,
  getGigCategories,
} = require('../controllers/gigOptimizerController');

const {
  analyseSkillGap,
  getLatestSkillGapReport,
  getSkillGapRoles,
} = require('../controllers/skillGapController');

const {
  enhanceResume,
  scoreResume,
  applyResumeVersion,
} = require('../controllers/resumeEnhancerController');

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

// Only runs multer for multipart requests (a file upload). A wrong file type or a file over 5 MB
// now comes back as a JSON message the page can show (FR20.1), not as an HTML error page.
const resumeUpload = (req, res, next) => {
  if (!req.headers['content-type']?.includes('multipart/form-data')) return next();
  upload.single('resume')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File is too large (maximum 5 MB).' });
      }
      return res.status(400).json({ message: err.message });
    }
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
};

// ── Routes ───────────────────────────────────────────────────────
// Proposals ab /api/proposals (routes/proposalRoutes.js) par hain.

// FR2.3 — Skill gap detection (controllers/skillGapController.js, uses the Python AI service)
// GET  /api/freelancer/skill-gap/roles    role dropdown (only roles the AI knows)
// GET  /api/freelancer/skill-gap/latest   the freelancer's last saved report
// POST /api/freelancer/skill-gap          run a new analysis and save it
router.get('/skill-gap/roles',  protect, restrictTo('freelancer'), getSkillGapRoles);
router.get('/skill-gap/latest', protect, restrictTo('freelancer'), getLatestSkillGapReport);
router.post('/skill-gap',       protect, restrictTo('freelancer'), analyseSkillGap);

// FR2.2 — Resume enhancement (controllers/resumeEnhancerController.js, uses the Python AI service)
// POST /api/freelancer/enhance-resume                 file upload OR pasted text -> scores + suggested edits
// POST /api/freelancer/resume/score                   re-analyse the current text (fast, no language model)
// POST /api/freelancer/resume/versions/:id/apply      save what the freelancer kept (and optionally make it active)
router.post('/enhance-resume', protect, restrictTo('freelancer'), resumeUpload, enhanceResume);
router.post('/resume/score',   protect, restrictTo('freelancer'), scoreResume);
router.post('/resume/versions/:id/apply', protect, restrictTo('freelancer'), applyResumeVersion);

// FR2.4 — Gig optimization (controllers/gigOptimizerController.js, uses the Python AI service)
// GET  /api/freelancer/gig-optimizer/profile      name, title, skills to pre-fill the form (FR21.3)
// GET  /api/freelancer/gig-optimizer/categories   popular gig categories for auto-suggest (FR21.1)
// POST /api/freelancer/optimize-gig               TF-IDF market analysis + LLM wording (FR21.4)
// POST /api/freelancer/gig-optimizer/optimize     same thing, second path (freelancerService.js uses this one)
router.get('/gig-optimizer/profile',    protect, restrictTo('freelancer'), getGigOptimizerProfile);
router.get('/gig-optimizer/categories', protect, restrictTo('freelancer'), getGigCategories);
router.post(['/optimize-gig', '/gig-optimizer/optimize'], protect, restrictTo('freelancer'), optimizeGig);

module.exports = router;