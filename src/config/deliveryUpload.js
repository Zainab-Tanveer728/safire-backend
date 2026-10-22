const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.UPLOAD_ROOT || path.join(__dirname, '..', '..', 'private_uploads'));
const TMP = path.join(ROOT, 'tmp');
const MAX_MB = Number(process.env.DELIVERY_MAX_MB) || 50;
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.zip', '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.json', '.html', '.css', '.js', '.ts', '.py', '.java',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.mov', '.mp3', '.wav',
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(TMP, { recursive: true });
      callback(null, TMP);
    },
    filename: (_req, file, callback) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      callback(null, `delivery_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) return callback(null, true);
    callback(new Error('This file type is not supported for project delivery.'), false);
  },
}).single('file');

function uploadDelivery(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `Delivery file is too large. The limit is ${MAX_MB} MB.` });
    }
    return res.status(400).json({ message: err.message || 'File upload failed.' });
  });
}

module.exports = { uploadDelivery, MAX_MB };
