// const express = require('express');
// const multer  = require('multer');
// const path    = require('path');
// const fs      = require('fs');
// const router  = express.Router();
// const { buildUserPayload } = require('../utils/userPayload');

// const { protect } = require('../middleware/authMiddleware');
// const User        = require('../models/User');

// const {
//   saveSkills,
//   requestEmployerVerification,
//   getVerificationForm,
//   respondToVerification,
//   saveCompanyProfile,   // ADD
//   getClientProfile,     // ADD
// } = require('../controllers/profileController');

// // ── Helper ────────────────────────────────────────────────────────
// const ensureDir = (dir) => {
//   if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
// };

// const ROOT        = path.join(__dirname, '../../');
// const AVATARS_DIR = path.join(ROOT, 'uploads/avatars');
// const RESUMES_DIR = path.join(ROOT, 'uploads/resumes');

// ensureDir(AVATARS_DIR);
// ensureDir(RESUMES_DIR);

// const LOGOS_DIR = path.join(ROOT, 'uploads/logos');
// ensureDir(LOGOS_DIR);

// // ════════════════════════════════════════════════════════════════
// //  MULTER — AVATAR
// // ════════════════════════════════════════════════════════════════

// const logoStorage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, LOGOS_DIR),
//   filename:    (req, file, cb) => {
//     const ext = path.extname(file.originalname).toLowerCase();
//     cb(null, `logo_${req.user._id}_${Date.now()}${ext}`);
//   },
// });
// const logoUpload = multer({
//   storage:    logoStorage,
//   fileFilter: (req, file, cb) => {
//     const allowed = ['image/svg+xml', 'image/png', 'image/jpeg'];
//     if (allowed.includes(file.mimetype)) cb(null, true);
//     else cb(new Error('Only SVG, PNG, JPG are accepted.'), false);
//   },
//   limits: { fileSize: 2 * 1024 * 1024 },
// });

// const avatarStorage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, AVATARS_DIR),
//   filename:    (req, file, cb) => {
//     const ext = path.extname(file.originalname).toLowerCase();
//     cb(null, `avatar_${req.user._id}_${Date.now()}${ext}`);
//   },
// });

// const avatarUpload = multer({
//   storage:    avatarStorage,
//   fileFilter: (req, file, cb) => {
//     if (['image/jpeg', 'image/png'].includes(file.mimetype)) cb(null, true);
//     else cb(new Error('Only JPG and PNG images are accepted.'), false);
//   },
//   limits: { fileSize: 2 * 1024 * 1024 },
// });

// // ════════════════════════════════════════════════════════════════
// //  MULTER — RESUME
// // ════════════════════════════════════════════════════════════════

// const ALLOWED_RESUME_TYPES = [
//   'application/pdf',
//   'application/msword',
//   'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
// ];

// const resumeStorage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, RESUMES_DIR),
//   filename:    (req, file, cb) => {
//     const ext = path.extname(file.originalname).toLowerCase();
//     cb(null, `resume_${req.user._id}_${Date.now()}${ext}`);
//   },
// });

// const resumeUpload = multer({
//   storage:    resumeStorage,
//   fileFilter: (req, file, cb) => {
//     if (ALLOWED_RESUME_TYPES.includes(file.mimetype)) cb(null, true);
//     else cb(new Error('Only PDF or Word documents are accepted.'), false);
//   },
//   limits: { fileSize: 5 * 1024 * 1024 },
// });

// // ── Multer error wrapper ──────────────────────────────────────────
// const handleMulterError = (uploadFn) => (req, res, next) => {
//   uploadFn(req, res, (err) => {
//     if (err instanceof multer.MulterError) {
//       if (err.code === 'LIMIT_FILE_SIZE')
//         return res.status(400).json({ message: 'File is too large.' });
//       return res.status(400).json({ message: err.message });
//     }
//     if (err) return res.status(400).json({ message: err.message });
//     next();
//   });
// };

// // ════════════════════════════════════════════════════════════════
// //  PUT /api/profile/basic
// // ════════════════════════════════════════════════════════════════

// router.put(
//   '/basic',
//   protect,
//   handleMulterError(avatarUpload.single('avatar')),
//   async (req, res) => {
//     try {
//       const { name, headline, location, bio } = req.body;

//       if (!name?.trim())
//         return res.status(400).json({ message: 'Full name is required.' });
//       if (headline?.trim().length > 100)
//         return res.status(400).json({ message: 'Headline must not exceed 100 characters.' });
//       if (bio?.trim().length > 500)
//         return res.status(400).json({ message: 'Bio must not exceed 500 characters.' });

//       const updateData = {
//         name:     name.trim(),
//         headline: headline?.trim() || '',
//         location: location?.trim() || '',
//         bio:      bio?.trim() || '',
//         'onboarding.basicProfileDone': true,
//       };

//       if (req.file) {
//         updateData.avatarUrl = `/uploads/avatars/${req.file.filename}`;
//       }

//       const user = await User.findByIdAndUpdate(
//         req.user._id,
//         { $set: updateData },
//         { new: true, runValidators: true }
//       ).select('-password -otp -otpExpiry');

//       if (!user) return res.status(404).json({ message: 'User not found.' });

//       res.json({
//         message: 'Profile saved successfully.',
//         user: {
//           name:       user.name,
//           headline:   user.headline,
//           location:   user.location,
//           bio:        user.bio,
//           avatarUrl:  user.avatarUrl,
//           onboarding: user.onboarding,
//         },
//       });
//     } catch (err) {
//       console.error('Profile save error:', err.message);
//       res.status(500).json({ message: 'Server error.' });
//     }
//   }
// );

// // ════════════════════════════════════════════════════════════════
// //  GET /api/profile/me
// // ════════════════════════════════════════════════════════════════

// // router.get('/me', protect, async (req, res) => {
// //   try {
// //     const user = await User.findById(req.user._id).select(
// //       'name headline location bio avatarUrl role onboarding trustScore githubUsername githubStats resumeUrl resumeText skills employerVerifications'
// //     );
// //     if (!user) return res.status(404).json({ message: 'User not found.' });
// //     res.json({ user });
// //   } catch (err) {
// //     res.status(500).json({ message: 'Server error.' });
// //   }
// // });

// router.get('/me', protect, async (req, res) => {
//   try {
//     const user = await User.findById(req.user._id).select(
//       'name email status headline location bio avatarUrl role onboarding company trustScore githubUsername githubStats resumeUrl resumeText skills employerVerifications'
//     );
//     if (!user) return res.status(404).json({ message: 'User not found.' });

//     const data = user.toObject();

//     // Never send employer verification tokens to the browser
//     data.employerVerifications = (data.employerVerifications || []).map(
//       ({ verificationToken, ...rest }) => rest
//     );

//     // buildUserPayload last, so the computed onboarding flags win
//     res.json({ user: { ...data, ...buildUserPayload(user) } });
//   } catch (err) {
//     console.error('[Profile/me]', err.message);
//     res.status(500).json({ message: 'Server error.' });
//   }
// });

// // ════════════════════════════════════════════════════════════════
// //  POST /api/profile/resume/upload
// // ════════════════════════════════════════════════════════════════

// router.post(
//   '/resume/upload',
//   protect,
//   handleMulterError(resumeUpload.single('resume')),
//   async (req, res) => {
//     try {
//       if (!req.file) {
//         return res.status(400).json({ message: 'No file received.' });
//       }

//       const resumeUrl = `/uploads/resumes/${req.file.filename}`;

//       await User.findByIdAndUpdate(req.user._id, {
//         $set: { resumeUrl }
//       });

//       console.log(`📄 Resume uploaded for user ${req.user._id}: ${req.file.filename}`);

//       res.json({
//         success:  true,
//         resumeUrl,
//         fileName: req.file.originalname,
//         message:  'Resume uploaded successfully.',
//       });
//     } catch (err) {
//       console.error('Resume upload error:', err.message);
//       res.status(500).json({ message: 'Server error during upload.' });
//     }
//   }
// );



// // ════════════════════════════════════════════════════════════════
// //  SKILLS + EMPLOYER VERIFICATION
// // ════════════════════════════════════════════════════════════════

// router.post('/skills',                       protect, saveSkills);
// router.post('/employer-verification',        protect, requestEmployerVerification);
// router.get('/employer-verification/:token',  getVerificationForm);
// router.post('/employer-verification/respond', respondToVerification);

// router.put('/client/company', protect, handleMulterError(logoUpload.single('logo')), saveCompanyProfile);
// router.get('/client/me',      protect, getClientProfile);
// module.exports = router;

// ..........................................................

// src/routes/profileRoutes.js   (mounted at /api/profile)
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const fsp     = require('fs/promises');
const router  = express.Router();

const { protect } = require('../middleware/authMiddleware');
const User        = require('../models/User');
const { buildUserPayload } = require('../utils/userPayload');
const { extractResumeText, ResumeError } = require('../services/resumeParser');

const {
  saveSkills,
  skipAiProcessing,
  requestEmployerVerification,
  getVerificationForm,
  respondToVerification,
  saveCompanyProfile,
  getClientProfile,
} = require('../controllers/profileController');

// ── Helper ────────────────────────────────────────────────────────
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const ROOT        = path.join(__dirname, '../../');
const AVATARS_DIR = path.join(ROOT, 'uploads/avatars');
const RESUMES_DIR = path.join(ROOT, 'uploads/resumes');   // PRIVATE: do not serve this folder with express.static
const LOGOS_DIR   = path.join(ROOT, 'uploads/logos');

ensureDir(AVATARS_DIR);
ensureDir(RESUMES_DIR);
ensureDir(LOGOS_DIR);

// ════════════════════════════════════════════════════════════════
//  MULTER — LOGO + AVATAR
// ════════════════════════════════════════════════════════════════
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGOS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo_${req.user._id}_${Date.now()}${ext}`);
  },
});
const logoUpload = multer({
  storage:    logoStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only SVG, PNG, JPG are accepted.'), false);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
});

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
//  MULTER — RESUME  (PDF and DOCX only: old .doc files cannot be read as text)
// ════════════════════════════════════════════════════════════════
const ALLOWED_RESUME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const ALLOWED_RESUME_EXT = ['.pdf', '.docx'];

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
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_RESUME_TYPES.includes(file.mimetype) && ALLOWED_RESUME_EXT.includes(ext)) cb(null, true);
    else cb(new Error('Only PDF or Word (.docx) documents are accepted.'), false);
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
      'name email status isVerified headline location bio avatarUrl role onboarding company trustScore githubUsername githubStats resumeUrl resumeFileName skills employerVerifications'
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const data = user.toObject();

    // Never send employer verification tokens to the browser
    data.employerVerifications = (data.employerVerifications || []).map(
      ({ verificationToken, ...rest }) => rest
    );

    // buildUserPayload last, so the computed onboarding flags win
    res.json({ user: { ...data, ...await buildUserPayload(user) } });
  } catch (err) {
    console.error('[Profile/me]', err.message);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  POST /api/profile/resume/upload
//  Saves the file AND reads its text (user.resumeText), which the AI step needs.
//  Replaces the previous resume file so old files do not pile up on disk.
// ════════════════════════════════════════════════════════════════
router.post(
  '/resume/upload',
  protect,
  handleMulterError(resumeUpload.single('resume')),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No file received.' });
    }

    try {
      // checks the real file type, then reads the text. Throws ResumeError for scanned / fake / damaged files.
      const { text } = await extractResumeText(req.file.path);

      const previous = await User.findById(req.user._id).select('resumeUrl');
      const resumeUrl = `/uploads/resumes/${req.file.filename}`;

      await User.findByIdAndUpdate(req.user._id, {
        $set: {
          resumeUrl,
          resumeText:     text,
          resumeFileName: String(req.file.originalname).slice(0, 120),
          'onboarding.socialLinked': true,
        },
      });

      // delete the old file (basename() makes path tricks impossible)
      if (previous?.resumeUrl) {
        const oldPath = path.join(RESUMES_DIR, path.basename(previous.resumeUrl));
        if (oldPath !== req.file.path) fsp.unlink(oldPath).catch(() => {});
      }

      console.log(`📄 Resume saved for user ${req.user._id}: ${req.file.filename} (${text.length} characters read)`);

      res.json({
        success:   true,
        resumeUrl,
        fileName:  req.file.originalname,
        chars:     text.length,
        message:   'Resume uploaded and read successfully.',
      });
    } catch (err) {
      fsp.unlink(req.file.path).catch(() => {});   // never keep a file we could not use
      if (err instanceof ResumeError) {
        return res.status(422).json({ success: false, code: err.code, message: err.message });
      }
      console.error('Resume upload error:', err.message);
      res.status(500).json({ message: 'Server error during upload.' });
    }
  }
);

// ════════════════════════════════════════════════════════════════
//  GET /api/profile/resume/file   -> the owner downloads their own resume (not public any more)
// ════════════════════════════════════════════════════════════════
router.get('/resume/file', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('resumeUrl resumeFileName');
    if (!user?.resumeUrl) return res.status(404).json({ message: 'No resume on file.' });
    const file = path.join(RESUMES_DIR, path.basename(user.resumeUrl));
    if (!fs.existsSync(file)) return res.status(404).json({ message: 'Resume file not found.' });
    res.download(file, user.resumeFileName || path.basename(file));
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ════════════════════════════════════════════════════════════════
//  SKILLS + ONBOARDING + EMPLOYER VERIFICATION
// ════════════════════════════════════════════════════════════════
router.post('/skills',                        protect, saveSkills);
router.post('/skip-ai',                       protect, skipAiProcessing);
router.post('/employer-verification',         protect, requestEmployerVerification);
router.get('/employer-verification/:token',   getVerificationForm);
router.post('/employer-verification/respond', respondToVerification);

router.put('/client/company', protect, handleMulterError(logoUpload.single('logo')), saveCompanyProfile);
router.get('/client/me',      protect, getClientProfile);

module.exports = router;