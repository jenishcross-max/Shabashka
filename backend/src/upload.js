const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'orders');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || '.jpg';
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME[file.mimetype]) {
    return cb(new Error('Поддерживаются только изображения JPEG, PNG или WebP'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

module.exports = { upload, uploadsDir };
