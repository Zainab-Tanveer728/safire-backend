// ================================================================
//  src/routes/profileRoutes.js
// ================================================================

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();

const { protect } = require('../middleware/authMiddleware');
const User        = require('../models/User');

const {
  saveSkills,
  requestEmployerVerification,
  getVerificationForm,
  respondToVerification,
} = require('../controllers/profileController');

// ── Helper ────────────────────────────────────────────────────────
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const ROOT        = path.join(__dirname, '../../');
const AVATARS_DIR = path.join(ROOT, 'uploads/avatars');
const RESUMES_DIR = path.join(ROOT, 'uploads/resumes');

ensureDir(AVATARS_DIR);
ensureDir(RESUMES_DIR);

// ════════════════════════════════════════════════════════════════
//  MULTER — AVATAR
// ════════════════════════════════════════════════════════════════

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATARS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar_${req.user._id}_${Date.now()}${ext}`);
  },
});

const avatarUpload = multer({
  storage:    avatarStorage,
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG and PNG images are accepted.'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ════════════════════════════════════════════════════════════════
//  MULTER — RESUME
// ════════════════════════════════════════════════════════════════

const ALLOWED_RESUME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RESUMES_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `resume_${req.user._id}_${Date.now()}${ext}`);
  },
});

const resumeUpload = multer({
  storage:    resumeStorage,
  fileFilter: (req, file, cb) => {
    if (ALLOWED_RESUME_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF or Word documents are accepted.'), false);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── Multer error wrapper ──────────────────────────────────────────
const handleMulterError = (uploadFn) => (req, res, next) => {
  uploadFn(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ message: 'File is too large.' });
      return res.status(400).json({ message: err.message });
    }
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
};

// ════════════════════════════════════════════════════════════════
//  PUT /api/profile/basic
// ════════════════════════════════════════════════════════════════

router.put(
  '/basic',
  protect,
  handleMulterError(avatarUpload.single('avatar')),
  async (req, res) => {
    try {
      const { name, headline, location, bio } = req.body;

      if (!name?.trim())
        return res.status(400).json({ message: 'Full name is required.' });
      if (headline?.trim().length > 100)
        return res.status(400).json({ message: 'Headline must not exceed 100 characters.' });
      if (bio?.trim().length > 500)
        return res.status(400).json({ message: 'Bio must not exceed 500 characters.' });

      const updateData = {
        name:     name.trim(),
        headline: headline?.trim() || '',
        location: location?.trim() || '',
        bio:      bio?.trim() || '',
        'onboarding.basicProfileDone': true,
      };

      if (req.file) {
        updateData.avatarUrl = `/uploads/avatars/${req.file.filename}`;
      }

      const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select('-password -otp -otpExpiry');

      if (!user) return res.status(404).json({ message: 'User not found.' });

      res.json({
        message: 'Profile saved successfully.',
        user: {
          name:       user.name,
          headline:   user.headline,
          location:   user.location,
          bio:        user.bio,
          avatarUrl:  user.avatarUrl,
          onboarding: user.onboarding,
        },
      });
    } catch (err) {
      console.error('Profile save error:', err.message);
      res.status(500).json({ message: 'Server error.' });
    }
  }
);

// ════════════════════════════════════════════════════════════════
//  GET /api/profile/me
// ════════════════════════════════════════════════════════════════

router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'name headline location bio avatarUrl role onboarding trustScore githubUsername githubStats resumeUrl resumeText skills employerVerifications'
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  POST /api/profile/resume/upload
// ════════════════════════════════════════════════════════════════

router.post(
  '/resume/upload',
  protect,
  handleMulterError(resumeUpload.single('resume')),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file received.' });
      }

      const resumeUrl = `/uploads/resumes/${req.file.filename}`;

      await User.findByIdAndUpdate(req.user._id, {
        $set: { resumeUrl }
      });

      console.log(`📄 Resume uploaded for user ${req.user._id}: ${req.file.filename}`);

      res.json({
        success:  true,
        resumeUrl,
        fileName: req.file.originalname,
        message:  'Resume uploaded successfully.',
      });
    } catch (err) {
      console.error('Resume upload error:', err.message);
      res.status(500).json({ message: 'Server error during upload.' });
    }
  }
);

// ════════════════════════════════════════════════════════════════
//  SKILLS + EMPLOYER VERIFICATION
// ════════════════════════════════════════════════════════════════

router.post('/skills',                       protect, saveSkills);
router.post('/employer-verification',        protect, requestEmployerVerification);
router.get('/employer-verification/:token',  getVerificationForm);
router.post('/employer-verification/respond', respondToVerification);

module.exports = router;