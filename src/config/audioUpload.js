// src/config/audioUpload.js
// Multer rules for meeting recordings. Separate from multer.js (avatars/resumes) so nothing there changes.
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(__dirname, '..', '..', 'private_uploads'));
const TMP  = path.join(ROOT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

const ALLOWED_EXT = ['.webm', '.ogg', '.opus', '.mp3', '.wav', '.m4a', '.mp4', '.flac'];
const MAX_MB      = Number(process.env.AUDIO_MAX_MB || 50);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(TMP, { recursive: true });       // re-create if someone deleted the folder
      cb(null, TMP);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const okType = /^(audio|video)\//.test(file.mimetype) ||
                   ['application/ogg', 'application/octet-stream'].includes(file.mimetype);
    if (ALLOWED_EXT.includes(ext) && okType) return cb(null, true);
    cb(new Error(`Only audio files are allowed (${ALLOWED_EXT.join(', ')}).`));
  },
}).single('audio');

// Wrapper so upload problems come back as clean JSON instead of a crash.
function uploadAudio(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ message: `Recording is too large. The limit is ${MAX_MB} MB.` });
    return res.status(400).json({ message: err.message || 'Upload failed.' });
  });
}

module.exports = { uploadAudio, MAX_MB };