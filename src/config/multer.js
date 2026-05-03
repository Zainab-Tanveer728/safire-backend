const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── Resume disk storage ───────────────────────────────────────────
const resumeDir = path.join(__dirname, '../../uploads/resumes');
if (!fs.existsSync(resumeDir)) fs.mkdirSync(resumeDir, { recursive: true });

const resumeStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, resumeDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `resume_${req.user._id}_${Date.now()}${ext}`);
  },
});

const resumeFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only PDF and Word documents are accepted.'), false);
};

const resumeUpload = multer({
  storage:    resumeStorage,
  fileFilter: resumeFilter,
  limits:     { fileSize: 5 * 1024 * 1024 }, // 5MB
});

module.exports = resumeUpload;